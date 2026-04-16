/**
 * CaddyAgent Meeting — orchestrates a collaborative discussion between
 * deployed agents. Each agent contributes in turn, and a meeting minutes
 * note is produced at the end.
 */

import { db } from '../db';
import { nanoid } from 'nanoid';
import type { AgentDeployment, AgentMeeting, AgentProfile, ChatThread, ChatMessage, Folder, Settings, ContentBlock, ToolUseBlock, LLMProvider, MeetingPurpose, MeetingStructuredOutput } from '../types';
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
  /** Structured artifact (when purpose is scoped). */
  structuredOutput?: MeetingStructuredOutput;
  /** Per-participant final confidence (1-5). */
  participantConfidence?: Record<string, number>;
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

/** Hard round cap. The MAD literature (arXiv 2509.05396, Free-MAD) shows
 *  accuracy degrades after ~2 rounds from sycophancy/conformity. 2 is the
 *  default for every meeting; freeform callers can still override via
 *  maxRounds, but structured purposes are force-capped at 2. */
const DEFAULT_MAX_ROUNDS = 2;
/** Confidence threshold (1-5) at which a participant is considered "done". */
const CONFIDENCE_DONE_THRESHOLD = 4;
/** Per-message truncation when summary fails — ensures we never silently drop middle content. */
const FALLBACK_MESSAGE_TRUNCATE_CHARS = 600;

/** Parse a "[[confidence=N]]" tag from the tail of an agent's contribution.
 *  Returns N clamped to 1-5, or undefined if not found. */
export function parseConfidenceTag(text: string): number | undefined {
  const m = text.match(/\[\[confidence\s*=\s*([1-5])\]\]/i);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? Math.max(1, Math.min(5, n)) : undefined;
}

/** Strip the confidence tag from displayed text. */
export function stripConfidenceTag(text: string): string {
  return text.replace(/\[\[confidence\s*=\s*[1-5]\]\]/gi, '').trim();
}

/** Instruction block appended to every participant's prompt describing the
 *  expected response format for structured termination. */
const PARTICIPANT_CONFIDENCE_INSTRUCTION = `
Rules:
- Be concise — 2-4 short paragraphs max.
- Build on what others have said. Don't repeat points already made.
- Focus strictly on your area of expertise.
- End your contribution with a tag on its own line: [[confidence=N]] where N=1-5
  (1 = "I still have a lot to add", 5 = "I have nothing more to contribute").
  The meeting ends early when all participants report >=${CONFIDENCE_DONE_THRESHOLD}.`;

/** Purpose-specific instruction block injected at the top of every
 *  participant's system prompt so each round is scoped to the goal. */
export function purposeInstruction(purpose: MeetingPurpose, agenda: string): string {
  switch (purpose) {
    case 'redTeamReview':
      return `\n\nMeeting purpose: **RED TEAM REVIEW**. Adversarially challenge the claim/plan in the agenda. Identify weak points, attack assumptions, cite counter-evidence. Your goal is to find failure modes, not to agree.\n\nAgenda claim/plan: ${agenda}`;
    case 'dissentSynthesis':
      return `\n\nMeeting purpose: **DISSENT SYNTHESIS**. State your position clearly with evidence. Engage with conflicting positions from others. The final synthesizer will reconcile positions — your job is to make your reasoning legible, not to reach consensus.\n\nAgenda: ${agenda}`;
    case 'signOff':
      return `\n\nMeeting purpose: **SIGN-OFF**. Vote approve/reject/needs-more-info on the proposed action. If rejecting, list concrete blockers. If approving, list conditions. Do not discuss alternatives — decide on the proposal as stated.\n\nProposal: ${agenda}`;
    case 'freeform':
    default:
      return '';
  }
}

