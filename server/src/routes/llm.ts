import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { nanoid } from 'nanoid';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { streamLLM, getAvailableProviders } from '../services/llm-service.js';
import type { AuthUser, LLMChatRequest } from '../types.js';
import { db } from '../db/index.js';
import { llmUsage, serverSettings } from '../db/schema.js';
import { eq, desc, and, gte } from 'drizzle-orm';
import { logger } from '../lib/logger.js';

const app = new Hono<{ Variables: { user: AuthUser } }>();

app.use('*', requireAuth);

// POST /api/llm/chat — SSE streaming response with usage tracking
app.post('/chat', requireRole('admin', 'analyst'), async (c) => {
  const user = c.get('user');
  const startTime = Date.now();

  const rawText = await c.req.text();
  if (rawText.length > 200 * 1024) {
    return c.json({ error: 'Request body too large (max 200KB)' }, 400);
  }

  let body: LLMChatRequest;
  try {
    body = JSON.parse(rawText) as LLMChatRequest;
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.provider || !body.model || !body.messages) {
    return c.json({ error: 'Missing required fields: provider, model, messages' }, 400);
  }

  if (!Array.isArray(body.messages) || body.messages.length > 200) {
    return c.json({ error: 'Messages must be an array with at most 200 entries' }, 400);
  }

  // Apply prompt rules: check blocked patterns
  try {
    const rulesRow = await db.select().from(serverSettings).where(eq(serverSettings.key, 'llm_blocked_patterns'));
    if (rulesRow[0]?.value) {
      const patterns = JSON.parse(rulesRow[0].value) as string[];
      const lastUserMsg = [...body.messages].reverse().find(m => m.role === 'user');
      const userText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : JSON.stringify(lastUserMsg?.content);
      for (const pattern of patterns) {
        if (new RegExp(pattern, 'i').test(userText)) {
          return c.json({ error: 'Message blocked by server policy' }, 403);
        }
      }
    }
  } catch { /* no rules configured, proceed */ }

  // Apply prompt prefix from server settings
  let systemPrompt = body.systemPrompt;
  try {
    const prefixRow = await db.select().from(serverSettings).where(eq(serverSettings.key, 'llm_prompt_prefix'));
    if (prefixRow[0]?.value) {
      systemPrompt = prefixRow[0].value + '\n\n' + (systemPrompt || '');
    }
  } catch { /* no prefix configured */ }

  return streamSSE(c, async (stream) => {
    const controller = new AbortController();

    c.req.raw.signal.addEventListener('abort', () => {
      controller.abort();
    });

    await streamLLM({ ...body, systemPrompt }, {
      onChunk: (text) => {
        stream.writeSSE({ data: JSON.stringify({ type: 'chunk', content: text }) });
      },
      onDone: (stopReason, contentBlocks, usage) => {
        stream.writeSSE({ data: JSON.stringify({ type: 'done', stopReason, contentBlocks: contentBlocks || [], usage: usage || null }) });

        // Track usage asynchronously
        const latencyMs = Date.now() - startTime;
        db.insert(llmUsage).values({
          id: nanoid(),
          userId: user.id,
          provider: body.provider,
          model: body.model,
          inputTokens: usage?.inputTokens || 0,
          outputTokens: usage?.outputTokens || 0,
          latencyMs,
          threadId: null,
        }).catch((err) => logger.error('Failed to log LLM usage', err));
      },
      onError: (error) => {
        stream.writeSSE({ data: JSON.stringify({ type: 'error', error }) });
      },
    }, controller.signal);
  });
});

// GET /api/llm/config — available providers (no keys exposed)
app.get('/config', async (c) => {
  const providers = getAvailableProviders();
  return c.json({ providers });
});

// GET /api/llm/usage — user's LLM usage stats
app.get('/usage', async (c) => {
  const user = c.get('user');
  const since = c.req.query('since'); // ISO date string

  try {
    const conditions = [eq(llmUsage.userId, user.id)];
    if (since) conditions.push(gte(llmUsage.createdAt, new Date(since)));
    const rows = await db.select().from(llmUsage)
      .where(and(...conditions))
      .orderBy(desc(llmUsage.createdAt))
      .limit(100);

    const totals = rows.reduce((acc, r) => ({
      inputTokens: acc.inputTokens + r.inputTokens,
      outputTokens: acc.outputTokens + r.outputTokens,
      requests: acc.requests + 1,
    }), { inputTokens: 0, outputTokens: 0, requests: 0 });

    return c.json({ usage: rows, totals });
  } catch {
    return c.json({ error: 'Failed to fetch usage' }, 500);
  }
});

export default app;
