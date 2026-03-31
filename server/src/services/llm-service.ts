import type { LLMChatRequest } from '../types.js';

export interface LLMUsageData {
  inputTokens: number;
  outputTokens: number;
}

interface StreamCallbacks {
  onChunk: (text: string) => void;
  onDone: (stopReason: string, contentBlocks?: unknown[], usage?: LLMUsageData) => void;
  onError: (error: string) => void;
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

async function streamAnthropic(req: LLMChatRequest, cb: StreamCallbacks, signal: AbortSignal) {
  const apiKey = getApiKey('anthropic');
  if (!apiKey) { cb.onError('ANTHROPIC_API_KEY not configured'); return; }

  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: 4096,
    messages: req.messages,
    stream: true,
  };
  if (req.systemPrompt) body.system = req.systemPrompt;
  if (req.tools && req.tools.length > 0) body.tools = req.tools;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) {
    const errText = await resp.text();
    cb.onError(`Anthropic API error ${resp.status}: ${errText}`);
    return;
  }

  const reader = resp.body?.getReader();
  if (!reader) { cb.onError('No response body'); return; }
  const decoder = new TextDecoder();
  let buffer = '';
  let stopReason = 'end_turn';
  const contentBlocks: unknown[] = [];
  let currentBlockIndex = -1;
  const usage: LLMUsageData = { inputTokens: 0, outputTokens: 0 };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      try {
        const event = JSON.parse(data);
        if (event.type === 'message_start' && event.message?.usage) {
          usage.inputTokens = event.message.usage.input_tokens || 0;
        }
        if (event.type === 'content_block_start') {
          currentBlockIndex = event.index;
          const block = event.content_block;
          if (block.type === 'text') contentBlocks[currentBlockIndex] = { type: 'text', text: '' };
          else if (block.type === 'tool_use') contentBlocks[currentBlockIndex] = { type: 'tool_use', id: block.id, name: block.name, input: '' };
        }
        if (event.type === 'content_block_delta') {
          const block = contentBlocks[event.index] as Record<string, unknown> | undefined;
          if (event.delta?.type === 'text_delta' && event.delta.text) {
            if (block) (block as { text: string }).text += event.delta.text;
            cb.onChunk(event.delta.text);
          } else if (event.delta?.type === 'input_json_delta' && event.delta.partial_json) {
            if (block) (block as { input: string }).input += event.delta.partial_json;
          }
        }
        if (event.type === 'content_block_stop') {
          const block = contentBlocks[event.index] as Record<string, unknown> | undefined;
          if (block && block.type === 'tool_use' && typeof block.input === 'string') {
            try { block.input = JSON.parse(block.input as string); } catch { block.input = {}; }
          }
        }
        if (event.type === 'message_delta') {
          if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
          if (event.usage?.output_tokens) usage.outputTokens = event.usage.output_tokens;
        }
      } catch { /* skip malformed JSON */ }
    }
  }

  cb.onDone(stopReason, contentBlocks, usage.inputTokens > 0 ? usage : undefined);
}

async function streamOpenAI(req: LLMChatRequest, cb: StreamCallbacks, signal: AbortSignal) {
  const apiKey = getApiKey('openai');
  if (!apiKey) { cb.onError('OPENAI_API_KEY not configured'); return; }

  const messages = req.systemPrompt
    ? [{ role: 'system', content: req.systemPrompt }, ...req.messages]
    : req.messages;

  const body: Record<string, unknown> = {
    model: req.model,
    messages,
    stream: true,
    max_tokens: 4096,
  };
  if (req.tools && req.tools.length > 0) body.tools = req.tools;

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) {
    const errText = await resp.text();
    cb.onError(`OpenAI API error ${resp.status}: ${errText}`);
    return;
  }

  const reader = resp.body?.getReader();
  if (!reader) { cb.onError('No response body'); return; }
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') { cb.onDone('end_turn', [], undefined); return; }
      try {
        const event = JSON.parse(data);
        const delta = event.choices?.[0]?.delta;
        if (delta?.content) cb.onChunk(delta.content);
      } catch { /* skip */ }
    }
  }

  cb.onDone('end_turn', [], undefined);
}

