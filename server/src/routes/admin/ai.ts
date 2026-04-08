import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { requireAdminAuth, logAdminAction, getAdminId } from './shared.js';
import {
  getAnthropicTools, getOpenAITools, getGeminiTools,
  getToolByName, ADMIN_AI_SYSTEM_PROMPT,
} from '../../services/admin-ai-service.js';
import { getAvailableProviders } from '../../services/llm-service.js';
import { getAiSettings, setAiSettings, type AiAssistantSettings } from '../../services/admin-secret.js';
import { logger } from '../../lib/logger.js';

const app = new Hono();
const MAX_TOOL_CALLS = 20;

// GET /admin/api/ai/providers — list available providers with API keys configured
app.get('/api/ai/providers', requireAdminAuth, async (c) => {
  const providers = getAvailableProviders();
  const aiSettings = await getAiSettings();

  // Add local provider if endpoint is configured
  if (aiSettings.localEndpoint) {
    providers.push({
      provider: 'local',
      models: aiSettings.localModelName
        ? [aiSettings.localModelName]
        : ['default'],
    });
  }

  return c.json({ providers, settings: {
    defaultProvider: aiSettings.defaultProvider,
    defaultModel: aiSettings.defaultModel,
  }});
});

// GET /admin/api/ai/settings — get AI assistant settings
app.get('/api/ai/settings', requireAdminAuth, async (c) => {
  const settings = await getAiSettings();
  // Mask the local API key for security
  return c.json({
    ...settings,
    localApiKey: settings.localApiKey ? '***configured***' : '',
  });
});

// PATCH /admin/api/ai/settings — update AI assistant settings
app.patch('/api/ai/settings', requireAdminAuth, async (c) => {
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const updates: Record<string, unknown> = {};

  if (body.localEndpoint !== undefined) {
    const ep = String(body.localEndpoint).trim();
    if (ep && !/^https?:\/\//.test(ep)) {
      return c.json({ error: 'Local endpoint must start with http:// or https://' }, 400);
    }
    updates.localEndpoint = ep;
  }
  if (body.localApiKey !== undefined && body.localApiKey !== '***configured***') {
    updates.localApiKey = String(body.localApiKey);
  }
  if (body.localModelName !== undefined) {
    updates.localModelName = String(body.localModelName).trim();
  }
  if (body.customSystemPrompt !== undefined) {
    updates.customSystemPrompt = String(body.customSystemPrompt);
  }
  if (body.defaultProvider !== undefined) {
    updates.defaultProvider = String(body.defaultProvider);
  }
  if (body.defaultModel !== undefined) {
    updates.defaultModel = String(body.defaultModel);
  }
  if (body.temperature !== undefined) {
    const temp = parseFloat(body.temperature);
    if (isNaN(temp) || temp < 0 || temp > 2) {
      return c.json({ error: 'Temperature must be 0-2' }, 400);
    }
    updates.temperature = temp;
  }

  await setAiSettings(updates as Partial<AiAssistantSettings>);
  await logAdminAction(getAdminId(c), 'ai-settings.update', `Updated AI assistant settings`);

  const settings = await getAiSettings();
  return c.json({
    ok: true,
    ...settings,
    localApiKey: settings.localApiKey ? '***configured***' : '',
  });
});

// ─── Provider-specific LLM call abstractions ─────────────────────

interface ToolCall { id: string; name: string; input: Record<string, unknown>; confirmed?: boolean }
interface LLMResult {
  textParts: string[];
  toolCalls: ToolCall[];
  stopReason: string;
  rawAssistantContent: unknown; // for appending to message history
}

function getApiKey(provider: string): string {
  switch (provider) {
    case 'anthropic': return process.env.ANTHROPIC_API_KEY || '';
    case 'openai': return process.env.OPENAI_API_KEY || '';
    case 'gemini': return process.env.GEMINI_API_KEY || '';
    case 'mistral': return process.env.MISTRAL_API_KEY || '';
    default: return '';
  }
}

async function callAnthropic(model: string, messages: unknown[], apiKey: string, systemPrompt: string, temperature: number): Promise<LLMResult> {
  const anthCtrl = new AbortController();
  const anthTimer = setTimeout(() => anthCtrl.abort(), 60_000);
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: anthCtrl.signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      tools: getAnthropicTools(),
      temperature,
    }),
  });
  clearTimeout(anthTimer);

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`API error ${resp.status}: ${errText}`);
  }

  const result = await resp.json() as {
    content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
    stop_reason: string;
  };

  return {
    textParts: result.content.filter(b => b.type === 'text').map(b => b.text!),
    toolCalls: result.content.filter(b => b.type === 'tool_use').map(b => ({
      id: b.id!, name: b.name!, input: b.input || {},
    })),
    stopReason: result.stop_reason,
    rawAssistantContent: result.content,
  };
}

