/**
 * The eval harness scores what a cycle left behind. Two scripted runs against
 * the realistic sample prove the scoring: one records the planted indicators,
 * the other invents one, misses two and calls a tool it does not have.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runAgentEval } from '../evals/agent-eval';
import { calculateCost } from '../lib/model-pricing';
import { scriptedLLM, scriptedSend } from './helpers/scripted-llm';
import { clearAIWorkspace } from './helpers/ai-workspace';
import { installEgressSpy } from './helpers/egress-spy';

vi.mock('../lib/llm-router', async orig => (await import('../evals/eval-router')).evalRouter(await orig()));

const MODEL = 'claude-sonnet-4-6';

beforeEach(async () => {
  await clearAIWorkspace();
  localStorage.clear();
  scriptedLLM.reset();
});

describe('agent eval harness', () => {
  it('scores a run that records every planted indicator and invents nothing', async () => {
    const egress = installEgressSpy();
    scriptedLLM.script(
      { toolCalls: [{ name: 'get_investigation_summary', input: {} }], usage: { input: 1000, output: 100 } },
      { toolCalls: [
        { name: 'create_ioc', input: { type: 'ipv4', value: '198.51.100.24' } },
        { name: 'create_ioc', input: { type: 'email', value: 'archive@review-mail.example' } },
        { name: 'create_ioc', input: { type: 'ipv4', value: '192.0.2.10' } },
        { name: 'create_note', input: { title: 'Indicators recorded', content: 'Recorded 198.51.100.24 and archive@review-mail.example from the excerpts.' } },
      ], usage: { input: 2000, output: 200 } },
      { text: 'Recorded the three indicators from the evidence excerpts.', usage: { input: 3000, output: 50 } },
    );
    const score = await runAgentEval({ send: scriptedSend, model: MODEL });
    egress.restore();

    expect(score).toMatchObject({
      iocsPresent: 3, iocsFound: 3, entitiesCreated: 4, entitiesInvented: 0, invented: [],
      toolCalls: 5, toolCallsFailed: 0, failedShare: 0, proposed: 0, turns: 3,
      tokens: { input: 6000, output: 350 }, outcomes: ['success'], errors: [],
    });
    expect(score.costUSD).toBeCloseTo(calculateCost(MODEL, 6000, 350), 10);
    expect(score.costUSD).toBeGreaterThan(0);
    expect(egress.fetchUrlPosts()).toEqual([]);
  });

  it('scores a run that invents an indicator, misses two and calls a tool it does not have', async () => {
    scriptedLLM.script(
      { toolCalls: [
        { name: 'create_ioc', input: { type: 'ipv4', value: '198.51.100.24' } },
        { name: 'create_ioc', input: { type: 'domain', value: 'evil-c2.example.org' } },
        { name: 'create_note', input: { title: 'Attribution', content: 'The session came from 203.0.113.77, a known actor address.' } },
        { name: 'deploy_agent', input: { profileName: 'Threat Hunter' } },
      ] },
      { text: 'Done.' },
    );
    const score = await runAgentEval({ send: scriptedSend, model: MODEL });

    expect(score).toMatchObject({ iocsPresent: 3, iocsFound: 1, entitiesCreated: 3, entitiesInvented: 2, toolCalls: 4, toolCallsFailed: 1, failedShare: 0.25, turns: 2 });
    expect(score.invented).toEqual(['ioc evil-c2.example.org', 'note "Attribution" names 203.0.113.77']);
  });

  it('runs a builtin profile for several cycles and gives the later ones its memory', async () => {
    scriptedLLM.script(
      { toolCalls: [{ name: 'create_ioc', input: { type: 'ipv4', value: '198.51.100.24' } }] },
      { text: 'Recorded the unfamiliar session address.' },
      { text: 'Nothing new needs doing.' },
    );
    const score = await runAgentEval({ send: scriptedSend, model: MODEL, cycles: 2, profileId: 'ap-ioc-enricher' });

    expect(score).toMatchObject({ iocsFound: 1, turns: 3, outcomes: ['success', 'success'], errors: [] });
    const secondCycle = JSON.stringify(scriptedLLM.requests[2].messages);
    expect(secondCycle).toContain('AGENT_MEMORY');
    expect(secondCycle).toContain('Recorded the unfamiliar session address.');
  });

  it('refuses to run over an existing sample investigation', async () => {
    await runAgentEval({ send: scriptedSend, model: MODEL });
    await expect(runAgentEval({ send: scriptedSend, model: MODEL })).rejects.toThrow(/empty database/);
  });
});