async function streamGemini(req: LLMChatRequest, cb: StreamCallbacks, signal: AbortSignal) {
  const apiKey = getApiKey('gemini');
  if (!apiKey) { cb.onError('GEMINI_API_KEY not configured'); return; }

  const contents = req.messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
  }));

  const body: Record<string, unknown> = {
    contents,
    generationConfig: { maxOutputTokens: 4096 },
  };
  if (req.systemPrompt) {
    body.systemInstruction = { parts: [{ text: req.systemPrompt }] };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${req.model}:streamGenerateContent?key=${apiKey}&alt=sse`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) {
    const errText = await resp.text();
    cb.onError(`Gemini API error ${resp.status}: ${errText}`);
    return;
  }

  const reader = resp.body?.getReader();
  if (!reader) { cb.onError('No response body'); return; }
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      try {
        const event = JSON.parse(data);
        const text = event.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) cb.onChunk(text);
      } catch { /* skip */ }
    }
  }

  cb.onDone('end_turn', [], undefined);
}

async function streamMistral(req: LLMChatRequest, cb: StreamCallbacks, signal: AbortSignal) {
  const apiKey = getApiKey('mistral');
  if (!apiKey) { cb.onError('MISTRAL_API_KEY not configured'); return; }

  const messages = req.systemPrompt
    ? [{ role: 'system', content: req.systemPrompt }, ...req.messages]
    : req.messages;

  const resp = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: req.model,
      messages,
      stream: true,
      max_tokens: 4096,
    }),
    signal,
  });

  if (!resp.ok) {
    const errText = await resp.text();
    cb.onError(`Mistral API error ${resp.status}: ${errText}`);
    return;
  }

  const reader = resp.body?.getReader();
  if (!reader) { cb.onError('No response body'); return; }
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') { cb.onDone('end_turn', [], undefined); return; }
      try {
        const event = JSON.parse(data);
        const delta = event.choices?.[0]?.delta;
        if (delta?.content) cb.onChunk(delta.content);
      } catch { /* skip */ }
    }
  }

  cb.onDone('end_turn', [], undefined);
}

export async function streamLLM(
  req: LLMChatRequest,
  callbacks: StreamCallbacks,
  signal: AbortSignal
): Promise<void> {
  const provider = req.provider;

  switch (provider) {
    case 'anthropic':
      return streamAnthropic(req, callbacks, signal);
    case 'openai':
      return streamOpenAI(req, callbacks, signal);
    case 'gemini':
      return streamGemini(req, callbacks, signal);
    case 'mistral':
      return streamMistral(req, callbacks, signal);
    default:
      callbacks.onError(`Unsupported provider: ${provider}`);
  }
}

export function getAvailableProviders(): Array<{ provider: string; models: string[] }> {
  const providers: Array<{ provider: string; models: string[] }> = [];

  if (process.env.ANTHROPIC_API_KEY) {
    providers.push({
      provider: 'anthropic',
      models: ['claude-sonnet-4-20250514', 'claude-haiku-4-20250414'],
    });
  }
  if (process.env.OPENAI_API_KEY) {
    providers.push({
      provider: 'openai',
      models: ['gpt-5.4', 'gpt-5.4-pro', 'gpt-5.2', 'gpt-5-mini', 'o3', 'o4-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini'],
    });
  }
  if (process.env.GEMINI_API_KEY) {
    providers.push({
      provider: 'gemini',
      models: ['gemini-2.0-flash', 'gemini-2.0-flash-lite'],
    });
  }
  if (process.env.MISTRAL_API_KEY) {
    providers.push({
      provider: 'mistral',
      models: ['mistral-large-latest', 'mistral-small-latest'],
    });
  }

  return providers;
}