function buildAnthropicToolResults(
  results: Array<{ id: string; content: string }>,
): { role: string; content: unknown } {
  return {
    role: 'user',
    content: results.map(r => ({ type: 'tool_result', tool_use_id: r.id, content: r.content })),
  };
}

async function callOpenAI(model: string, messages: unknown[], apiKey: string, provider: 'openai' | 'mistral', systemPrompt: string, temperature: number): Promise<LLMResult> {
  const url = provider === 'mistral'
    ? 'https://api.mistral.ai/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';

  // Prepend system message
  const allMessages = [{ role: 'system', content: systemPrompt }, ...(messages as Array<Record<string, unknown>>)];

  const oaiCtrl = new AbortController();
  const oaiTimer = setTimeout(() => oaiCtrl.abort(), 60_000);
  const resp = await fetch(url, {
    method: 'POST',
    signal: oaiCtrl.signal,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: allMessages,
      tools: getOpenAITools(),
      max_tokens: 4096,
      temperature,
    }),
  });
  clearTimeout(oaiTimer);

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`API error ${resp.status}: ${errText}`);
  }

  const result = await resp.json() as {
    choices: Array<{
      message: {
        role: string;
        content: string | null;
        tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
      };
      finish_reason: string;
    }>;
  };

  const msg = result.choices[0]?.message;
  const textParts = msg?.content ? [msg.content] : [];
  const toolCalls = (msg?.tool_calls || []).map(tc => ({
    id: tc.id,
    name: tc.function.name,
    input: JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>,
  }));

  return {
    textParts,
    toolCalls,
    stopReason: result.choices[0]?.finish_reason || 'stop',
    rawAssistantContent: msg,
  };
}

function buildOpenAIToolResults(
  results: Array<{ id: string; name: string; content: string }>,
): Array<{ role: string; tool_call_id: string; name: string; content: string }> {
  return results.map(r => ({
    role: 'tool',
    tool_call_id: r.id,
    name: r.name,
    content: r.content,
  }));
}

async function callGemini(model: string, messages: unknown[], apiKey: string, systemPrompt: string, temperature: number): Promise<LLMResult> {
  // Convert messages to Gemini format
  const contents = (messages as Array<{ role: string; content: unknown }>).map(m => {
    if (m.role === 'assistant') {
      return { role: 'model', parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }] };
    }
    // tool results come as separate messages
    if (m.role === 'function' || m.role === 'tool') {
      const mr = m as { name?: string; content: string };
      return { role: 'function', parts: [{ functionResponse: { name: mr.name || 'unknown', response: JSON.parse(mr.content || '{}') } }] };
    }
    return { role: 'user', parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }] };
  });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const gemCtrl = new AbortController();
  const gemTimer = setTimeout(() => gemCtrl.abort(), 60_000);
  const resp = await fetch(url, {
    method: 'POST',
    signal: gemCtrl.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      tools: getGeminiTools(),
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: { temperature },
    }),
  });
  clearTimeout(gemTimer);

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`API error ${resp.status}: ${errText}`);
  }

  const result = await resp.json() as {
    candidates: Array<{
      content: { parts: Array<{ text?: string; functionCall?: { name: string; args: Record<string, unknown> } }> };
      finishReason: string;
    }>;
  };

  const parts = result.candidates?.[0]?.content?.parts || [];
  const textParts = parts.filter(p => p.text).map(p => p.text!);
  const toolCalls = parts.filter(p => p.functionCall).map((p, i) => ({
    id: `gemini-tc-${i}`,
    name: p.functionCall!.name,
    input: p.functionCall!.args || {},
  }));

  return {
    textParts,
    toolCalls,
    stopReason: result.candidates?.[0]?.finishReason || 'STOP',
    rawAssistantContent: result.candidates?.[0]?.content,
  };
}