/** Synthesizer prompt that produces the structured JSON artifact for a purpose. */
export function synthesizerPrompt(purpose: MeetingPurpose, agenda: string, rounds: number): string {
  const header = `The meeting has concluded after ${rounds} round(s). As the synthesizer, produce a single JSON object matching the schema below, then a short human-readable markdown summary. Output exactly two sections: first a \`\`\`json code block, then a \`## Summary\` markdown block. Do not add anything outside these.`;
  switch (purpose) {
    case 'redTeamReview':
      return `${header}\n\nSchema:\n{\n  "purpose": "redTeamReview",\n  "verdict": "holds" | "revise" | "reject",\n  "attackedClaims": string[],\n  "counterEvidence": string[],\n  "weakPoints": string[]\n}\n\nAgenda: ${agenda}`;
    case 'dissentSynthesis':
      return `${header}\n\nSchema:\n{\n  "purpose": "dissentSynthesis",\n  "positions": [{ "agent": string, "position": string, "evidence": string }],\n  "reconciled": string,\n  "unresolved": string[]\n}\n\nAgenda: ${agenda}`;
    case 'signOff':
      return `${header}\n\nSchema:\n{\n  "purpose": "signOff",\n  "decision": "approved" | "rejected" | "needs-more-info",\n  "approvers": string[],\n  "blockers": string[],\n  "conditions": string[]\n}\n\nProposal: ${agenda}`;
    case 'freeform':
    default:
      return `${header}\n\nSchema:\n{\n  "purpose": "freeform",\n  "summary": string,\n  "keyPoints": string[],\n  "actionItems": string[]\n}\n\nAgenda: ${agenda}`;
  }
}

/** Extract the JSON block from the synthesizer's response. Returns undefined if absent/invalid. */
export function parseSynthesizerJson(text: string, purpose: MeetingPurpose): MeetingStructuredOutput | undefined {
  const match = text.match(/```json\s*\n?([\s\S]*?)\n?```/);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[1]);
    if (!parsed || typeof parsed !== 'object') return undefined;
    // Force the caller's purpose to win — the LLM sometimes omits it or returns
    // the wrong one, and downstream code relies on this matching the requested
    // schema. Spread parsed FIRST, then overwrite purpose.
    return { ...parsed, purpose } as MeetingStructuredOutput;
  } catch {
    return undefined;
  }
}

/**
 * Run an agent meeting: agents discuss in turn, then produce meeting minutes.
 *
 * @param purpose controls the system prompt shape and the final structured output.
 *   For 'freeform' (the default) behavior is back-compatible with pre-Phase-4
 *   callers. For any other purpose rounds are hard-capped at
 *   DEFAULT_MAX_ROUNDS regardless of maxRounds.
 */
