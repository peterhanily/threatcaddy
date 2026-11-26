/**
 * Scores agent cycles against the realistic sample investigation. The case is
 * seeded without its IOC records, which stay in the notes and evidence as text:
 * they are the answer key. Every metric is counted from what the cycles left in
 * the database and from their own cycle summaries; no model grades anything.
 *
 * Runs only under Vitest with the router replaced (eval-router.ts): the unit
 * test drives it with a scripted model, `pnpm eval:agents` with a real one.
 * See docs/agent-evals.md.
 */
import { db } from '../db';
import { DEFAULT_AGENT_POLICY, DEFAULT_SETTINGS, type AgentCycleOutcome, type AgentDeployment, type Folder, type Settings } from '../types';
import { runAgentCycle } from '../lib/caddy-agent';
import { resolveAgentProfile } from '../lib/agent-profile-resolver';
import { extractIOCs } from '../lib/ioc-extractor';
import { generateRealisticInvestigation } from '../lib/sample-investigation-realistic';
import { setEvalSend, type EvalSend } from './eval-router';

export interface AgentEvalOptions {
  /** The model under test: called for every model turn of every cycle. */
  send: EvalSend;
  /** Model id, for the request and for pricing (model-pricing.ts). An unpriced model costs 0. */
  model: string;
  /** Cycles to run in a row; the later ones receive the agent's memory. Default 1. */
  cycles?: number;
  /** A builtin profile id (builtin-agent-profiles.ts). Without one the legacy single agent runs. */
  profileId?: string;
}

export interface AgentEvalScore {
  /** Indicators in the source material, and how many of them the agent recorded as IOCs. */
  iocsPresent: number;
  iocsFound: number;
  /** Notes, tasks, timeline events and IOCs the agent created. */
  entitiesCreated: number;
  /** Created IOCs whose value is nowhere in the source material, and other created entities that name such an indicator. */
  entitiesInvented: number;
  invented: string[];
  toolCalls: number;
  /** Calls that errored or were refused (the cycles' errorHistogram). */
  toolCallsFailed: number;
  failedShare: number;
  /** Calls queued for the analyst instead of run. */
  proposed: number;
  turns: number;
  tokens: { input: number; output: number };
  costUSD: number;
  outcomes: AgentCycleOutcome[];
  errors: string[];
}

const norm = (value: string) => value.trim().toLowerCase();
const sum = (counts: Record<string, number>) => Object.values(counts).reduce((total, n) => total + n, 0);

export async function runAgentEval({ send, model, cycles = 1, profileId }: AgentEvalOptions): Promise<AgentEvalScore> {
  const { standaloneIOCs: answerKey, ...sample } = generateRealisticInvestigation();
  const folderId = sample.folder.id;
  if (await db.folders.get(folderId)) throw new Error('The sample investigation already exists: run the eval in an empty database.');

  // Reads, creates and changes run; nothing may leave for an enrichment vendor or a web page.
  const folder: Folder = { ...sample.folder, agentPolicy: { ...DEFAULT_AGENT_POLICY, autoApproveEnrich: false, autoApproveFetch: false, autoApproveCreate: true, autoApproveModify: true, model } };
  await db.folders.add(folder);
  await db.timelines.add(sample.timeline);
  await db.notes.bulkAdd(sample.notes);
  await db.tasks.bulkAdd(sample.tasks);
  await db.timelineEvents.bulkAdd(sample.timelineEvents.map(event => ({ ...event, linkedIOCIds: [] })));
  await db.evidenceItems.bulkAdd(sample.evidenceItems.map(item => ({ ...item, linkedIOCIds: [] })));
  await db.identities.bulkAdd(sample.identities);

  const planted = answerKey.map(ioc => norm(ioc.value));
  const corpus = JSON.stringify(sample).toLowerCase();
  const seeded = new Set([...sample.notes, ...sample.tasks, ...sample.timelineEvents].map(row => row.id));

  // The placeholder keys only satisfy the cycle's "is a provider configured" check; the router is replaced.
  const settings: Settings = { ...DEFAULT_SETTINGS, llmRoutingMode: 'extension', llmDefaultModel: model,
    llmAnthropicApiKey: 'agent-eval', llmOpenAIApiKey: 'agent-eval', llmGeminiApiKey: 'agent-eval', llmMistralApiKey: 'agent-eval' };
  const profile = await resolveAgentProfile(profileId);
  if (profileId && !profile) throw new Error(`Unknown agent profile: ${profileId}`);
  let deployment: AgentDeployment | undefined;
  if (profile) {
    deployment = { id: 'agent-eval-deployment', investigationId: folderId, profileId: profile.id, status: 'idle', order: 0, createdAt: Date.now(), updatedAt: Date.now() };
    await db.agentDeployments.add(deployment);
  }

  const score: AgentEvalScore = { iocsPresent: planted.length, iocsFound: 0, entitiesCreated: 0, entitiesInvented: 0, invented: [],
    toolCalls: 0, toolCallsFailed: 0, failedShare: 0, proposed: 0, turns: 0, tokens: { input: 0, output: 0 }, costUSD: 0, outcomes: [], errors: [] };

  setEvalSend(send);
  try {
    for (let cycle = 0; cycle < cycles; cycle++) {
      const result = await runAgentCycle(await db.folders.get(folderId) ?? folder, settings, true, undefined, profile,
        deployment && await db.agentDeployments.get(deployment.id));
      if (result.error) score.errors.push(result.error);
      score.proposed += result.proposed.length;
      const summary = result.summary;
      if (!summary) continue;
      score.toolCalls += sum(summary.toolHistogram);
      score.toolCallsFailed += sum(summary.errorHistogram);
      score.turns += summary.turns;
      score.tokens.input += summary.tokens.input;
      score.tokens.output += summary.tokens.output;
      score.costUSD += summary.costUSD;
      score.outcomes.push(summary.outcome);
    }
  } finally {
    setEvalSend(undefined);
  }
  score.failedShare = score.toolCalls ? score.toolCallsFailed / score.toolCalls : 0;

  const iocs = await db.standaloneIOCs.where('folderId').equals(folderId).toArray();
  const recorded = new Set(iocs.map(ioc => norm(ioc.value)));
  score.iocsFound = planted.filter(value => recorded.has(value)).length;

  const written = [
    ...(await db.notes.where('folderId').equals(folderId).toArray()).map(note => ({ id: note.id, kind: 'note', title: note.title, text: `${note.title}\n${note.content}` })),
    ...(await db.tasks.where('folderId').equals(folderId).toArray()).map(task => ({ id: task.id, kind: 'task', title: task.title, text: `${task.title}\n${task.description ?? ''}` })),
    ...(await db.timelineEvents.where('folderId').equals(folderId).toArray()).map(event => ({ id: event.id, kind: 'event', title: event.title, text: `${event.title}\n${event.description ?? ''}` })),
  ].filter(row => !seeded.has(row.id));
  score.entitiesCreated = iocs.length + written.length;
  for (const ioc of iocs) if (!corpus.includes(norm(ioc.value))) score.invented.push(`ioc ${ioc.value}`);
  for (const row of written) {
    const unknown = extractIOCs(row.text).map(ioc => ioc.value).filter(value => !corpus.includes(norm(value)));
    if (unknown.length > 0) score.invented.push(`${row.kind} "${row.title}" names ${unknown.join(', ')}`);
  }
  score.entitiesInvented = score.invented.length;
  return score;
}
