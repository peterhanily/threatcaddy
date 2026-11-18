/**
 * S4-3: the Supervisor Briefing (Investigations hub) and the AgentCaddy dashboard
 * read the local-only investigation the supervisor writes to. An older synced
 * 'CaddyAgent Supervisor' folder, or a teammate's, is an ordinary investigation.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import type { AgentAction, Folder } from '../types';
import { SupervisorSummary } from '../components/Agent/SupervisorSummary';
import { AgentDashboard } from '../components/Agent/AgentDashboard';
import { findSupervisorFolder } from '../lib/caddy-agent-supervisor';
import { clearAIWorkspace } from './helpers/ai-workspace';
import i18n from '../i18n';
import deInvestigations from '../../public/locales/de/investigations.json';
import enInvestigations from '../../public/locales/en/investigations.json';
import jaAgent from '../../public/locales/ja/agent.json';

const NAME = 'CaddyAgent Supervisor';
const agentCatalogs = import.meta.glob<{ default: Record<string, string> }>('../../public/locales/*/agent.json', { eager: true });

async function folderWithNote(id: string, finding: string, extra: Partial<Folder> = {}) {
  await db.folders.add({ id, name: NAME, icon: '🤖', order: 9999, createdAt: 1, status: 'active', ...extra });
  await db.notes.add({ id: `${id}-note`, folderId: id, title: finding, content: `${finding} body`, tags: [], pinned: false, archived: false, trashed: false, createdAt: 1, updatedAt: 1 });
}
const action = (id: string, investigationId: string, toolName: string): AgentAction =>
  ({ id, investigationId, threadId: 't', toolName, toolInput: {}, rationale: 'r', status: 'executed', createdAt: 1 });

beforeEach(async () => { await clearAIWorkspace(); });
afterEach(async () => { cleanup(); await act(async () => { await i18n.changeLanguage('en'); }); });

describe('which folder is the supervisor\'s', () => {
  it('is the local-only one, also when only the sync marker says so, and never a synced one', async () => {
    await folderWithNote('A-old', 'OLD-FINDING');
    expect(await findSupervisorFolder()).toBeUndefined();
    await folderWithNote('Z-new', 'NEW-FINDING');
    await db.table('_syncMeta').put({ key: JSON.stringify(['localOnly', 'Z-new']), value: true });
    expect((await findSupervisorFolder())?.id).toBe('Z-new');
    // Looking does not create one.
    expect(await db.folders.count()).toBe(2);
  });
});

