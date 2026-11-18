/**
 * A4: the agent inbox tells the truth, in the analyst's language: which
 * lookups an enrichment proposal sends the IOC to, the whole input a proposal
 * sends, why a proposal failed, and the panel's own labels.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import type { AgentAction, AgentDeployment, Folder, Settings } from '../types';
import type { InstalledIntegration, IntegrationTemplate } from '../types/integration-types';
import { AgentActionCard } from '../components/Agent/AgentActionCard';
import { AgentPanel } from '../components/Agent/AgentPanel';
import { AgentProfilePicker } from '../components/Agent/AgentProfilePicker';
import { executeApprovedAction } from '../lib/agent-action-approval';
import { BUILTIN_AGENT_PROFILES } from '../lib/builtin-agent-profiles';
import { FORENSICATE_AGENT_PROFILE } from '../lib/forensicate-tool';
import { ids, seedAIWorkspace } from './helpers/ai-workspace';
import { installEgressSpy, type EgressSpy } from './helpers/egress-spy';
import i18n from '../i18n';
import enAgent from '../../public/locales/en/agent.json';
import deAgent from '../../public/locales/de/agent.json';
import deTasks from '../../public/locales/de/tasks.json';
import deIntegrations from '../../public/locales/de/integrations.json';

vi.mock('../components/Agent/AgentMeetingPanel', () => ({ AgentMeetingPanel: () => null }));

const agentCatalogs = import.meta.glob<{ default: Record<string, string> }>('../../public/locales/*/agent.json', { eager: true });
const de = deAgent as Record<string, string>;
const en = enAgent as Record<string, string>;
const settings = { llmLocalEndpoint: 'http://localhost:11434', llmLocalModelName: 'fixture-local-model' } as Settings;
const action = (values: Partial<AgentAction>): AgentAction => ({ id: `action-${values.toolName}`, investigationId: 'S', threadId: 't', toolName: 'create_note',
  toolInput: {}, rationale: 'Proposed by the agent', status: 'pending', createdAt: 1, ...values });
const deployment = (profileId: string, values: Partial<AgentDeployment> = {}): AgentDeployment => ({ id: `dep-${profileId}`, investigationId: 'S', profileId,
  status: 'idle', order: 0, createdAt: 1, updatedAt: 1, ...values });
const folder = async (id: string) => await db.folders.get(id) as Folder;
/** i18next's own value for a key, so plural forms resolve as they do in the app. */
const deText = (key: string, options?: Record<string, unknown>) => i18n.t(key, { ns: 'agent', lng: 'de', ...options });

async function inGerman() {
  for (const [namespace, values] of Object.entries(i18n.getDataByLanguage('en') ?? {})) i18n.addResourceBundle('de', namespace, values, true, false);
  i18n.addResourceBundle('de', 'agent', deAgent, true, true);
  i18n.addResourceBundle('de', 'tasks', deTasks, true, true);
  await i18n.changeLanguage('de');
}

let egress: EgressSpy;
beforeEach(async () => { await seedAIWorkspace(); localStorage.clear(); egress = installEgressSpy(['llm_streaming', 'fetch_url']); });
afterEach(async () => {
  cleanup();
  egress.restore();
  await act(async () => { await i18n.changeLanguage('en'); });
});

