import { Hono } from 'hono';
import { requireAdminAuth, logAdminAction, getAdminId } from './shared.js';
import { AdminAuthorizationError, getAdminAiPrincipal } from '../../middleware/admin-auth.js';
import { AdminAiApprovalError } from '../../services/admin-ai-approvals.js';
import {
  getAnthropicTools, getOpenAITools, getGeminiTools,
  getToolByName, dispatchAdminAiTool, assertCurrentAdminAiSession, ADMIN_AI_SYSTEM_PROMPT,
} from '../../services/admin-ai-service.js';
import { getAvailableProviders } from '../../services/llm-service.js';
import { getAiSettings, setAiSettings, type AiAssistantSettings } from '../../services/admin-secret.js';
import { logger } from '../../lib/logger.js';
import { parseAnthropicResponse, parseGeminiResponse, parseOpenAIResponse } from '../../lib/provider-response.js';
import { readBoundedBytes, readProviderJSON, withAbort } from '../../lib/bounded-http.js';
import { createBoundedSSE } from '../../lib/bounded-sse.js';

const app = new Hono();
const MAX_TOOL_CALLS = 20;
const MAX_CHAT_INPUT_BYTES = 128 * 1024;
const MAX_HISTORY_BYTES = 512 * 1024;

const historyWithinLimit = (messages: unknown[]): boolean => Buffer.byteLength(JSON.stringify(messages)) <= MAX_HISTORY_BYTES;

function providerErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  // Structural/limit messages are locally generated. Provider error bodies and
  // network exceptions can contain credentials or private prompt fragments.
  if (/^(Admin AI provider deadline exceeded|HTTP body exceeds \d+ bytes|Malformed [A-Za-z -]+ response: [A-Za-z ,_-]+)$/.test(message)) return message;
  const status = / API error (\d{3}):/.exec(message)?.[1];
  return status ? `AI provider request failed (HTTP ${status}).` : 'AI provider request failed.';
}

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
  if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ error: 'Settings must be an object' }, 400);

  const updates: Record<string, unknown> = {};

  if (body.localEndpoint !== undefined) {
    const ep = String(body.localEndpoint).trim().substring(0, 500);
    if (ep && !/^https?:\/\//.test(ep)) {
      return c.json({ error: 'Local endpoint must start with http:// or https://' }, 400);
    }
    updates.localEndpoint = ep;
  }
  if (body.localApiKey !== undefined && body.localApiKey !== '***configured***') {
    updates.localApiKey = String(body.localApiKey).substring(0, 500);
  }
  if (body.localModelName !== undefined) {
    updates.localModelName = String(body.localModelName).trim().substring(0, 200);
  }
  if (body.customSystemPrompt !== undefined) {
    updates.customSystemPrompt = String(body.customSystemPrompt).substring(0, 10000);
  }
  if (body.defaultProvider !== undefined) {
    updates.defaultProvider = String(body.defaultProvider).substring(0, 50);
  }
  if (body.defaultModel !== undefined) {
    updates.defaultModel = String(body.defaultModel).substring(0, 200);
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

interface ToolCall { id: string; name: string; input: Record<string, unknown> }
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

async function readAdminProvider(url: string, init: RequestInit, signal: AbortSignal, provider: string): Promise<unknown> {
  signal.throwIfAborted();
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new Error('Admin AI provider deadline exceeded')), 60_000);
  const combined = AbortSignal.any([signal, deadline.signal]);
  try {
    const response = await withAbort(fetch(url, { ...init, signal: combined }), combined);
    return await readProviderJSON(response, combined, provider);
  } finally {
    clearTimeout(timer);
  }
}

async function callAnthropic(model: string, messages: unknown[], apiKey: string, systemPrompt: string, temperature: number, signal: AbortSignal): Promise<LLMResult> {
  const result = await readAdminProvider('https://api.anthropic.com/v1/messages', {
    method: 'POST',
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
  }, signal, 'Anthropic');
  return parseAnthropicResponse(result);
}

function buildAnthropicToolResults(
  results: Array<{ id: string; content: string }>,
): { role: string; content: unknown } {
  return {
    role: 'user',
    content: results.map(r => ({ type: 'tool_result', tool_use_id: r.id, content: r.content })),
  };
}