async function callLocal(model: string, messages: unknown[], endpoint: string, apiKey: string, systemPrompt: string, temperature: number): Promise<LLMResult> {
  let parsedEndpoint: URL;
  try { parsedEndpoint = new URL(endpoint); } catch { throw new Error('Invalid local endpoint URL'); }
  if (parsedEndpoint.protocol !== 'http:' && parsedEndpoint.protocol !== 'https:') {
    throw new Error('Local endpoint must use http or https');
  }
  const url = parsedEndpoint.href.replace(/\/+$/, '') + '/chat/completions';

  const allMessages = [{ role: 'system', content: systemPrompt }, ...(messages as Array<Record<string, unknown>>)];

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const localCtrl = new AbortController();
  const localTimer = setTimeout(() => localCtrl.abort(), 60_000);
  const resp = await fetch(url, {
    method: 'POST',
    signal: localCtrl.signal,
    headers,
    body: JSON.stringify({
      model,
      messages: allMessages,
      tools: getOpenAITools(),
      max_tokens: 4096,
      temperature,
    }),
  });
  clearTimeout(localTimer);

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Local LLM error ${resp.status}: ${errText}`);
  }

  const result = await resp.json() as {
    choices: Array<{
      message: {
        role: string;
        content: string | null;
        tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
      };
      finish_reason: string;
    }>;
  };

  const msg = result.choices[0]?.message;
  const textParts = msg?.content ? [msg.content] : [];
  const toolCalls = (msg?.tool_calls || []).map(tc => ({
    id: tc.id,
    name: tc.function.name,
    input: JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>,
  }));

  return {
    textParts,
    toolCalls,
    stopReason: result.choices[0]?.finish_reason || 'stop',
    rawAssistantContent: msg,
  };
}

// ─── Unified agent loop ──────────────────────────────────────────

app.post('/api/ai/chat', requireAdminAuth, async (c) => {
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const { messages, provider: reqProvider, model: reqModel, confirmedToolCalls: confirmedRaw } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return c.json({ error: 'Messages array required' }, 400);
  }
  if (messages.length > 50) {
    return c.json({ error: 'Too many messages (max 50)' }, 400);
  }

  // Client can pre-approve specific write tool calls by name
  const confirmedToolCalls = new Set<string>(
    Array.isArray(confirmedRaw) ? (confirmedRaw as string[]).filter(s => typeof s === 'string') : [],
  );

  // Load AI settings for system prompt, temperature, defaults
  const aiSettings = await getAiSettings();

  const effectiveSystemPrompt = aiSettings.customSystemPrompt
    ? ADMIN_AI_SYSTEM_PROMPT + '\n\n' + aiSettings.customSystemPrompt
    : ADMIN_AI_SYSTEM_PROMPT;

  // Determine provider: use requested, or settings default, or first available
  const available = getAvailableProviders();

  // Add local provider to available list if configured
  if (aiSettings.localEndpoint) {
    available.push({
      provider: 'local',
      models: aiSettings.localModelName
        ? [aiSettings.localModelName]
        : ['default'],
    });
  }

  if (available.length === 0) {
    return c.json({ error: 'No AI provider API keys configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, or MISTRAL_API_KEY, or configure a local endpoint.' }, 503);
  }

  let provider: string;
  if (reqProvider && available.some(p => p.provider === reqProvider)) {
    provider = reqProvider as string;
  } else if (aiSettings.defaultProvider && available.some(p => p.provider === aiSettings.defaultProvider)) {
    provider = aiSettings.defaultProvider;
  } else {
    provider = available[0].provider;
  }

  const providerInfo = available.find(p => p.provider === provider)!;
  let model: string;
  if (reqModel && providerInfo.models.includes(reqModel)) {
    model = reqModel as string;
  } else if (aiSettings.defaultModel && providerInfo.models.includes(aiSettings.defaultModel)) {
    model = aiSettings.defaultModel;
  } else {
    model = providerInfo.models[0];
  }

  const apiKey = provider === 'local' ? '' : getApiKey(provider);
  if (provider !== 'local' && !apiKey) {
    return c.json({ error: `${provider.toUpperCase()} API key not configured` }, 503);
  }

  const adminId = getAdminId(c);
  await logAdminAction(adminId, 'ai-assistant.chat', `AI Assistant chat via ${provider}/${model} (${messages.length} messages)`);

  return streamSSE(c, async (stream) => {
    let toolCallCount = 0;
    const currentMessages = [...messages];

    // Send provider info to client
    await stream.writeSSE({ data: JSON.stringify({ type: 'provider', provider, model }) });

    while (toolCallCount < MAX_TOOL_CALLS) {
      let result: LLMResult;
      try {
        switch (provider) {
          case 'anthropic':
            result = await callAnthropic(model, currentMessages, apiKey, effectiveSystemPrompt, aiSettings.temperature);
            break;
          case 'openai':
            result = await callOpenAI(model, currentMessages, apiKey, 'openai', effectiveSystemPrompt, aiSettings.temperature);
            break;
          case 'mistral':
            result = await callOpenAI(model, currentMessages, apiKey, 'mistral', effectiveSystemPrompt, aiSettings.temperature);
            break;
          case 'gemini':
            result = await callGemini(model, currentMessages, apiKey, effectiveSystemPrompt, aiSettings.temperature);
            break;
          case 'local': {
            if (!aiSettings.localEndpoint) {
              await stream.writeSSE({ data: JSON.stringify({ type: 'error', error: 'Local LLM endpoint not configured' }) });
              return;
            }
            result = await callLocal(model, currentMessages, aiSettings.localEndpoint, aiSettings.localApiKey, effectiveSystemPrompt, aiSettings.temperature);
            break;
          }
          default:
            await stream.writeSSE({ data: JSON.stringify({ type: 'error', error: `Unsupported provider: ${provider}` }) });
            return;
        }
      } catch (err) {
        logger.error('Admin AI API error', { provider, model, error: String(err) });
        await stream.writeSSE({ data: JSON.stringify({ type: 'error', error: String(err) }) });
        return;
      }

      // Send text to client
      for (const text of result.textParts) {
        await stream.writeSSE({ data: JSON.stringify({ type: 'text', text }) });
      }

      if (result.toolCalls.length === 0) {
        await stream.writeSSE({ data: JSON.stringify({ type: 'done', stopReason: result.stopReason }) });
        return;
      }

      // Append assistant message to history
      if (provider === 'anthropic') {
        currentMessages.push({ role: 'assistant', content: result.rawAssistantContent });
      } else if (provider === 'openai' || provider === 'mistral' || provider === 'local') {
        currentMessages.push(result.rawAssistantContent);
      } else if (provider === 'gemini') {
        // For Gemini, we'll include the model response as a model turn
        currentMessages.push({ role: 'assistant', content: result.textParts.join('\n') + '\n[tool calls made]' });
      }

      // Execute tools
      const toolResultEntries: Array<{ id: string; name: string; content: string }> = [];
      for (const tc of result.toolCalls) {
        toolCallCount++;
        const tool = getToolByName(tc.name);

        await stream.writeSSE({ data: JSON.stringify({
          type: 'tool_call', name: tc.name, input: tc.input,
          requiresConfirm: tool?.requiresConfirm || false,
        }) });

        if (!tool) {
          toolResultEntries.push({ id: tc.id, name: tc.name, content: JSON.stringify({ error: `Unknown tool: ${tc.name}` }) });
          continue;
        }

        // Enforce confirmation for write tools — block execution unless the
        // client explicitly included the tool name in confirmedToolCalls
        if (tool.requiresConfirm && !confirmedToolCalls.has(tc.name)) {
          const pendingMsg = `Tool "${tc.name}" requires admin confirmation before execution. The action was NOT performed. Ask the user to confirm and resubmit with confirmedToolCalls including "${tc.name}".`;
          toolResultEntries.push({ id: tc.id, name: tc.name, content: JSON.stringify({ error: pendingMsg }) });
          await stream.writeSSE({ data: JSON.stringify({
            type: 'confirmation_required', name: tc.name, input: tc.input,
            message: `This action requires confirmation. Re-send with confirmedToolCalls: ["${tc.name}"] to proceed.`,
          }) });
          continue;
        }

        try {
          const toolResult = await tool.execute(tc.input, adminId);
          const resultStr = JSON.stringify(toolResult);
          toolResultEntries.push({
            id: tc.id,
            name: tc.name,
            content: resultStr.length > 20000 ? resultStr.slice(0, 20000) + '...[truncated]' : resultStr,
          });
          await stream.writeSSE({ data: JSON.stringify({
            type: 'tool_result', name: tc.name,
            result: resultStr.length > 5000 ? resultStr.slice(0, 5000) + '...' : toolResult,
          }) });
        } catch (err) {
          const errorMsg = String(err);
          toolResultEntries.push({ id: tc.id, name: tc.name, content: JSON.stringify({ error: errorMsg }) });
          await stream.writeSSE({ data: JSON.stringify({ type: 'tool_error', name: tc.name, error: errorMsg }) });
        }
      }

      // Append tool results in provider-specific format
      if (provider === 'anthropic') {
        currentMessages.push(buildAnthropicToolResults(toolResultEntries));
      } else if (provider === 'openai' || provider === 'mistral' || provider === 'local') {
        currentMessages.push(...buildOpenAIToolResults(toolResultEntries));
      } else if (provider === 'gemini') {
        // Gemini: add function responses as user messages
        for (const tr of toolResultEntries) {
          currentMessages.push({
            role: 'user',
            content: `Tool "${tr.name}" returned: ${tr.content}`,
          });
        }
      }
    }

    await stream.writeSSE({ data: JSON.stringify({ type: 'error', error: 'Tool call limit reached' }) });
  });
});

export default app;
