import { logger } from '../../lib/logger.js';
import { BotExecutionContext } from '../bot-context.js';
import { getToolsForCapabilities, toAnthropicTools, toOpenAITools } from '../bot-tools.js';
import type { BotTool } from '../bot-tools.js';
import type { BotContext, BotEvent } from '../types.js';
import { GenericBot } from './generic-bot.js';

const DEFAULT_MAX_ITERATIONS = 10;
const MAX_RESPONSE_TOKENS = 4096;

/**
 * AgentBot: LLM-powered bot that runs a tool-calling loop.
 *
 * On each trigger (event, schedule, webhook), it:
 * 1. Builds a system prompt from config + trigger context
 * 2. Sends messages to the configured LLM with available tools
 * 3. If the LLM returns tool_use, executes the tools and sends results back
 * 4. Repeats until the LLM stops calling tools or max iterations reached
 *
 * Tools are auto-generated from the bot's capabilities — only tools the bot
 * is authorized to use are offered to the LLM.
 */
export class AgentBot extends GenericBot {

  protected override async handleEvent(execCtx: BotExecutionContext, event: BotEvent): Promise<void> {
    const triggerContext = [
      `Event triggered: ${event.type}`,
      event.table ? `Entity table: ${event.table}` : null,
      event.entityId ? `Entity ID: ${event.entityId}` : null,
      event.folderId ? `Investigation folder ID: ${event.folderId}` : null,
      event.data ? `Entity data:\n${JSON.stringify(event.data, null, 2)}` : null,
    ].filter(Boolean).join('\n');

    await this.runAgentLoop(execCtx, triggerContext);
  }

  protected override async handleSchedule(execCtx: BotExecutionContext): Promise<void> {
    await this.runAgentLoop(execCtx, 'Scheduled trigger — perform your configured periodic task.');
  }

  protected override async handleWebhook(execCtx: BotExecutionContext, payload: Record<string, unknown>): Promise<void> {
    const triggerContext = `Webhook received with payload:\n${JSON.stringify(payload, null, 2)}`;
    await this.runAgentLoop(execCtx, triggerContext);
  }