describe('A4-1 the Forensicate Scanner says what leaves the device', () => {
  // The sentence each language used to end with: nothing leaves this device.
  const NOTHING_LEAVES: Record<string, string> = {
    ar: 'لا يغادر أي شيء هذا الجهاز', de: 'Nichts verlässt dieses Gerät', en: 'Nothing leaves this device', es: 'Nada sale de este dispositivo',
    fa: 'هیچ چیزی از این دستگاه خارج نمی‌شود', fr: 'Rien ne quitte cet appareil', he: 'שום דבר לא יוצא מהמכשיר הזה',
    hi: 'इस डिवाइस से कुछ भी बाहर नहीं जाता', id: 'Tidak ada yang keluar dari perangkat ini', it: 'Nulla lascia questo dispositivo',
    ja: 'このデバイスから何も送信されません', ko: '이 기기 밖으로 아무것도 전송되지 않습니다', nl: 'Er verlaat niets dit apparaat',
    pl: 'Nic nie opuszcza tego urządzenia', 'pt-BR': 'Nada sai deste dispositivo', ru: 'Ничего не покидает это устройство',
    th: 'ไม่มีข้อมูลใดออกจากอุปกรณ์นี้', tr: 'Bu cihazdan hiçbir şey çıkmaz', uk: 'Ніщо не залишає цей пристрій',
    vi: 'Không có gì rời khỏi thiết bị này', 'zh-CN': '任何数据都不会离开此设备',
  };

  it('no language still says nothing leaves this device', () => {
    const descriptions = Object.fromEntries(Object.entries(agentCatalogs).map(([path, catalog]) =>
      [path.split('/').at(-2) as string, catalog.default['builtinProfile.forensicateScanner.descriptionV2']]));
    expect(Object.keys(descriptions).sort()).toEqual(Object.keys(NOTHING_LEAVES).sort());
    for (const [lng, text] of Object.entries(descriptions)) {
      expect(text, lng).toBeTruthy();
      expect(text, lng).not.toContain(NOTHING_LEAVES[lng]);
    }
  });

  it('the picker says the check is local and the agent sends what it reads to the AI model', async () => {
    expect(FORENSICATE_AGENT_PROFILE.description).toBe('Basic check of investigation content for common prompt-injection patterns. '
      + 'The check runs on this device; like every agent, it sends what it reads to your AI model.');
    await inGerman();
    render(<AgentProfilePicker profiles={[FORENSICATE_AGENT_PROFILE]} deployments={[]} onDeployMultiple={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTitle(`Forensicate Scanner (${de['panel.roleSpecialist']}): ${de['builtinProfile.forensicateScanner.descriptionV2']}`)).toBeInTheDocument();
  });
});

describe('A4-2 an enrichment proposal names each destination and the IOC value', () => {
  const install = (id: string, templateId: string, config: Record<string, unknown>): InstalledIntegration => ({
    id, templateId, name: id, enabled: true, config, scopeType: 'all', scopeFolderIds: [], runCount: 0, errorCount: 0, createdAt: 1, updatedAt: 1,
  } as InstalledIntegration);
  const proposal = () => action({ id: 'enrich-1', agentConfigId: 'ap-ioc-enricher', toolName: 'enrich_ioc', toolInput: { iocId: ids('S').ioc } });

  beforeEach(async () => {
    await db.agentDeployments.add(deployment('ap-ioc-enricher'));
  });

  it('with VirusTotal, Slack and a team template installed, the card names what approval then sends to', async () => {
    await db.integrationTemplates.add({
      id: 'team-dns', schemaVersion: '1.0', version: '1', name: 'Team DNS', description: '', author: 'team', icon: '', color: '',
      category: 'enrichment', tags: [], triggers: [{ type: 'manual', iocTypes: ['domain'] }], configSchema: [],
      steps: [{ id: 's1', type: 'http', label: 'q', method: 'GET', url: 'https://dns.team.example/q?d={{ioc.value}}', responseType: 'json' }],
      outputs: [], requiredDomains: ['dns.team.example'], source: 'team', createdAt: 1, updatedAt: 1,
    } as unknown as IntegrationTemplate);
    await db.installedIntegrations.bulkAdd([
      install('vt', 'vt-domain-lookup', { apiKey: 'fixture-key' }),
      install('team', 'team-dns', {}),
      install('slack', 'slack-webhook-notify', { webhookUrl: 'https://hooks.slack.com/services/T0/B0/X0', channel: '#soc' }),
    ]);
    const row = proposal();
    await db.agentActions.add(row);

    render(<AgentActionCard action={row} onApprove={vi.fn()} onReject={vi.fn()} />);
    const line = await screen.findByText(/^Sends canary-s\.example to: /);
    expect(screen.queryByText(/vendor lookups/)).not.toBeInTheDocument();
    const named = [...(line.textContent ?? '').matchAll(/\(([^)]+)\)/g)].map(match => match[1]).sort();
    expect(named).toEqual(['dns.team.example', 'hooks.slack.com', 'www.virustotal.com']);
    expect(line.textContent).toContain('Slack');

    expect(egress.fetches).toEqual([]);
    await executeApprovedAction(row);
    expect([...new Set(egress.fetches.map(url => new URL(url).hostname))].sort()).toEqual(named);
  });

  it('with no lookup installed, the card says nothing is sent, and approval sends nothing', async () => {
    const row = proposal();
    await db.agentActions.add(row);
    render(<AgentActionCard action={row} onApprove={vi.fn()} onReject={vi.fn()} />);
    expect(await screen.findByText('Nothing is sent: no enabled lookup applies to canary-s.example.')).toBeInTheDocument();
    expect(screen.queryByText(/^Sends /)).not.toBeInTheDocument();
    await executeApprovedAction(row);
    expect(egress.fetches).toEqual([]);
  });

  it('an IOC filed in another investigation is not sent, and a decided row names no lookup', async () => {
    await db.installedIntegrations.add(install('vt', 'vt-domain-lookup', { apiKey: 'fixture-key' }));
    const elsewhere = action({ id: 'enrich-p', agentConfigId: 'ap-ioc-enricher', toolName: 'enrich_ioc', toolInput: { iocId: ids('P').ioc } });
    await db.agentActions.add(elsewhere);
    const view = render(<AgentActionCard action={elsewhere} />);
    expect(await screen.findByText('Nothing is sent: canary-p.example is not available in this investigation.')).toBeInTheDocument();
    await executeApprovedAction(elsewhere);
    expect(egress.fetches).toEqual([]);
    view.rerender(<AgentActionCard action={{ ...proposal(), status: 'executed' }} />);
    await act(async () => {});
    expect(screen.queryByText(/^Sends |^Nothing is sent|^Checking/)).not.toBeInTheDocument();
  });

  it('a trashed IOC is not sent', async () => {
    await db.installedIntegrations.add(install('vt', 'vt-domain-lookup', { apiKey: 'fixture-key' }));
    await db.standaloneIOCs.update(ids('S').ioc, { trashed: true });
    const row = proposal();
    await db.agentActions.add(row);
    render(<AgentActionCard action={row} />);
    // A lookup applies to the IOC; it is the IOC that approval cannot reach.
    expect(await screen.findByText('Nothing is sent: canary-s.example is not available in this investigation.')).toBeInTheDocument();
    await executeApprovedAction(row);
    expect(egress.fetches).toEqual([]);
  });

  it('joins the lookups as the analyst’s language joins a list', async () => {
    await db.installedIntegrations.bulkAdd([
      install('slack', 'slack-webhook-notify', { webhookUrl: 'https://hooks.slack.com/services/T0/B0/X0', channel: '#soc' }),
      install('vt', 'vt-domain-lookup', { apiKey: 'fixture-key' }),
    ]);
    render(<AgentActionCard action={proposal()} />);
    expect(await screen.findByText('Sends canary-s.example to: Slack Webhook Notification (hooks.slack.com) and VirusTotal Domain Lookup (www.virustotal.com)'))
      .toBeInTheDocument();
    i18n.addResourceBundle('de', 'integrations', deIntegrations, true, true);
    try {
      await act(inGerman);
      expect(await screen.findByText(deText('action.lookupDestinations', { value: 'canary-s.example',
        vendors: 'Slack-Webhook-Benachrichtigung (hooks.slack.com) und VirusTotal Domain-Abfrage (www.virustotal.com)' }))).toBeInTheDocument();
    } finally { i18n.removeResourceBundle('de', 'integrations'); }
  });

  it('names builtin lookups when their translations load on demand, as in the hosted build', async () => {
    // The hosted build bundles the integrations namespace in no language: it arrives when loaded.
    const bundle = i18n.getResourceBundle('en', 'integrations') as Record<string, unknown>;
    i18n.removeResourceBundle('en', 'integrations');
    const load = vi.spyOn(i18n, 'loadNamespaces').mockImplementation(async namespaces => {
      if ([namespaces].flat().includes('integrations')) i18n.addResourceBundle('en', 'integrations', bundle);
    });
    try {
      await db.installedIntegrations.bulkAdd([
        install('vt', 'vt-domain-lookup', { apiKey: 'fixture-key' }),
        install('slack', 'slack-webhook-notify', { webhookUrl: 'https://hooks.slack.com/services/T0/B0/X0', channel: '#soc' }),
      ]);
      render(<AgentActionCard action={proposal()} />);
      const line = await screen.findByText(/^Sends canary-s\.example to: /);
      expect(line.textContent).not.toContain('builtin.');
      expect(line.textContent).toContain('VirusTotal Domain Lookup (www.virustotal.com)');
      expect(line.textContent).toContain('Slack Webhook Notification (hooks.slack.com)');
    } finally {
      load.mockRestore();
      i18n.addResourceBundle('en', 'integrations', bundle, true, true);
    }
  });

  it('names the lookups again in the language the analyst switches to', async () => {
    await db.installedIntegrations.add(install('vt', 'vt-domain-lookup', { apiKey: 'fixture-key' }));
    render(<AgentActionCard action={proposal()} />);
    expect(await screen.findByText('Sends canary-s.example to: VirusTotal Domain Lookup (www.virustotal.com)')).toBeInTheDocument();
    i18n.addResourceBundle('de', 'integrations', deIntegrations, true, true);
    try {
      await act(inGerman);
      expect(await screen.findByText(deText('action.lookupDestinations', { value: 'canary-s.example', vendors: 'VirusTotal Domain-Abfrage (www.virustotal.com)' })))
        .toBeInTheDocument();
    } finally { i18n.removeResourceBundle('de', 'integrations'); }
  });

  it('a value with bidi controls cannot reorder the line', async () => {
    await db.installedIntegrations.add(install('vt', 'vt-domain-lookup', { apiKey: 'fixture-key' }));
    await db.standaloneIOCs.update(ids('S').ioc, { value: 'canary-s.example\u202E\u2066' });
    render(<AgentActionCard action={proposal()} />);
    const line = await screen.findByText(/^Sends canary-s\.example/);
    expect(line.textContent).toBe('Sends canary-s.example to: VirusTotal Domain Lookup (www.virustotal.com)');
  });

  it('shows a neutral line only while the lookup is loading, and says it in German', async () => {
    await db.installedIntegrations.add(install('vt', 'vt-domain-lookup', { apiKey: 'fixture-key' }));
    await inGerman();
    render(<AgentActionCard action={proposal()} />);
    expect(screen.getByText(de['action.lookupChecking'])).toBeInTheDocument();
    expect(await screen.findByText(deText('action.lookupDestinations', { value: 'canary-s.example', vendors: 'VirusTotal Domain Lookup (www.virustotal.com)' })))
      .toBeInTheDocument();
    expect(screen.queryByText(de['action.lookupChecking'])).not.toBeInTheDocument();
  });
});

