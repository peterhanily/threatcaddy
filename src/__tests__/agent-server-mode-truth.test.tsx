/**
 * R5A-4: no 2.0.x team server runs agents. The agent panel offers Server-Side
 * Mode only when the server says it can run them, shows no error for the routine
 * status check, and says in the analyst's language when an unavailable answer
 * paused an agent that was set to run on the server.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import type { AgentDeployment, Folder, Settings } from '../types';
import { AgentPanel } from '../components/Agent/AgentPanel';
import { useServerAgents } from '../hooks/useServerAgents';
import { useAgentDeployments } from '../hooks/useAgentDeployments';
import { BUILTIN_AGENT_PROFILES } from '../lib/builtin-agent-profiles';
import { seedAIWorkspace } from './helpers/ai-workspace';
import i18n from '../i18n';
import enAgent from '../../public/locales/en/agent.json';
import deAgent from '../../public/locales/de/agent.json';

vi.mock('../components/Agent/AgentMeetingPanel', () => ({ AgentMeetingPanel: () => null }));
const auth = vi.hoisted(() => ({ token: async () => 'fixture-token' }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ serverUrl: 'https://team.example.invalid', getAccessToken: auth.token }) }));

const agentCatalogs = import.meta.glob<{ default: Record<string, string> }>('../../public/locales/*/agent.json', { eager: true });
const en = enAgent as Record<string, string>;
const de = deAgent as Record<string, string>;
const STEM = 'panel.serverAgentsPaused';
const settings = { llmLocalEndpoint: 'http://localhost:11434', llmLocalModelName: 'fixture-local-model' } as Settings;
/** server/src/bots/handoff-policy.ts HANDOFF_UNAVAILABLE, which every 2.0.x status answer carries. */
const REASON = 'Server-side AgentCaddy execution is unavailable until tool restrictions, read-only policies and durable approvals are enforced.';
const UNAVAILABLE = { registered: false, serverRunning: false, serverExecutionAvailable: false, reason: REASON, heartbeatStale: false, botCount: 0, lastHeartbeat: null };
const answering = (body: Record<string, unknown>) => vi.fn(async () => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }));
const deployment = (values: Partial<AgentDeployment> = {}): AgentDeployment => ({ id: 'dep-hunter', investigationId: 'S', profileId: 'ap-threat-hunter',
  status: 'idle', order: 0, createdAt: 1, updatedAt: 1, ...values });

/** The agent panel with the props App passes from useAgentDeployments and useServerAgents. */
function Panel({ folder }: { folder: Folder }) {
  const { deployments } = useAgentDeployments(folder.id);
  const serverAgents = useServerAgents({ investigationId: folder.id, deployments, profiles: BUILTIN_AGENT_PROFILES, enabled: deployments.some(d => d.serverSideEnabled) });
  return (
    <AgentPanel folder={folder} settings={settings} profiles={BUILTIN_AGENT_PROFILES} deployments={deployments} agentError={serverAgents.error}
      serverConnected serverExecutionAvailable={serverAgents.serverExecutionAvailable} serverPausedDeploymentIds={serverAgents.pausedDeploymentIds}
      serverRegistered={serverAgents.serverRegistered} serverRunning={serverAgents.serverRunning}
      onRegisterServer={serverAgents.registerServerAgents} onUnregisterServer={serverAgents.unregisterServerAgents} />
  );
}

async function showPanel(deployments: AgentDeployment[], answer: ReturnType<typeof answering>) {
  await db.agentDeployments.bulkAdd(deployments);
  vi.stubGlobal('fetch', answer);
  render(<Panel folder={await db.folders.get('S') as Folder} />);
  await waitFor(() => expect(answer).toHaveBeenCalledWith('https://team.example.invalid/api/caddy-agents/status/S', expect.anything()));
  await act(async () => {});
}

const openAgentsTab = (agents: string) => fireEvent.click(screen.getByRole('button', { name: `${agents}(1)` }));

beforeEach(async () => { await seedAIWorkspace(); localStorage.clear(); });
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await act(async () => { await i18n.changeLanguage('en'); });
});

describe('a team server that cannot run agents', () => {
  it('is not offered for agents, and its routine status answer is not an error', async () => {
    await showPanel([deployment()], answering(UNAVAILABLE));
    openAgentsTab(en['panel.agents']);
    expect(screen.queryByText(en['panel.serverSideMode'])).not.toBeInTheDocument();
    expect(screen.queryByText(en['panel.serverSideModeDesc'])).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en['panel.enable'] })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(REASON);
    expect(document.body.textContent).not.toContain('agent that was set to run there');
  });

  it.each([
    ['set to run on the server', { serverSideEnabled: true, handoffState: 'client' as const }],
    ['owned by the server', { handoffState: 'server' as const }],
  ])('pauses an agent %s and says so in the analyst’s language', async (_, values) => {
    for (const [namespace, bundle] of Object.entries(i18n.getDataByLanguage('en') ?? {})) i18n.addResourceBundle('de', namespace, bundle, true, false);
    i18n.addResourceBundle('de', 'agent', deAgent, true, true);
    await act(async () => { await i18n.changeLanguage('de'); });
    await showPanel([deployment({ status: 'running', ...values })], answering(UNAVAILABLE));
    await waitFor(async () => expect((await db.agentDeployments.get('dep-hunter'))?.status).toBe('paused'));
    const notice = await screen.findByText(i18n.t(STEM, { ns: 'agent', lng: 'de', count: 1 }));
    expect(notice.closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(REASON);
    // The deployment stays paused and keeps its ownership state, as handleUnavailable left it.
    expect(await db.agentDeployments.get('dep-hunter')).toMatchObject({ status: 'paused', serverSideEnabled: false, handoffState: values.handoffState });
  });
});

