/**
 * A4: the agent inbox tells the truth, in the analyst's language: which
 * lookups an enrichment proposal sends the IOC to, the whole input a proposal
 * sends, why a proposal failed, and the panel's own labels.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import type { AgentAction, AgentDeployment } from '../types';
import type { InstalledIntegration, IntegrationTemplate } from '../types/integration-types';
import { AgentActionCard } from '../components/Agent/AgentActionCard';
import { AgentProfilePicker } from '../components/Agent/AgentProfilePicker';
import { executeApprovedAction } from '../lib/agent-action-approval';
import { FORENSICATE_AGENT_PROFILE } from '../lib/forensicate-tool';
import { ids, seedAIWorkspace } from './helpers/ai-workspace';
import { installEgressSpy, type EgressSpy } from './helpers/egress-spy';
import i18n from '../i18n';
import enAgent from '../../public/locales/en/agent.json';
import deAgent from '../../public/locales/de/agent.json';
import deTasks from '../../public/locales/de/tasks.json';

vi.mock('../components/Agent/AgentMeetingPanel', () => ({ AgentMeetingPanel: () => null }));

const agentCatalogs = import.meta.glob<{ default: Record<string, string> }>('../../public/locales/*/agent.json', { eager: true });
const de = deAgent as Record<string, string>;
const en = enAgent as Record<string, string>;
const action = (values: Partial<AgentAction>): AgentAction => ({ id: `action-${values.toolName}`, investigationId: 'S', threadId: 't', toolName: 'create_note',
  toolInput: {}, rationale: 'Proposed by the agent', status: 'pending', createdAt: 1, ...values });
const deployment = (profileId: string, values: Partial<AgentDeployment> = {}): AgentDeployment => ({ id: `dep-${profileId}`, investigationId: 'S', profileId,
  status: 'idle', order: 0, createdAt: 1, updatedAt: 1, ...values });
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
    expect(screen.getByTitle(title => title.endsWith(`: ${de['builtinProfile.forensicateScanner.descriptionV2']}`))).toBeInTheDocument();
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
    expect(await screen.findByText('Nothing is sent: no enabled lookup applies to canary-p.example.')).toBeInTheDocument();
    await executeApprovedAction(elsewhere);
    expect(egress.fetches).toEqual([]);
    view.rerender(<AgentActionCard action={{ ...proposal(), status: 'executed' }} />);
    await act(async () => {});
    expect(screen.queryByText(/^Sends |^Nothing is sent|^Checking/)).not.toBeInTheDocument();
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
    expect(screen.getByText('{"id":"n1"}')).toBeInTheDocument();
  });
});

describe('A4 catalogs', () => {
  const ADDED = [
    'action.lookupDestinations', 'action.lookupNone', 'action.lookupChecking', 'action.questionAcknowledged',
    'refusal.serverProposal', 'refusal.investigationUnavailable', 'refusal.profileGone', 'refusal.toolNotAllowed', 'refusal.targetMoved',
    'builtinProfile.forensicateScanner.descriptionV2',
  ];
  const SUPERSEDED = ['action.vendorLookups'];

  it('German translates every added string', () => {
    for (const key of ADDED) {
      expect(en[key], key).toBeTruthy();
      expect(de[key], key).toBeTruthy();
      expect(de[key], key).not.toBe(en[key]);
    }
  });

  it('every language has the added strings and none keeps a superseded one', () => {
    expect(Object.keys(agentCatalogs)).toHaveLength(21);
    for (const [path, catalog] of Object.entries(agentCatalogs)) {
      for (const key of ADDED) expect(catalog.default[key], `${path} ${key}`).toBeTruthy();
      for (const key of SUPERSEDED) expect(catalog.default[key], `${path} ${key}`).toBeUndefined();
    }
  });
});