  private async runAgentLoop(execCtx: BotExecutionContext, triggerContext: string): Promise<void> {
    const botConfig = this.config;
    const agentConfig = execCtx.getConfig();

    const provider = (agentConfig.llmProvider as string) || 'anthropic';
    const model = (agentConfig.llmModel as string) || 'claude-sonnet-4-20250514';
    const customSystemPrompt = (agentConfig.systemPrompt as string) || '';
    const maxIterations = Math.min(
      (agentConfig.maxIterations as number) || DEFAULT_MAX_ITERATIONS,
      25, // hard cap
    );

    const apiKey = this.getApiKey(provider);
    if (!apiKey) {
      throw new Error(`No API key configured for LLM provider "${provider}". Set the corresponding env var.`);
    }

    // Build tools from capabilities
    const tools = getToolsForCapabilities(botConfig.capabilities);
    if (tools.length === 0) {
      throw new Error(`AgentBot "${botConfig.name}" has no capabilities — no tools available for the LLM.`);
    }
    const toolMap = new Map(tools.map(t => [t.name, t]));

    // System prompt
    const systemPrompt = this.buildSystemPrompt(customSystemPrompt, tools);

    // Initial user message with trigger context
    const messages: Array<{ role: string; content: string | unknown[] }> = [
      { role: 'user', content: triggerContext },
    ];

    // Agent loop
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      // Check abort before each LLM call
      if (botConfig.capabilities.length === 0) break; // safety

      const response = await this.callLLM(provider, model, apiKey, systemPrompt, messages, tools);

      if (provider === 'anthropic') {
        const result = await this.handleAnthropicResponse(response, toolMap, execCtx, messages);
        if (!result.continueLoop) break;
      } else if (provider === 'openai') {
        const result = await this.handleOpenAIResponse(response, toolMap, execCtx, messages);
        if (!result.continueLoop) break;
      } else {
        // For other providers, just take the text response — no tool calling
        const text = this.extractTextResponse(response, provider);
        if (text) {
          await execCtx.audit('agent.response', `Agent response: ${text.slice(0, 500)}`);
        }
        break;
      }
    }
  }

  private buildSystemPrompt(customPrompt: string, tools: BotTool[]): string {
    const toolNames = tools.map(t => t.name).join(', ');
    const parts = [
      `You are "${this.config.name}", an AI agent bot in ThreatCaddy, a threat intelligence and investigation platform.`,
      this.config.description ? `Your purpose: ${this.config.description}` : null,
      `Available tools: ${toolNames}`,
      `Scope: ${this.config.scopeType === 'global' ? 'All investigations' : `Investigations: ${this.config.scopeFolderIds.join(', ')}`}`,
      '',
      'Guidelines:',
      '- Use tools to gather information before making conclusions.',
      '- Create entities (notes, IOCs, tasks, timeline events) to record your findings.',
      '- Be precise and actionable in your outputs.',
      '- If you lack information, say so rather than guessing.',
      '- Stop when your task is complete — do not loop unnecessarily.',
      customPrompt ? `\nCustom Instructions:\n${customPrompt}` : null,
    ];
    return parts.filter(Boolean).join('\n');
  }

  private getApiKey(provider: string): string {
    switch (provider) {
      case 'anthropic': return process.env.ANTHROPIC_API_KEY || '';
      case 'openai': return process.env.OPENAI_API_KEY || '';
      case 'gemini': return process.env.GEMINI_API_KEY || '';
      case 'mistral': return process.env.MISTRAL_API_KEY || '';
      default: return '';
    }
  }

  private async callLLM(
    provider: string,
    model: string,
    apiKey: string,
    systemPrompt: string,
    messages: Array<{ role: string; content: string | unknown[] }>,
    tools: BotTool[],
  ): Promise<unknown> {
    if (provider === 'anthropic') {
      return this.callAnthropic(model, apiKey, systemPrompt, messages, tools);
    } else if (provider === 'openai') {
      return this.callOpenAI(model, apiKey, systemPrompt, messages, tools);
    }
    // Fallback for non-tool-calling providers: just get text
    return this.callGenericLLM(provider, model, apiKey, systemPrompt, messages);
  }

  private async callAnthropic(
    model: string,
    apiKey: string,
    systemPrompt: string,
    messages: Array<{ role: string; content: string | unknown[] }>,
    tools: BotTool[],
  ): Promise<unknown> {
    const body: Record<string, unknown> = {
      model,
      max_tokens: MAX_RESPONSE_TOKENS,
      system: systemPrompt,
      messages,
      tools: toAnthropicTools(tools),
    };

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Anthropic API error ${resp.status}: ${errText}`);
    }

    return resp.json();
  }

  private async callOpenAI(
    model: string,
    apiKey: string,
    systemPrompt: string,
    messages: Array<{ role: string; content: string | unknown[] }>,
    tools: BotTool[],
  ): Promise<unknown> {
    const openaiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        ...(m.role === 'assistant' && typeof m.content !== 'string' ? { tool_calls: (m as Record<string, unknown>).tool_calls } : {}),
        ...(m.role === 'tool' ? { tool_call_id: (m as Record<string, unknown>).tool_call_id } : {}),
      })),
    ];

    const body: Record<string, unknown> = {
      model,
      messages: openaiMessages,
      tools: toOpenAITools(tools),
      max_tokens: MAX_RESPONSE_TOKENS,
    };

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`OpenAI API error ${resp.status}: ${errText}`);
    }

    return resp.json();
  }

  private async callGenericLLM(
    provider: string,
    model: string,
    apiKey: string,
    systemPrompt: string,
    messages: Array<{ role: string; content: string | unknown[] }>,
  ): Promise<unknown> {
    // Simple text-only call for non-tool-calling providers
    if (provider === 'gemini') {
      const contents = messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
      }));
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents, systemInstruction: { parts: [{ text: systemPrompt }] } }),
        },
      );
      if (!resp.ok) throw new Error(`Gemini API error ${resp.status}: ${await resp.text()}`);
      return resp.json();
    }

    if (provider === 'mistral') {
      const allMessages = [{ role: 'system', content: systemPrompt }, ...messages];
      const resp = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: allMessages }),
      });
      if (!resp.ok) throw new Error(`Mistral API error ${resp.status}: ${await resp.text()}`);
      return resp.json();
    }

    throw new Error(`Unsupported LLM provider for agent bot: ${provider}`);
  }

  private async handleAnthropicResponse(
    response: unknown,
    toolMap: Map<string, BotTool>,
    execCtx: BotExecutionContext,
    messages: Array<{ role: string; content: string | unknown[] }>,
  ): Promise<{ continueLoop: boolean }> {
    const msg = response as {
      content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
      stop_reason: string;
    };

    // Append the full assistant response to messages
    messages.push({ role: 'assistant', content: msg.content });

    // Check if there are tool_use blocks
    const toolUseBlocks = msg.content.filter(b => b.type === 'tool_use');
    if (toolUseBlocks.length === 0) {
      // No tool calls — agent is done
      const textBlocks = msg.content.filter(b => b.type === 'text');
      if (textBlocks.length > 0) {
        const text = textBlocks.map(b => b.text).join('\n');
        await execCtx.audit('agent.response', text.slice(0, 500));
      }
      return { continueLoop: false };
    }

    // Execute each tool and collect results
    const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];
    for (const block of toolUseBlocks) {
      const tool = toolMap.get(block.name!);
      if (!tool) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id!,
          content: JSON.stringify({ error: `Unknown tool: ${block.name}` }),
        });
        continue;
      }

      try {
        const result = await tool.execute(block.input || {}, execCtx);
        const resultStr = JSON.stringify(result);
        // Truncate large results
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id!,
          content: resultStr.length > 20000 ? resultStr.slice(0, 20000) + '... [truncated]' : resultStr,
        });
        logger.info(`AgentBot "${this.name}" tool call: ${block.name}`, { botId: this.id });
      } catch (err) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id!,
          content: JSON.stringify({ error: String(err) }),
        });
        logger.warn(`AgentBot "${this.name}" tool error: ${block.name}`, { botId: this.id, error: String(err) });
      }
    }

    // Append tool results as a user message
    messages.push({ role: 'user', content: toolResults });

    return { continueLoop: msg.stop_reason === 'tool_use' };
  }

  private async handleOpenAIResponse(
    response: unknown,
    toolMap: Map<string, BotTool>,
    execCtx: BotExecutionContext,
    messages: Array<{ role: string; content: string | unknown[] }>,
  ): Promise<{ continueLoop: boolean }> {
    const resp = response as {
      choices: Array<{
        message: {
          role: string;
          content: string | null;
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
        };
        finish_reason: string;
      }>;
    };

    const choice = resp.choices[0];
    if (!choice) return { continueLoop: false };

    const assistantMsg = choice.message;
    const toolCalls = assistantMsg.tool_calls;

    if (!toolCalls || toolCalls.length === 0) {
      // No tool calls — agent is done
      if (assistantMsg.content) {
        messages.push({ role: 'assistant', content: assistantMsg.content });
        await execCtx.audit('agent.response', assistantMsg.content.slice(0, 500));
      }
      return { continueLoop: false };
    }

    // Append assistant message with tool_calls
    messages.push({
      role: 'assistant',
      content: assistantMsg.content || '',
      ...({ tool_calls: toolCalls } as Record<string, unknown>),
    } as { role: string; content: string | unknown[] });

    // Execute each tool and append results
    for (const tc of toolCalls) {
      const tool = toolMap.get(tc.function.name);
      let resultStr: string;

      if (!tool) {
        resultStr = JSON.stringify({ error: `Unknown tool: ${tc.function.name}` });
      } else {
        try {
          const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
          const result = await tool.execute(args, execCtx);
          resultStr = JSON.stringify(result);
          if (resultStr.length > 20000) resultStr = resultStr.slice(0, 20000) + '... [truncated]';
          logger.info(`AgentBot "${this.name}" tool call: ${tc.function.name}`, { botId: this.id });
        } catch (err) {
          resultStr = JSON.stringify({ error: String(err) });
          logger.warn(`AgentBot "${this.name}" tool error: ${tc.function.name}`, { botId: this.id, error: String(err) });
        }
      }

      messages.push({
        role: 'tool',
        content: resultStr,
        ...({ tool_call_id: tc.id } as Record<string, unknown>),
      } as { role: string; content: string | unknown[] });
    }

    return { continueLoop: choice.finish_reason === 'tool_calls' };
  }

  private extractTextResponse(response: unknown, provider: string): string {
    if (provider === 'gemini') {
      const r = response as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      return r.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }
    if (provider === 'mistral') {
      const r = response as { choices?: Array<{ message?: { content?: string } }> };
      return r.choices?.[0]?.message?.content || '';
    }
    return '';
  }
}