describe('the paused notice', () => {
  const malware = (values: Partial<AgentDeployment> = {}) => deployment({ id: 'dep-malware', profileId: 'ap-malware-analyst', order: 1, ...values });
  const paused = [deployment({ status: 'paused' }), malware({ status: 'paused' })];
  const hunterAgain = deployment({ id: 'dep-hunter-2', order: 2 });
  const malwareAgain = malware({ id: 'dep-malware-2', order: 3 });
  const notice = (count: number) => i18n.t(STEM, { ns: 'agent', count });
  async function showNotice(pausedIds: string[], deployments: AgentDeployment[]) {
    const folder = await db.folders.get('S') as Folder;
    const panel = (ids: string[], list: AgentDeployment[]) => (
      <AgentPanel folder={folder} settings={settings} profiles={BUILTIN_AGENT_PROFILES} deployments={list} serverConnected serverPausedDeploymentIds={ids} />
    );
    const view = render(panel(pausedIds, deployments));
    return (ids: string[], list: AgentDeployment[]) => view.rerender(panel(ids, list));
  }

  it('counts only the paused agents not yet deployed again, and goes once each one is', async () => {
    const show = await showNotice(['dep-hunter', 'dep-malware'], paused);
    expect(await screen.findByText(notice(2))).toBeInTheDocument();
    show(['dep-hunter', 'dep-malware'], [...paused, hunterAgain]);
    expect(await screen.findByText(notice(1))).toBeInTheDocument();
    show(['dep-hunter', 'dep-malware'], [...paused, hunterAgain, malwareAgain]);
    expect(document.body.textContent).not.toContain('set to run there');
  });

  it('a copy that is paused, by the server or otherwise, does not count as deployed again', async () => {
    // The list can still show the status from before the pause until it reloads; the notice waits for it.
    const stale = [deployment({ status: 'running' }), deployment({ id: 'dep-hunter-2', status: 'running', order: 2 }),
      deployment({ id: 'dep-hunter-3', status: 'paused', order: 3 })];
    const show = await showNotice(['dep-hunter', 'dep-hunter-2'], stale);
    expect(document.body.textContent).not.toContain('set to run there');
    show(['dep-hunter', 'dep-hunter-2'], stale.map(d => ({ ...d, status: 'paused' as const })));
    expect(await screen.findByText(notice(2))).toBeInTheDocument();
  });

  it('a copy deployed before the pause does not count as deployed again', async () => {
    // An older version could deploy one profile twice: one copy ran in this browser, the other was set to run on the server.
    const show = await showNotice(['dep-hunter'], [deployment({ id: 'dep-hunter-0', createdAt: 1, updatedAt: 1 }),
      deployment({ status: 'paused', order: 1, createdAt: 2, updatedAt: 999 })]);
    expect(await screen.findByText(notice(1))).toBeInTheDocument();
    show(['dep-hunter'], [deployment({ id: 'dep-hunter-0', createdAt: 1, updatedAt: 1 }),
      deployment({ status: 'paused', order: 1, createdAt: 2, updatedAt: 999 }), deployment({ id: 'dep-hunter-2', order: 2, createdAt: 1000, updatedAt: 1000 })]);
    await waitFor(() => expect(document.body.textContent).not.toContain('set to run there'));
  });

  it('a dismissed notice comes back when another agent is paused', async () => {
    const show = await showNotice(['dep-hunter', 'dep-malware'], paused);
    fireEvent.click(await screen.findByRole('button', { name: en['panel.dismissNotice'] }));
    expect(document.body.textContent).not.toContain('set to run there');
    show(['dep-hunter', 'dep-malware'], [...paused, hunterAgain]);
    expect(document.body.textContent).not.toContain('set to run there');
    const enricher = deployment({ id: 'dep-enricher', profileId: 'ap-ioc-enricher', status: 'paused', order: 4 });
    show(['dep-hunter', 'dep-malware', 'dep-enricher'], [...paused, hunterAgain, enricher]);
    expect(await screen.findByText(notice(2))).toBeInTheDocument();
  });
});

it('a server that reports it can run agents offers Server-Side Mode', async () => {
  await showPanel([deployment()], answering({ registered: false, serverRunning: false, serverExecutionAvailable: true }));
  openAgentsTab(en['panel.agents']);
  expect(await screen.findByText(en['panel.serverSideMode'])).toBeInTheDocument();
  expect(screen.getByRole('button', { name: en['panel.enable'] })).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

describe('the agent catalogs', () => {
  it('every language says it with each plural form its rules need', () => {
    expect(Object.keys(agentCatalogs)).toHaveLength(21);
    for (const [path, { default: values }] of Object.entries(agentCatalogs)) {
      const lng = path.split('/').at(-2) as string;
      for (const form of new Set(['one', 'other', ...new Intl.PluralRules(lng).resolvedOptions().pluralCategories])) {
        expect(values[`${STEM}_${form}`], `${lng} ${form}`).toContain('{{count}}');
      }
    }
  });

  it('German translates both forms', () => {
    for (const form of ['one', 'other']) {
      expect(de[`${STEM}_${form}`]).toBeTruthy();
      expect(de[`${STEM}_${form}`]).not.toBe(en[`${STEM}_${form}`]);
    }
  });
});