export async function runAgentMeeting(
  folder: Folder,
  deployments: AgentDeployment[],
  settings: Settings,
  extensionAvailable: boolean,
  agenda: string,
  maxRounds?: number,
  onProgress?: (speaker: string, status: string) => void,
  purpose: MeetingPurpose = 'freeform',
): Promise<AgentMeetingResult> {
  const requestedRounds = maxRounds || DEFAULT_MAX_ROUNDS;
  // Force-cap structured meetings at the default — research shows accuracy
  // degrades past ~2 rounds of MAD. Freeform callers may request more (legacy).
  const rounds = purpose === 'freeform'
    ? Math.min(requestedRounds, 3)
    : Math.min(requestedRounds, DEFAULT_MAX_ROUNDS);

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
    purpose,
    createdAt: Date.now(),
  };
  await db.agentMeetings.add(meeting);

  const baseContext = await buildSystemPrompt(folder, settings.llmSystemPrompt, provider);

  try {
    // Build conversation in the shared thread
    const conversationMessages: { role: 'user' | 'assistant'; content: string | ContentBlock[] }[] = [];

    // Initial agenda message. Purpose framing and the confidence-tag protocol
    // are both embedded here so every participant sees the termination rule
    // before their first turn.
    const purposeBanner = purpose === 'freeform'
      ? ''
      : `\n\n**Meeting type:** ${purpose} (scoped — max ${rounds} rounds)`;
    const agendaMsg = `Meeting Agenda: ${agenda}${purposeBanner}\n\nParticipants: ${participants.map(p => `${p.profile.icon || ''} ${p.profile.name} (${p.profile.role})`).join(', ')}\n\nEach participant speaks in turn. Be concise and constructive. End your contribution with a confidence tag: [[confidence=N]] where N=1-5 (1=much more to add, 5=nothing more to contribute). The meeting ends early when all participants report confidence >=${CONFIDENCE_DONE_THRESHOLD}.`;

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

    // Rounds — terminate when every participant reports confidence >= threshold,
    // or when we hit the round cap. Per-participant confidence is tracked across
    // rounds and reset on each round so a participant can still escalate if new
    // material arrives from others.
    let completedRounds = 0;
    const participantConfidence: Record<string, number> = {};
    for (let round = 0; round < rounds; round++) {
      const roundConfidence: Record<string, number> = {};

      // Summarize older messages if conversation exceeds budget (preserve coherence).
      // If summarization fails, we truncate each middle message instead of splicing
      // them away — this guarantees we never silently drop content.
      const totalChars = conversationMessages.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : 200), 0);
      if (totalChars > CONVERSATION_BUDGET_CHARS && conversationMessages.length > 6) {
        onProgress?.('system', 'Summarizing earlier discussion...');
        const head = conversationMessages.slice(0, 2);
        const tail = conversationMessages.slice(-4);
        const middle = conversationMessages.slice(2, -4);
        const middleText = middle.map(m => `${m.role}: ${typeof m.content === 'string' ? m.content.substring(0, 2000) : '[structured]'}`).join('\n\n');

        try {
          const summaryResponse = await callLLM({
            provider, model, apiKey: apiKey!, useServerProxy,
            endpoint: provider === 'local' ? settings.llmLocalEndpoint : undefined,
            systemPrompt: 'Summarize the following meeting discussion in 3-5 bullet points. Preserve key findings, decisions, and action items. Be concise.',
            messages: [{ role: 'user', content: middleText.substring(0, 30_000) }],
          });
          const summaryMsg = { role: 'assistant' as const, content: `[MEETING SUMMARY — earlier rounds]\n${summaryResponse.content}` };
          conversationMessages.splice(0, conversationMessages.length, ...head, summaryMsg, ...tail);
        } catch (err) {
          // Fallback: truncate each middle message to a fixed length rather than
          // silently discarding them. Preserves coherence + the audit trail.
          console.warn('[AgentMeeting] Summary failed — falling back to per-message truncation:', err);
          const truncatedMiddle = middle.map(m => {
            if (typeof m.content !== 'string') return m;
            if (m.content.length <= FALLBACK_MESSAGE_TRUNCATE_CHARS) return m;
            return { ...m, content: m.content.slice(0, FALLBACK_MESSAGE_TRUNCATE_CHARS) + '… [truncated to preserve budget]' };
          });
          conversationMessages.splice(0, conversationMessages.length, ...head, ...truncatedMiddle, ...tail);
        }
      }

      for (const { deployment, profile } of participants) {
        onProgress?.(profile.name, `Round ${round + 1}/${rounds}`);

        try {
          const systemPrompt = `${baseContext}${purposeInstruction(purpose, agenda)}

## Meeting Context

You are **${profile.name}** (${profile.role}), participating in a team meeting about this investigation.

Your expertise: ${profile.description || profile.systemPrompt.substring(0, 200)}
${PARTICIPANT_CONFIDENCE_INSTRUCTION}`;

          const response = await callLLM({
            provider, model,
            messages: conversationMessages,
            apiKey, systemPrompt,
            useServerProxy, endpoint,
          });

          const confidence = parseConfidenceTag(response.content);
          if (confidence !== undefined) {
            roundConfidence[deployment.id] = confidence;
            participantConfidence[deployment.id] = confidence;
          }
          const displayContent = stripConfidenceTag(response.content);
          const content = `**${profile.icon || ''} ${profile.name}:** ${displayContent}${confidence !== undefined ? ` _(confidence ${confidence}/5)_` : ''}`;

          // Add to conversation (keep confidence tag hidden from next speakers
          // so they don't mimic it; they see the natural prose only).
          conversationMessages.push({ role: 'assistant', content: `**${profile.name}:** ${displayContent}` });
          conversationMessages.push({ role: 'user', content: 'Next participant, please share your perspective.' });

          // Audit thread keeps the full tag for analyst review.
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
        } catch (err) {
          console.error(`[meeting] Agent ${profile.name} failed in round ${round + 1}:`, err);
          const errorContent = `**${profile.icon || ''} ${profile.name}:** _(failed to respond: ${(err as Error).message?.substring(0, 100) || 'unknown error'})_`;
          conversationMessages.push({ role: 'assistant', content: errorContent });
        }
      }

      completedRounds = round + 1;
      await db.agentMeetings.update(meetingId, { roundsCompleted: completedRounds, participantConfidence });

      // Early termination: every participant self-reported confidence >= threshold
      // in this round. Participants who failed to respond are ignored in the check.
      const reportedCount = Object.keys(roundConfidence).length;
      const allDone = reportedCount >= participants.length
        && Object.values(roundConfidence).every(c => c >= CONFIDENCE_DONE_THRESHOLD);
      if (allDone) {
        onProgress?.('system', `All participants report confidence >=${CONFIDENCE_DONE_THRESHOLD} — ending early`);
        break;
      }
    }

    // Synthesizer pass: the lead produces a structured JSON artifact per the
    // purpose's schema, plus a short markdown summary. For freeform meetings
    // we still force the same shape (JSON + summary) so artifacts are uniform.
    onProgress?.('Meeting', 'Generating minutes...');

    const leadProfile = participants.find(p => p.profile.role === 'executive' || p.profile.role === 'lead')?.profile || participants[0].profile;

    const minutesPrompt = synthesizerPrompt(purpose, agenda, completedRounds);
    conversationMessages.push({ role: 'user', content: minutesPrompt });

    const minutesResponse = await callLLM({
      provider, model,
      messages: conversationMessages,
      apiKey,
      systemPrompt: `${baseContext}\n\nYou are ${leadProfile.name}, the synthesizer for this meeting. Produce exactly the JSON block + markdown summary requested — no extra commentary.`,
      useServerProxy, endpoint,
    });

    const structuredOutput = parseSynthesizerJson(minutesResponse.content, purpose);
    const confidenceBlock = Object.keys(participantConfidence).length
      ? `\n\n**Final participant confidence:**\n${Object.entries(participantConfidence).map(([id, c]) => {
          const p = participants.find(pp => pp.deployment.id === id);
          return `- ${p?.profile.name || id}: ${c}/5`;
        }).join('\n')}`
      : '';
    const noteContent = `# ${purpose === 'freeform' ? 'Meeting Minutes' : `${purpose} — ${agenda.substring(0, 60)}`}\n\n**Purpose:** ${purpose}\n**Rounds:** ${completedRounds}/${rounds}\n**Participants:** ${participants.map(p => p.profile.name).join(', ')}\n${confidenceBlock}\n\n${minutesResponse.content}`;

    // Create minutes note
    const noteId = nanoid();
    const now = Date.now();
    await db.notes.add({
      id: noteId,
      title: `${purpose === 'freeform' ? 'Meeting' : purpose}: ${agenda.substring(0, 60)}`,
      content: noteContent,
      folderId: folder.id,
      tags: ['agent-meeting', 'meeting-minutes', `meeting-purpose:${purpose}`],
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
      structuredOutput,
      participantConfidence,
      completedAt: Date.now(),
    });

    return {
      meetingId, threadId, minutesNoteId: noteId,
      roundsCompleted: completedRounds,
      structuredOutput,
      participantConfidence,
    };
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
  let result: AgentMeetingResult;
  try {
    result = await runAgentMeeting(
      folder, allDeployments, settings, extensionAvailable,
      agenda, 2, // 2 rounds: outgoing briefs, incoming asks questions
      onProgress,
    );
  } catch (err) {
    // Handoff failed — restore all agents to their previous state
    onProgress?.('system', 'Handoff meeting failed — restoring agent states');
    // Don't change shift states on failure
    return {
      meetingId: '',
      threadId: '',
      minutesNoteId: undefined,
      roundsCompleted: 0,
      error: `Handoff failed: ${String((err as Error).message || err)}`,
    };
  }

  // Only toggle shift states if meeting succeeded without error
  if (!result.error) {
    for (const d of outgoing) {
      await db.agentDeployments.update(d.id, { shift: 'resting', updatedAt: Date.now() });
    }
    for (const d of incoming) {
      await db.agentDeployments.update(d.id, { shift: 'active', shiftStartedAt: Date.now(), updatedAt: Date.now() });
    }
  } else {
    onProgress?.('system', `Handoff meeting completed with errors — shift states unchanged`);
  }

  return result;
}