describe('A4-3 the expanded card shows the whole input approval sends', () => {
  it('shows the tail of a 6,000-character input', () => {
    const toolInput = { host: 'ws-1', note: `${'x'.repeat(6000)}TAIL-4471` };
    render(<AgentActionCard action={action({ toolName: 'host:soc1:isolate', toolInput })} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText(/TAIL-4471/).textContent).toBe(JSON.stringify(toolInput, null, 2));
  });
});

describe('A4-4 a refused approval says why, in plain text and in the analyst’s language', () => {
  const expand = () => fireEvent.click(screen.getByRole('button', { expanded: false }));

  it('an old row that stored its reason as JSON shows the reason as plain text', () => {
    render(<AgentActionCard action={action({ toolName: 'deploy_agent', status: 'failed',
      resultSummary: JSON.stringify({ error: 'Tool "deploy_agent" is not available to this agent.' }) })} />);
    expand();
    expect(screen.getByText('Tool "deploy_agent" is not available to this agent.')).toBeInTheDocument();
    expect(screen.queryByText(/\{"error"/)).not.toBeInTheDocument();
  });

  it('a 2.0.2 proposal 2.0.3 no longer allows fails with a German reason, shown without JSON', async () => {
    await inGerman();
    await db.agentDeployments.add(deployment('ap-lead-analyst'));
    const old = action({ id: 'old-1', agentConfigId: 'ap-lead-analyst', toolName: 'create_in_investigation',
      toolInput: { investigationName: 'Private case', entityType: 'note', data: { title: 'Planted' } } });
    await db.agentActions.add(old);
    const result = await executeApprovedAction(old);
    expect(result.isError).toBe(true);
    const stored = await db.agentActions.get('old-1') as AgentAction;
    expect(stored.status).toBe('failed');
    const reason = deText('refusal.toolNotAllowed', { tool: 'create_in_investigation' });
    expect(reason).toContain('create_in_investigation');
    expect(JSON.parse(stored.resultSummary as string)).toEqual({ error: reason });

    render(<AgentActionCard action={stored} />);
    expand();
    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(screen.queryByText(/\{"error"/)).not.toBeInTheDocument();
  });

  it('an executed row keeps its result as the tool returned it', () => {
    render(<AgentActionCard action={action({ status: 'executed', resultSummary: '{"id":"n1"}' })} />);
    expand();
    expect(screen.getByText('{"id":"n1"}')).toHaveAttribute('dir', 'ltr');
  });

  it('an acknowledged question reads in the direction of its language', () => {
    const acknowledged = agentCatalogs['../../public/locales/ar/agent.json'].default['action.questionAcknowledged'];
    render(<AgentActionCard action={action({ toolName: 'ask_human', status: 'executed', resultSummary: acknowledged })} />);
    expand();
    expect(screen.getByText(acknowledged)).toHaveAttribute('dir', 'auto');
  });
});

describe('A4-5 the agent panel and cards speak the analyst’s language', () => {
  beforeEach(inGerman);

  it('an agent row names its role, its metrics and its escalations', async () => {
    const hunter = deployment('ap-threat-hunter', { metrics: {
      cyclesRun: 3, toolCallsExecuted: 2, toolCallsProposed: 1, tasksCompleted: 0, tasksRejected: 0, tokensUsed: { input: 9000, output: 3345 },
      lastCycleAt: 1, costUSD: 0.42, toolCallHistogram: { search_notes: 4 }, tasksEscalated: 1 } });
    render(<AgentPanel folder={await folder('S')} settings={settings} profiles={BUILTIN_AGENT_PROFILES} deployments={[hunter]} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: `${de['panel.agents']}(1)` }));
    expect(await screen.findByText(de['panel.roleSpecialist'])).toBeInTheDocument();
    expect(screen.queryByText('specialist')).not.toBeInTheDocument();
    for (const [key, count] of [['panel.cycles', 3], ['panel.exec', 2], ['panel.proposed', 1], ['panel.tokens', 12345], ['panel.escalated', 1]] as const) {
      expect(screen.getByText(deText(key, { count }))).toBeInTheDocument();
    }
    expect(screen.queryByText(/ tok$|escalated to human| cycles$/)).not.toBeInTheDocument();
    expect(screen.getByTitle(de['panel.mostUsedTool'])).toHaveTextContent('search_notes ×4');
    expect(screen.getByTitle(de['panel.escalatedTitle'])).toBeInTheDocument();
    expect(screen.getByTitle(deText('cycleSummary.tokensInOut', { in: (9000).toLocaleString(), out: (3345).toLocaleString() }))).toBeInTheDocument();
  });

  it('the tasks tab names each task’s status, priority and source', async () => {
    await db.tasks.add({ id: 'agent-task', folderId: 'S', title: 'Delegated follow-up', completed: false, priority: 'high', status: 'in-progress', order: 1,
      tags: ['agent-delegated'], createdBy: 'agent:ap-lead-analyst', trashed: false, archived: false, createdAt: 1, updatedAt: 1 });
    await db.tasks.add({ id: 'agent-task-2', folderId: 'S', title: 'Unranked follow-up', completed: false, priority: 'none', status: 'todo', order: 2,
      tags: [], createdBy: 'agent:ap-lead-analyst', trashed: false, archived: false, createdAt: 1, updatedAt: 1 });
    render(<AgentPanel folder={await folder('S')} settings={settings} profiles={BUILTIN_AGENT_PROFILES} deployments={[]} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: `${de['panel.tasks']}(2)` }));
    expect(await screen.findByText(deTasks['status.inProgress'])).toBeInTheDocument();
    expect(screen.getByText(deTasks['priority.high'])).toBeInTheDocument();
    expect(screen.getAllByText(de['panel.taskSourceAgent'])).toHaveLength(2);
    expect(screen.getByText(de['panel.taskSourceDelegated'])).toBeInTheDocument();
    expect(screen.queryByText(/^(in-progress|high|none|agent|delegated)$/)).not.toBeInTheDocument();
  });

  it('the logs tab counts and names each status', async () => {
    await db.agentActions.bulkAdd([
      action({ id: 'a1', status: 'executed' }), action({ id: 'a2', status: 'pending' }), action({ id: 'a3', status: 'failed' }),
    ]);
    render(<AgentPanel folder={await folder('S')} settings={settings} profiles={BUILTIN_AGENT_PROFILES} deployments={[]} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: de['panel.logs'] }));
    for (const [key, count] of [['panel.totalActions', 3], ['panel.executedCount', 1], ['panel.pendingCount', 1], ['panel.failedCount', 1]] as const) {
      expect(await screen.findByText(deText(key, { count }))).toBeInTheDocument();
    }
    for (const key of ['action.statusExecuted', 'action.statusPending', 'action.statusFailed']) expect(screen.getByText(de[key])).toBeInTheDocument();
    expect(screen.queryByText(/^Total:|^(executed|pending|failed)$/)).not.toBeInTheDocument();
  });

  it('the policy editor labels the interval, the focus areas and the local model', async () => {
    render(<AgentPanel folder={await folder('S')} settings={settings} profiles={BUILTIN_AGENT_PROFILES} deployments={[]} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: de['panel.toggleAgentSettings'] }));
    expect(await screen.findByLabelText(de['panel.interval'])).toBeInTheDocument();
    expect(screen.getByText(deText('panel.intervalMinutes', { count: 5 }))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: de['panel.focusAreas'] }));
    const focus = screen.getByRole('textbox', { name: de['panel.focusAreasLabel'] });
    expect(focus).toHaveAttribute('placeholder', de['panel.focusAreasPlaceholder']);
    expect(screen.getByText(de['panel.focusAreasHint'])).toBeInTheDocument();
    expect(document.querySelector('optgroup:last-of-type')).toHaveAttribute('label', de['panel.localModels']);
    expect(screen.getByRole('option', { name: deText('panel.localModel', { name: 'fixture-local-model' }) })).toBeInTheDocument();
    expect(screen.queryByText(/^(Interval|Focus areas)$/)).not.toBeInTheDocument();
  });

  it('a failed load says so in German', async () => {
    const failing = vi.spyOn(db.agentActions, 'where').mockImplementationOnce(() => { throw 'not an Error'; });
    try {
      render(<AgentPanel folder={await folder('S')} settings={settings} profiles={BUILTIN_AGENT_PROFILES} deployments={[]} />);
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(de['panel.loadActionsFailed']));
    } finally { failing.mockRestore(); }
  });

  it.each([['warning', 'action.severityWarning'], ['critical', 'action.severityCritical']] as const)('a card names its %s severity', (severity, key) => {
    render(<AgentActionCard action={action({ toolName: 'ask_human', status: 'executed', severity })} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText(de[key])).toBeInTheDocument();
    expect(screen.queryByText(severity)).not.toBeInTheDocument();
  });
});

