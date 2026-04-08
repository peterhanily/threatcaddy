/**
 * CaddyAgent Meeting — orchestrates a collaborative discussion between
 * deployed agents. Each agent contributes in turn, and a meeting minutes
 * note is produced at the end.
 */

import { db } from '../db';
import { nanoid } from 'nanoid';
import type { AgentDeployment, AgentMeeting, AgentProfile, ChatThread, ChatMessage, Folder, Settings, ContentBlock, ToolUseBlock, LLMProvider } from '../types';
import { TOOL_DEFINITIONS } from './llm-tool-defs';
import { buildSystemPrompt } from './llm-tools';
import { resolveRoutingMode, sendViaExtension, sendViaServer } from './llm-router';
import { BUILTIN_AGENT_PROFILES } from './builtin-agent-profiles';

export interface AgentMeetingResult {
  meetingId: string;
  threadId: string;
  minutesNoteId?: string;
  roundsCompleted: number;
  error?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────

const LLM_TIMEOUT_MS = 120_000;
/** Max chars across all conversation messages before oldest are trimmed (keeps ~50k tokens) */
const CONVERSATION_BUDGET_CHARS = 200_000;

function getApiKeyForProvider(provider: LLMProvider, settings: Settings): string | undefined {
  switch (provider) {
    case 'anthropic': return settings.llmAnthropicApiKey?.trim();
    case 'openai':    return settings.llmOpenAIApiKey?.trim();
    case 'gemini':    return settings.llmGeminiApiKey?.trim();
    case 'mistral':   return settings.llmMistralApiKey?.trim();
    case 'local':     return settings.llmLocalApiKey?.trim() || 'local';
    default:          return undefined;
  }
}

function callLLM(opts: {
  provider: LLMProvider;
  model: string;
  messages: { role: 'user' | 'assistant'; content: string | ContentBlock[] }[];
  apiKey: string;
  systemPrompt: string;
  tools?: typeof TOOL_DEFINITIONS;
  useServerProxy: boolean;
  endpoint?: string;
}): Promise<{ content: string; toolCalls: ToolUseBlock[] }> {
  const llmPromise = new Promise<{ content: string; toolCalls: ToolUseBlock[] }>((resolve, reject) => {
    let accumulated = '';
    const request = {
      provider: opts.provider,
      model: opts.model,
      messages: opts.messages as unknown[],
      apiKey: opts.apiKey,
      systemPrompt: opts.systemPrompt,
      tools: opts.tools,
      endpoint: opts.endpoint,
    };
    const callbacks = {
      onChunk: (content: string) => { if (accumulated.length < 200_000) accumulated += content; },
      onDone: (_stopReason: string, contentBlocks: unknown[]) => {
        const blocks = contentBlocks as ContentBlock[];
        const toolCalls = blocks.filter(
          (b): b is ToolUseBlock => b.type === 'tool_use' && !!b.id && !!b.name && typeof b.input === 'object'
        );
        resolve({ content: accumulated, toolCalls });
      },
      onError: (error: string) => reject(new Error(error || 'LLM request failed')),
    };
    if (opts.useServerProxy) sendViaServer(request, callbacks);
    else sendViaExtension(request, callbacks);
  });

  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Meeting LLM call timed out')), LLM_TIMEOUT_MS);
  });

  return Promise.race([llmPromise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

async function resolveProfile(profileId: string): Promise<AgentProfile | undefined> {
  const userProfile = await db.agentProfiles.get(profileId);
  if (userProfile) return userProfile;
  return BUILTIN_AGENT_PROFILES.find(p => p.id === profileId);
}

// ── Meeting Orchestrator ────────────────────────────────────────────────

const DEFAULT_MAX_ROUNDS = 3;

/**
 * Run an agent meeting: agents discuss in turn, then produce meeting minutes.
 */
export async function runAgentMeeting(
  folder: Folder,
  deployments: AgentDeployment[],
  settings: Settings,
  extensionAvailable: boolean,
  agenda: string,
  maxRounds?: number,
  onProgress?: (speaker: string, status: string) => void,
): Promise<AgentMeetingResult> {
  const rounds = maxRounds || DEFAULT_MAX_ROUNDS;

  // Resolve provider (same fallback as agent cycle)
  const serverConnected = !!settings.serverUrl;
  const routingMode = resolveRoutingMode(settings.llmRoutingMode, extensionAvailable, serverConnected);
  const useServerProxy = routingMode === 'server';

  let provider = (settings.llmDefaultProvider || 'anthropic') as LLMProvider;
  let model = settings.llmDefaultModel || 'claude-sonnet-4-6';

  // Fallback to first provider with a key
  if (!useServerProxy && !getApiKeyForProvider(provider, settings)) {
    const providers: { p: LLMProvider; key: keyof Settings }[] = [
      { p: 'anthropic', key: 'llmAnthropicApiKey' }, { p: 'openai', key: 'llmOpenAIApiKey' },
      { p: 'gemini', key: 'llmGeminiApiKey' }, { p: 'mistral', key: 'llmMistralApiKey' },
    ];
    for (const { p, key } of providers) {
      if ((settings[key] as string | undefined)?.trim()) { provider = p; model = settings.llmDefaultModel || 'claude-sonnet-4-6'; break; }
    }
    if (settings.llmLocalEndpoint?.trim()) { provider = 'local'; model = settings.llmLocalModelName || 'llama3'; }
  }

  const apiKey = useServerProxy ? 'server-proxy' : (getApiKeyForProvider(provider, settings) || '');
  if (!useServerProxy && !apiKey) {
    return { meetingId: '', threadId: '', roundsCompleted: 0, error: `No API key configured for ${provider}` };
  }
  const endpoint = provider === 'local' ? settings.llmLocalEndpoint : undefined;

  // Resolve profiles for each deployment
  const participants: { deployment: AgentDeployment; profile: AgentProfile }[] = [];
  for (const d of deployments) {
    const profile = await resolveProfile(d.profileId);
    if (profile) participants.push({ deployment: d, profile });
  }

  // Sort by priority (lower = speaks first), cap at 8 to limit LLM calls
  participants.sort((a, b) => (a.profile.priority ?? 99) - (b.profile.priority ?? 99));
  const MAX_MEETING_PARTICIPANTS = 8;
  if (participants.length > MAX_MEETING_PARTICIPANTS) {
    participants.length = MAX_MEETING_PARTICIPANTS;
  }

  if (participants.length < 2) {
    return { meetingId: '', threadId: '', roundsCompleted: 0, error: 'Need at least 2 agents for a meeting' };
  }

  // Create meeting thread
  const threadId = nanoid();
  const thread: ChatThread = {
    id: threadId,
    title: `Meeting: ${agenda.substring(0, 60)}`,
    messages: [],
    model,
    provider,
    folderId: folder.id,
    tags: ['agent-meeting'],
    source: 'agent-meeting',
    trashed: false,
    archived: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await db.chatThreads.add(thread);

  // Create meeting record
  const meetingId = nanoid();
  const meeting: AgentMeeting = {
    id: meetingId,
    investigationId: folder.id,
    participantDeploymentIds: participants.map(p => p.deployment.id),
    threadId,
    agenda,
    status: 'in-progress',
    roundsCompleted: 0,
    maxRounds: rounds,
    createdAt: Date.now(),
  };
  await db.agentMeetings.add(meeting);

  const baseContext = await buildSystemPrompt(folder, settings.llmSystemPrompt, provider);

  try {
    // Build conversation in the shared thread
    const conversationMessages: { role: 'user' | 'assistant'; content: string | ContentBlock[] }[] = [];

    // Initial agenda message
    const agendaMsg = `Meeting Agenda: ${agenda}\n\nParticipants: ${participants.map(p => `${p.profile.icon || ''} ${p.profile.name} (${p.profile.role})`).join(', ')}\n\nEach participant will share their perspective. Be concise and constructive. Build on what others have said. If you have nothing new to add, say "No further input."`;

    conversationMessages.push({ role: 'user', content: agendaMsg });

    // Add agenda to thread
    const agendaChatMsg: ChatMessage = {
      id: nanoid(),
      role: 'user',
      content: agendaMsg,
      createdAt: Date.now(),
    };
    await db.chatThreads.where('id').equals(threadId).modify((t: ChatThread) => {
      t.messages.push(agendaChatMsg);
      t.updatedAt = Date.now();
    });

    // Rounds
    let completedRounds = 0;
    for (let round = 0; round < rounds; round++) {
      let anyNewInput = false;

      // Trim oldest messages if conversation exceeds budget (keep first 2 + latest)
      const totalChars = conversationMessages.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : 200), 0);
      if (totalChars > CONVERSATION_BUDGET_CHARS && conversationMessages.length > 6) {
        const keep = Math.max(6, Math.floor(conversationMessages.length / 2));
        conversationMessages.splice(2, conversationMessages.length - keep);
      }

      for (const { profile } of participants) {
        onProgress?.(profile.name, `Round ${round + 1}/${rounds}`);

        try {
          const systemPrompt = `${baseContext}

## Meeting Context

You are **${profile.name}** (${profile.role}), participating in a team meeting about this investigation.

Your expertise: ${profile.description || profile.systemPrompt.substring(0, 200)}

Rules:
- Be concise — 2-4 paragraphs max per contribution.
- Build on what others have said. Don't repeat points already made.
- If you have nothing new to add, say exactly: "No further input."
- Focus on your area of expertise.
- Propose concrete next steps when possible.`;

          const response = await callLLM({
            provider, model,
            messages: conversationMessages,
            apiKey, systemPrompt,
            useServerProxy, endpoint,
          });

          const content = `**${profile.icon || ''} ${profile.name}:** ${response.content}`;

          // Add to conversation
          conversationMessages.push({ role: 'assistant', content });
          conversationMessages.push({ role: 'user', content: 'Next participant, please share your perspective.' });

          // Add to thread
          const chatMsg: ChatMessage = {
            id: nanoid(),
            role: 'assistant',
            content,
            createdAt: Date.now(),
          };
          await db.chatThreads.where('id').equals(threadId).modify((t: ChatThread) => {
            t.messages.push(chatMsg);
            t.updatedAt = Date.now();
          });

          // Check if this agent had anything new to say
          if (!response.content.toLowerCase().includes('no further input')) {
            anyNewInput = true;
          }
        } catch (err) {
          console.error(`[meeting] Agent ${profile.name} failed in round ${round + 1}:`, err);
          const errorContent = `**${profile.icon || ''} ${profile.name}:** _(failed to respond: ${(err as Error).message?.substring(0, 100) || 'unknown error'})_`;
          conversationMessages.push({ role: 'assistant', content: errorContent });
        }
      }

      completedRounds = round + 1;
      await db.agentMeetings.update(meetingId, { roundsCompleted: completedRounds });

      // If nobody had new input, end early
      if (!anyNewInput) break;
    }

    // Generate meeting minutes using the lead agent (or first participant)
    onProgress?.('Meeting', 'Generating minutes...');

    const leadProfile = participants.find(p => p.profile.role === 'executive' || p.profile.role === 'lead')?.profile || participants[0].profile;

    const minutesPrompt = `The meeting has concluded after ${completedRounds} round(s). As ${leadProfile.name}, write concise meeting minutes in markdown format:

## Meeting Minutes — ${new Date().toISOString().split('T')[0]}

**Agenda:** ${agenda}
**Participants:** [list names]

### Key Points
[bullet points of main discussion items]

### Decisions
[any decisions made]

### Action Items
[specific next steps with assigned agent]

### Open Questions
[unresolved items]`;

    conversationMessages.push({ role: 'user', content: minutesPrompt });

    const minutesResponse = await callLLM({
      provider, model,
      messages: conversationMessages,
      apiKey,
      systemPrompt: `${baseContext}\n\nYou are ${leadProfile.name}. Write clear, structured meeting minutes.`,
      useServerProxy, endpoint,
    });

    // Create minutes note
    const noteId = nanoid();
    const now = Date.now();
    await db.notes.add({
      id: noteId,
      title: `Meeting Minutes: ${agenda.substring(0, 60)}`,
      content: minutesResponse.content,
      folderId: folder.id,
      tags: ['agent-meeting', 'meeting-minutes'],
      pinned: false,
      archived: false,
      trashed: false,
      createdBy: `agent:${leadProfile.id}`,
      createdAt: now,
      updatedAt: now,
    });

    // Update meeting record
    await db.agentMeetings.update(meetingId, {
      status: 'completed',
      minutesNoteId: noteId,
      roundsCompleted: completedRounds,
      completedAt: Date.now(),
    });

    return { meetingId, threadId, minutesNoteId: noteId, roundsCompleted: completedRounds };
  } catch (err) {
    await db.agentMeetings.update(meetingId, { status: 'failed' });
    return { meetingId, threadId, roundsCompleted: 0, error: String((err as Error).message || err) };
  }
}

/**
 * Run a shift handoff call — outgoing agents brief incoming agents.
 * After the call, outgoing agents are set to 'resting' and incoming to 'active'.
 */
export async function runHandoffCall(
  folder: Folder,
  outgoing: AgentDeployment[],
  incoming: AgentDeployment[],
  settings: Settings,
  extensionAvailable: boolean,
  onProgress?: (speaker: string, status: string) => void,
): Promise<AgentMeetingResult> {
  const allDeployments = [...outgoing, ...incoming];
  const agenda = `Shift handoff: ${outgoing.length} agent(s) going off-shift brief ${incoming.length} agent(s) coming on-shift.`;

  // Run the meeting with a handoff-specific agenda
  const result = await runAgentMeeting(
    folder, allDeployments, settings, extensionAvailable,
    agenda, 2, // 2 rounds: outgoing briefs, incoming asks questions
    onProgress,
  );

  // After meeting completes, toggle shift states
  for (const d of outgoing) {
    await db.agentDeployments.update(d.id, { shift: 'resting', updatedAt: Date.now() });
  }
  for (const d of incoming) {
    await db.agentDeployments.update(d.id, { shift: 'active', shiftStartedAt: Date.now(), updatedAt: Date.now() });
  }

  return result;
}