async function callOpenAI(model: string, messages: unknown[], apiKey: string, provider: 'openai' | 'mistral', systemPrompt: string, temperature: number, signal: AbortSignal): Promise<LLMResult> {
  const url = provider === 'mistral'
    ? 'https://api.mistral.ai/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';

  // Prepend system message
  const allMessages = [{ role: 'system', content: systemPrompt }, ...(messages as Array<Record<string, unknown>>)];

  const result = await readAdminProvider(url, {
    method: 'POST',
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
  }, signal, provider);
  return parseOpenAIResponse(result);
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

async function callGemini(model: string, messages: unknown[], apiKey: string, systemPrompt: string, temperature: number, signal: AbortSignal): Promise<LLMResult> {
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

  const result = await readAdminProvider(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      tools: getGeminiTools(),
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: { temperature },
    }),
  }, signal, 'Gemini');
  return parseGeminiResponse(result);
}

async function callLocal(model: string, messages: unknown[], endpoint: string, apiKey: string, systemPrompt: string, temperature: number, signal: AbortSignal): Promise<LLMResult> {
  let parsedEndpoint: URL;
  try { parsedEndpoint = new URL(endpoint); } catch { throw new Error('Invalid local endpoint URL'); }
  if (parsedEndpoint.protocol !== 'http:' && parsedEndpoint.protocol !== 'https:') {
    throw new Error('Local endpoint must use http or https');
  }
  const url = parsedEndpoint.href.replace(/\/+$/, '') + '/chat/completions';

  const allMessages = [{ role: 'system', content: systemPrompt }, ...(messages as Array<Record<string, unknown>>)];

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const result = await readAdminProvider(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: allMessages,
      tools: getOpenAITools(),
      max_tokens: 4096,
      temperature,
    }),
  }, signal, 'Local LLM');
  return parseOpenAIResponse(result);
}

// ─── Unified agent loop ──────────────────────────────────────────

