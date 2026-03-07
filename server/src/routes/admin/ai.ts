import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { requireAdminAuth, logAdminAction, getAdminId } from './shared.js';
import { getAnthropicTools, getToolByName, ADMIN_AI_SYSTEM_PROMPT } from '../../services/admin-ai-service.js';
import { logger } from '../../lib/logger.js';

const app = new Hono();
const MAX_TOOL_CALLS = 20;

// POST /admin/api/ai/chat -- streaming AI chat
app.post('/api/ai/chat', requireAdminAuth, async (c) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return c.json({ error: 'ANTHROPIC_API_KEY not configured on server' }, 503);
  }

  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const { messages } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return c.json({ error: 'Messages array required' }, 400);
  }

  // Cap message count to prevent context abuse
  if (messages.length > 50) {
    return c.json({ error: 'Too many messages (max 50)' }, 400);
  }

  const adminId = getAdminId(c);
  const tools = getAnthropicTools();

  // Log the chat request
  await logAdminAction(adminId, 'ai-assistant.chat', `AI Assistant chat (${messages.length} messages)`);

  return streamSSE(c, async (stream) => {
    let toolCallCount = 0;
    const currentMessages = [...messages];

    // Agent loop -- keep calling Claude until no more tool_use
    while (toolCallCount < MAX_TOOL_CALLS) {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          system: ADMIN_AI_SYSTEM_PROMPT,
          messages: currentMessages,
          tools,
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        logger.error('Admin AI API error', { status: resp.status, error: errText });
        await stream.writeSSE({ data: JSON.stringify({ type: 'error', error: `API error: ${resp.status}` }) });
        return;
      }

      const result = await resp.json() as {
        content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
        stop_reason: string;
      };

      // Send text blocks to the client
      const textBlocks = result.content.filter(b => b.type === 'text');
      for (const block of textBlocks) {
        await stream.writeSSE({ data: JSON.stringify({ type: 'text', text: block.text }) });
      }

      // Check for tool_use blocks
      const toolUseBlocks = result.content.filter(b => b.type === 'tool_use');
      if (toolUseBlocks.length === 0) {
        // No tool calls -- we're done
        await stream.writeSSE({ data: JSON.stringify({ type: 'done', stopReason: result.stop_reason }) });
        return;
      }

      // Execute tools
      currentMessages.push({ role: 'assistant', content: result.content });

      const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];
      for (const block of toolUseBlocks) {
        toolCallCount++;
        const tool = getToolByName(block.name!);

        // Send tool call info to client
        await stream.writeSSE({ data: JSON.stringify({
          type: 'tool_call',
          name: block.name,
          input: block.input,
          requiresConfirm: tool?.requiresConfirm || false,
        }) });

        if (!tool) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id!,
            content: JSON.stringify({ error: `Unknown tool: ${block.name}` }),
          });
          continue;
        }

        try {
          const toolResult = await tool.execute(block.input || {}, adminId);
          const resultStr = JSON.stringify(toolResult);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id!,
            content: resultStr.length > 20000 ? resultStr.slice(0, 20000) + '...[truncated]' : resultStr,
          });

          // Send tool result to client
          await stream.writeSSE({ data: JSON.stringify({
            type: 'tool_result',
            name: block.name,
            result: resultStr.length > 5000 ? resultStr.slice(0, 5000) + '...' : toolResult,
          }) });
        } catch (err) {
          const errorMsg = String(err);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id!,
            content: JSON.stringify({ error: errorMsg }),
          });
          await stream.writeSSE({ data: JSON.stringify({ type: 'tool_error', name: block.name, error: errorMsg }) });
        }
      }

      currentMessages.push({ role: 'user', content: toolResults });
    }

    // Hit tool call limit
    await stream.writeSSE({ data: JSON.stringify({ type: 'error', error: 'Tool call limit reached' }) });
  });
});

export default app;