describe('A4-6 and A4-7 phone layout (measured in Playwright; these pin the structure)', () => {
  it('a long tool name wraps instead of running under the status badge', () => {
    render(<AgentActionCard action={action({ toolName: 'search_across_investigations', status: 'failed' })} />);
    const name = screen.getByText('search_across_investigations');
    expect(name).toHaveClass('min-w-0', 'break-all');
    expect(screen.getByText('Read')).toHaveClass('shrink-0');
    expect(name.parentElement?.parentElement).toHaveClass('flex-wrap');
  });

  it('the approve-all confirmation is its own row with touch-size buttons', async () => {
    await db.agentActions.add(action({ id: 'p1', toolInput: { title: 'Summary' } }));
    render(<AgentPanel folder={await folder('S')} settings={settings} profiles={BUILTIN_AGENT_PROFILES} deployments={[]} />);
    fireEvent.click(await screen.findByRole('button', { name: /approve all/i }));
    const yes = await screen.findByRole('button', { name: 'Yes' });
    const no = screen.getByRole('button', { name: 'No' });
    expect(screen.getByRole('tablist').parentElement?.contains(yes)).toBe(false);
    for (const button of [yes, no]) expect(button).toHaveClass('min-h-11', 'min-w-11', 'md:min-h-0', 'md:min-w-0');
  });
});