app.post('/api/ai/chat', requireAdminAuth, async (c) => {
  if (c.req.raw.signal.aborted) return c.json({ error: 'Request cancelled' }, 408);
  const preflightSignal = AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(10_000)]);
  let body;
  try {
    body = JSON.parse(new TextDecoder().decode(await readBoundedBytes(c.req.raw.body, MAX_CHAT_INPUT_BYTES, preflightSignal)));
  } catch { return c.json({ error: 'Invalid or oversized JSON body (maximum 128 KiB)' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ error: 'Chat request must be an object' }, 400);

  const { messages, provider: reqProvider, model: reqModel, confirmedToolCalls: confirmedRaw } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return c.json({ error: 'Messages array required' }, 400);
  }
  if (messages.length > 50) {
    return c.json({ error: 'Too many messages (max 50)' }, 400);
  }
  if (messages.some(message => !message || typeof message !== 'object' || Array.isArray(message)
    || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || message.content.length > 20_000
    || Object.keys(message).some(key => key !== 'role' && key !== 'content'))) {
    return c.json({ error: 'Messages must contain only a user/assistant role and text content (maximum 20,000 characters each)' }, 400);
  }
  if (confirmedRaw !== undefined && (!Array.isArray(confirmedRaw) || confirmedRaw.length)) {
    return c.json({ error: 'Tool-name preapproval is no longer supported. Approve the exact proposed action using its approval ID.' }, 400);
  }
  if ((reqProvider !== undefined && (typeof reqProvider !== 'string' || reqProvider.length > 50))
    || (reqModel !== undefined && (typeof reqModel !== 'string' || reqModel.length > 200))) {
    return c.json({ error: 'Invalid provider or model' }, 400);
  }
  const principal = getAdminAiPrincipal(c);
  if (preflightSignal.aborted) return c.json({ error: 'Request cancelled or timed out' }, 408);

  // Load AI settings for system prompt, temperature, defaults
  let aiSettings: AiAssistantSettings;
  try { aiSettings = await withAbort(getAiSettings(), preflightSignal); }
  catch { return c.json({ error: 'AI settings could not be loaded' }, 503); }

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

  const providerInfo = available.find(p => p.provider === provider);
  if (!providerInfo?.models.length) return c.json({ error: 'No model is available for this provider' }, 503);
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

  return createBoundedSSE(c.req.raw.signal, async ({ signal, send }) => {
    await assertCurrentAdminAiSession({ principal, signal });
    signal.throwIfAborted();
    await withAbort(logAdminAction(principal.adminId, 'ai-assistant.chat', `AI Assistant chat via ${provider} (${messages.length} messages)`), signal);
    let toolCallCount = 0;
    const currentMessages = [...messages];

    // Send provider info to client
    await send({ type: 'provider', provider, model });

    while (toolCallCount < MAX_TOOL_CALLS) {
      signal.throwIfAborted();
      if (!historyWithinLimit(currentMessages)) {
        await send({ type: 'error', error: 'AI conversation context limit reached. Start a new conversation.' });
        return;
      }
      await assertCurrentAdminAiSession({ principal, signal });
      let result: LLMResult;
      try {
        switch (provider) {
          case 'anthropic':
            result = await callAnthropic(model, currentMessages, apiKey, effectiveSystemPrompt, aiSettings.temperature, signal);
            break;
          case 'openai':
            result = await callOpenAI(model, currentMessages, apiKey, 'openai', effectiveSystemPrompt, aiSettings.temperature, signal);
            break;
          case 'mistral':
            result = await callOpenAI(model, currentMessages, apiKey, 'mistral', effectiveSystemPrompt, aiSettings.temperature, signal);
            break;
          case 'gemini':
            result = await callGemini(model, currentMessages, apiKey, effectiveSystemPrompt, aiSettings.temperature, signal);
            break;
          case 'local': {
            if (!aiSettings.localEndpoint) {
              await send({ type: 'error', error: 'Local LLM endpoint not configured' });
              return;
            }
            result = await callLocal(model, currentMessages, aiSettings.localEndpoint, aiSettings.localApiKey, effectiveSystemPrompt, aiSettings.temperature, signal);
            break;
          }
          default:
            await send({ type: 'error', error: `Unsupported provider: ${provider}` });
            return;
        }
      } catch (err) {
        if (signal.aborted) return;
        logger.warn('Admin AI provider request failed', { provider });
        await send({ type: 'error', error: providerErrorMessage(err) });
        return;
      }
      signal.throwIfAborted();
      // A provider request may outlive an admin session. Revalidate before any
      // response content (including a text-only answer) leaves the server.
      try {
        await assertCurrentAdminAiSession({ principal, signal });
      } catch (err) {
        if (signal.aborted) return;
        if (!(err instanceof AdminAuthorizationError)) throw err;
        await send({ type: 'error', error: 'Administrator session is no longer authorized. Sign in again.' });
        return;
      }

      // Reserve the complete batch before any dispatch. Checking only the outer
      // loop allows a single response to exceed the remaining per-chat budget.
      if (result.toolCalls.length > MAX_TOOL_CALLS - toolCallCount) {
        await send({ type: 'error', error: 'Tool call limit reached' });
        return;
      }
      if (!historyWithinLimit([...currentMessages, result.rawAssistantContent])) {
        await send({ type: 'error', error: 'AI conversation context limit reached. Start a new conversation.' });
        return;
      }

      // Send text to client
      for (const text of result.textParts) {
        await send({ type: 'text', text });
      }

      if (result.toolCalls.length === 0) {
        await send({ type: 'done', stopReason: result.stopReason });
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
        signal.throwIfAborted();
        toolCallCount++;
        const tool = getToolByName(tc.name);

        await send({
          type: 'tool_call', name: tc.name, input: tc.input,
          requiresConfirm: tool?.requiresConfirm || false,
        });

        if (!tool) {
          toolResultEntries.push({ id: tc.id, name: tc.name, content: JSON.stringify({ error: `Unknown tool: ${tc.name}` }) });
          continue;
        }

        try {
          signal.throwIfAborted();
          const dispatch = await dispatchAdminAiTool(tc.name, tc.input, { principal, signal });
          signal.throwIfAborted();
          if (dispatch.kind === 'approval') {
            await send({ type: 'confirmation_required', ...dispatch.approval });
            return; // No more tools or model calls until a separate exact decision.
          }
          const toolResult = dispatch.result;
          const resultStr = JSON.stringify(toolResult);
          toolResultEntries.push({
            id: tc.id,
            name: tc.name,
            content: resultStr.length > 20000 ? resultStr.slice(0, 20000) + '...[truncated]' : resultStr,
          });
          await send({
            type: 'tool_result', name: tc.name,
            result: resultStr.length > 5000 ? resultStr.slice(0, 5000) + '...' : toolResult,
          });
        } catch (err) {
          if (signal.aborted) return;
          if (err instanceof AdminAuthorizationError) {
            await send({ type: 'error', error: 'Administrator session is no longer authorized. Sign in again.' });
            return;
          }
          const errorMsg = err instanceof AdminAiApprovalError ? err.message.slice(0, 500) : 'The requested tool could not complete.';
          toolResultEntries.push({ id: tc.id, name: tc.name, content: JSON.stringify({ error: errorMsg }) });
          await send({ type: 'tool_error', name: tc.name, error: errorMsg });
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

    await send({ type: 'error', error: 'Tool call limit reached' });
  }, { onError: () => logger.warn('Admin AI stream failed') });
});

export default app;