describe('the Supervisor Briefing card', () => {
  it('shows the local-only supervisor folder when an older synced one sorts first', async () => {
    await folderWithNote('A-old', 'OLD-FINDING');
    await folderWithNote('Z-new', 'NEW-FINDING', { localOnly: true });
    const open = vi.fn();
    render(<SupervisorSummary onOpenSupervisor={open} />);
    expect(await screen.findByText('NEW-FINDING body')).toBeInTheDocument();
    expect(screen.queryByText(/OLD-FINDING/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(open).toHaveBeenCalledWith('Z-new');
  });

  it('never shows a teammate\'s synced folder of that name', async () => {
    await folderWithNote('team', 'TEAMMATE-TEXT');
    const { container } = render(<SupervisorSummary />);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    expect(container.textContent).toBe('');
  });

  it('is in the analyst\'s language, with the plural form', async () => {
    for (const [namespace, values] of Object.entries(i18n.getDataByLanguage('en') ?? {})) i18n.addResourceBundle('de', namespace, values, true, false);
    i18n.addResourceBundle('de', 'investigations', deInvestigations, true, true);
    await act(async () => { await i18n.changeLanguage('de'); });
    await db.folders.add({ id: 'sup', name: NAME, order: 9999, createdAt: 1, localOnly: true });
    await db.notes.add({ id: 'n', folderId: 'sup', title: 'Findings', content: 'A shared IOC in two cases. A second shared IOC too.', tags: [], pinned: false, archived: false, trashed: false, createdAt: 1, updatedAt: 1 });
    render(<SupervisorSummary />);
    expect(await screen.findByText(deInvestigations['supervisor.briefing'])).toBeInTheDocument();
    expect(screen.getByText(deInvestigations['supervisor.sharedIocPatterns_other'].replace('{{count}}', '2'))).toBeInTheDocument();
    expect(screen.queryByText('Supervisor Briefing')).not.toBeInTheDocument();
  });

  it('has a German text for each of its strings that differs from the English one', () => {
    for (const key of ['supervisor.briefing', 'supervisor.sharedIocPatterns_one', 'supervisor.sharedIocPatterns_other'] as const) {
      expect(deInvestigations[key], key).toBeTruthy();
      expect(deInvestigations[key], key).not.toBe(enInvestigations[key]);
    }
  });
});

describe('the AgentCaddy dashboard', () => {
  it('briefs from the local-only supervisor folder and lists an older synced one as an ordinary investigation', async () => {
    await folderWithNote('A-old', 'OLD-FINDING', { agentEnabled: true });
    await folderWithNote('Z-new', 'NEW-FINDING', { localOnly: true, agentEnabled: true });
    await db.agentActions.bulkAdd([action('old-act', 'A-old', 'link_entities'), action('sup-act', 'Z-new', 'create_task')]);
    const open = vi.fn();
    const folders = (await db.folders.toArray()).sort((a, b) => a.order - b.order);
    const { container } = render(<AgentDashboard folders={folders} onOpenInvestigation={open} />);

    expect(await screen.findByText('NEW-FINDING')).toBeInTheDocument();
    expect(screen.queryByText('OLD-FINDING')).not.toBeInTheDocument();
    await waitFor(() => expect(container.textContent).toContain('link_entities'));
    expect(container.textContent).not.toContain('create_task');
    // Both lists show the older folder by name with its activity, and neither shows the supervisor's.
    for (const heading of ['Investigations with Agent Activity', 'Recent Agent Activity']) {
      const section = screen.getByRole('heading', { name: heading }).closest('section') as HTMLElement;
      expect(within(section).getByText(NAME), heading).toBeInTheDocument();
      expect(within(section).getByText('link_entities'), heading).toBeInTheDocument();
      expect(within(section).queryByText('create_task'), heading).not.toBeInTheDocument();
    }
    expect(screen.getByText('1 active agent')).toBeInTheDocument();
    fireEvent.click(screen.getByText('NEW-FINDING'));
    expect(open).toHaveBeenLastCalledWith('Z-new');
  });

  describe('the supervisor\'s own proposals', () => {
    const pendingIn = (id: string, investigationId: string): AgentAction =>
      ({ ...action(id, investigationId, 'create_note'), agentConfigId: 'caddy-supervisor', status: 'pending' });

    it('says how many wait for approval, counts them, and opens its investigation, before it has any notes', async () => {
      await db.folders.add({ id: 'Z-new', name: NAME, icon: '🤖', order: 9999, createdAt: 1, status: 'active', localOnly: true });
      await db.agentActions.bulkAdd([pendingIn('p1', 'Z-new'), pendingIn('p2', 'Z-new'), { ...pendingIn('done', 'Z-new'), status: 'executed' }]);
      const open = vi.fn();
      render(<AgentDashboard folders={await db.folders.toArray()} onOpenInvestigation={open} />);
      const section = (await screen.findByRole('heading', { name: 'Supervisor Briefings' })).closest('section') as HTMLElement;
      const review = within(section).getByRole('button', { name: /2 supervisor proposals wait for your approval/ });
      expect(review).toHaveTextContent('Review');
      expect(screen.getByText('2 pending')).toBeInTheDocument();
      expect(screen.queryByText('Get started with AgentCaddy')).not.toBeInTheDocument();
      fireEvent.click(review);
      expect(open).toHaveBeenCalledWith('Z-new');
    });

    it('leaves out an older synced folder\'s, which its own card counts, and says nothing when none wait', async () => {
      await folderWithNote('A-old', 'OLD-FINDING');
      await folderWithNote('Z-new', 'NEW-FINDING', { localOnly: true });
      await db.agentActions.add(pendingIn('old', 'A-old'));
      render(<AgentDashboard folders={await db.folders.toArray()} onOpenInvestigation={vi.fn()} />);
      expect(await screen.findByText('NEW-FINDING')).toBeInTheDocument();
      expect(screen.queryByText(/supervisor proposals? waits? for your approval/)).not.toBeInTheDocument();
      expect(screen.getAllByText('1 pending')).toHaveLength(2);
    });

    it.each([['ru', 5], ['ar', 2], ['de', 1]])('reads in %s with that language\'s plural form for %s', async (lng, count) => {
      const values = agentCatalogs[`../../public/locales/${lng}/agent.json`].default;
      for (const [namespace, bundle] of Object.entries(i18n.getDataByLanguage('en') ?? {})) i18n.addResourceBundle(lng, namespace, bundle, true, false);
      i18n.addResourceBundle(lng, 'agent', values, true, true);
      await act(async () => { await i18n.changeLanguage(lng); });
      await db.folders.add({ id: 'Z-new', name: NAME, order: 9999, createdAt: 1, status: 'active', localOnly: true });
      await db.agentActions.bulkAdd(Array.from({ length: count }, (_, i) => pendingIn(`p${i}`, 'Z-new')));
      render(<AgentDashboard folders={await db.folders.toArray()} onOpenInvestigation={vi.fn()} />);
      const form = new Intl.PluralRules(lng).select(count);
      expect(await screen.findByText(values[`dashboard.supervisorPending_${form}`].replace('{{count}}', String(count)))).toBeInTheDocument();
      expect(screen.getByText(values['dashboard.reviewSupervisorProposals'])).toBeInTheDocument();
    });

    it('every language has each plural form its rules need, and German translates every string', () => {
      expect(Object.keys(agentCatalogs)).toHaveLength(21);
      for (const [path, { default: values }] of Object.entries(agentCatalogs)) {
        const lng = path.split('/').at(-2) as string;
        for (const form of new Set(['one', 'other', ...new Intl.PluralRules(lng).resolvedOptions().pluralCategories])) {
          expect(values[`dashboard.supervisorPending_${form}`], `${lng} ${form}`).toContain('{{count}}');
        }
        expect(values['dashboard.reviewSupervisorProposals'], lng).toBeTruthy();
      }
      const de = agentCatalogs['../../public/locales/de/agent.json'].default;
      const en = agentCatalogs['../../public/locales/en/agent.json'].default;
      for (const key of ['dashboard.supervisorPending_one', 'dashboard.supervisorPending_other', 'dashboard.reviewSupervisorProposals']) {
        expect(de[key], key).toBeTruthy();
        expect(de[key], key).not.toBe(en[key]);
      }
    });
  });

  describe('in the analyst\'s language', () => {
    // Japanese, because the German 'auto' badge is the same word as the English one.
    beforeEach(async () => {
      for (const [namespace, values] of Object.entries(i18n.getDataByLanguage('en') ?? {})) i18n.addResourceBundle('ja', namespace, values, true, false);
      i18n.addResourceBundle('ja', 'agent', jaAgent, true, true);
      await act(async () => { await i18n.changeLanguage('ja'); });
    });

    it('labels an investigation card\'s pending proposals and auto mode', async () => {
      await db.folders.add({ id: 'case', name: 'Case', order: 0, createdAt: 1, status: 'active', agentEnabled: true });
      await db.agentActions.add({ ...action('p', 'case', 'create_note'), status: 'pending' });
      render(<AgentDashboard folders={await db.folders.toArray()} onOpenInvestigation={vi.fn()} />);
      const section = (await screen.findByRole('heading', { name: jaAgent['dashboard.investigationsWithAgentActivity'] })).closest('section') as HTMLElement;
      expect(within(section).getByText(jaAgent['dashboard.pendingCount'].replace('{{count}}', '1'))).toBeInTheDocument();
      expect(within(section).getByText(jaAgent['dashboard.auto'])).toBeInTheDocument();
      expect(section.textContent).not.toMatch(/pending|auto/);
    });

    it('gives the getting-started steps, with their emphasis', async () => {
      const { container } = render(<AgentDashboard folders={[]} onOpenInvestigation={vi.fn()} />);
      expect(await screen.findByText(jaAgent['dashboard.getStarted'])).toBeInTheDocument();
      for (const key of ['dashboard.step1', 'dashboard.step2', 'dashboard.step3', 'dashboard.step4'] as const) {
        expect(container.textContent, key).toContain(jaAgent[key].replace(/<\/?strong>/g, ''));
      }
      expect(screen.getByText('AgentCaddy', { selector: 'strong' })).toBeInTheDocument();
      expect(container.textContent).not.toContain('Open an investigation');
    });
  });
});
