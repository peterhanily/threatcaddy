/**
 * R5A-3: a pending enrichment card checks its lookups again on each change. When
 * an earlier check answers after a later one, the later answer stands: a slow
 * check cannot bring back what was true before the change.
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '../db';
import type { AgentAction } from '../types';
import type { InstalledIntegration } from '../types/integration-types';
import { AgentActionCard } from '../components/Agent/AgentActionCard';
import { classifyToolCall } from '../lib/tool-reach';
import { ids, seedAIWorkspace } from './helpers/ai-workspace';

/** While `hold` is set, a classification works out its answer and then waits for it before answering. */
const reach = vi.hoisted(() => ({ hold: undefined as Promise<void> | undefined, heldAnswered: false }));
vi.mock('../lib/tool-reach', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/tool-reach')>();
  return {
    ...actual,
    classifyToolCall: vi.fn(async (...args: Parameters<typeof actual.classifyToolCall>) => {
      const hold = reach.hold;
      const answer = await actual.classifyToolCall(...args);
      if (hold) { await hold; reach.heldAnswered = true; }
      return answer;
    }),
  };
});

const VT = 'Sends canary-s.example to: VirusTotal Domain Lookup (www.virustotal.com)';
const NONE = 'Nothing is sent: no enabled lookup applies to canary-s.example.';
const proposal: AgentAction = { id: 'enrich-1', investigationId: 'S', threadId: 't', agentConfigId: 'ap-ioc-enricher', toolName: 'enrich_ioc',
  toolInput: { iocId: ids('S').ioc }, rationale: 'Proposed by the agent', status: 'pending', createdAt: 1 };

beforeEach(async () => {
  await seedAIWorkspace();
  reach.hold = undefined;
  reach.heldAnswered = false;
  vi.mocked(classifyToolCall).mockClear();
});
afterEach(() => cleanup());

it('an earlier check that answers last does not replace the newest answer', async () => {
  await db.installedIntegrations.add({ id: 'vt', templateId: 'vt-domain-lookup', name: 'vt', enabled: false, config: { apiKey: 'fixture-key' },
    scopeType: 'all', scopeFolderIds: [], runCount: 0, errorCount: 0, createdAt: 1, updatedAt: 1 } as InstalledIntegration);
  render(<AgentActionCard action={proposal} />);
  expect(await screen.findByText(NONE)).toBeInTheDocument();
  const before = vi.mocked(classifyToolCall).mock.calls.length;

  // The lookup is enabled: that check finds VirusTotal, and is slow to answer.
  let release = () => {};
  reach.hold = new Promise<void>(resolve => { release = resolve; });
  await act(async () => { await db.installedIntegrations.update('vt', { enabled: true }); });
  await waitFor(() => expect(vi.mocked(classifyToolCall).mock.calls.length).toBeGreaterThan(before));
  // It is disabled again before that check answers: the newer check answers first.
  reach.hold = undefined;
  await act(async () => { await db.installedIntegrations.update('vt', { enabled: false }); });
  expect(await screen.findByText(NONE)).toBeInTheDocument();

  // The slow check answers now, and the card keeps the newer answer.
  await act(async () => { release(); });
  await waitFor(() => expect(reach.heldAnswered).toBe(true));
  // The card reads the IOC once more after a check answers; let that read finish.
  await act(async () => { await db.standaloneIOCs.get(ids('S').ioc); await new Promise(resolve => setTimeout(resolve, 50)); });
  expect(screen.getByText(NONE)).toBeInTheDocument();
  expect(screen.queryByText(VT)).not.toBeInTheDocument();
});