describe('A4 catalogs', () => {
  const ADDED = [
    'action.lookupDestinations', 'action.lookupNone', 'action.lookupUnavailable', 'action.lookupChecking', 'action.severityWarning', 'action.severityCritical',
    'action.questionAcknowledged',
    'refusal.serverProposal', 'refusal.investigationUnavailable', 'refusal.profileGone', 'refusal.toolNotAllowed', 'refusal.targetMoved',
    'refusal.targetInvestigationUnavailable', 'refusal.supervisorIocGone', 'refusal.supervisorLinkGone',
    'refusal.otherInvestigationChange', 'refusal.otherInvestigationRead', 'refusal.notInInvestigation', 'refusal.toolChanged',
    'refusal.readOnlyEntity', 'refusal.taskEscalated',
    'panel.roleExecutive', 'panel.roleLead', 'panel.roleSpecialist', 'panel.roleObserver',
    'panel.cycles_one', 'panel.cycles_other', 'panel.exec_one', 'panel.exec_other', 'panel.proposed_one', 'panel.proposed_other',
    'panel.tokens_one', 'panel.tokens_other', 'panel.mostUsedTool', 'panel.escalated_one', 'panel.escalated_other', 'panel.escalatedTitle',
    'panel.taskSourceAgent', 'panel.taskSourceDelegated', 'panel.totalActions_one', 'panel.totalActions_other',
    'panel.executedCount_one', 'panel.executedCount_other', 'panel.pendingCount_one', 'panel.pendingCount_other',
    'panel.failedCount_one', 'panel.failedCount_other', 'panel.intervalMinutes_one', 'panel.intervalMinutes_other',
    'panel.focusAreasLabel', 'panel.localModels', 'panel.localModel', 'panel.loadActionsFailed',
    'builtinProfile.forensicateScanner.descriptionV2',
  ];
  const SUPERSEDED = ['action.vendorLookups', 'panel.cycles', 'panel.exec', 'panel.proposed', 'panel.totalActions', 'panel.executedCount', 'panel.pendingCount', 'panel.failedCount'];

  it('German translates every added string', () => {
    for (const key of ADDED) {
      expect(en[key], key).toBeTruthy();
      expect(de[key], key).toBeTruthy();
      expect(de[key], key).not.toBe(en[key]);
    }
  });

  // The plural form follows the raw count, but a compact number such as 12 ألف or 2 тыс. takes its own noun form.
  it.each([
    ['ar', 6, 'الرموز: {{count, number(notation: compact)}}'],
    ['ru', 4, 'Токены: {{count, number(notation: compact)}}'],
    ['uk', 4, 'Токени: {{count, number(notation: compact)}}'],
    ['pl', 4, 'Tokeny: {{count, number(notation: compact)}}'],
  ] as const)('%s names the token total as a label: no counted noun follows a compact number', (lng, count, label) => {
    const catalog = agentCatalogs[`../../public/locales/${lng}/agent.json`].default;
    const forms = Object.keys(catalog).filter(key => key.startsWith('panel.tokens_'));
    expect(forms).toHaveLength(count);
    for (const key of forms) expect(catalog[key], key).toBe(label);
  });

  it('every language has the added strings and none keeps a superseded one', () => {
    expect(Object.keys(agentCatalogs)).toHaveLength(21);
    for (const [path, catalog] of Object.entries(agentCatalogs)) {
      for (const key of ADDED) expect(catalog.default[key], `${path} ${key}`).toBeTruthy();
      for (const key of SUPERSEDED) expect(catalog.default[key], `${path} ${key}`).toBeUndefined();
    }
  });
});
