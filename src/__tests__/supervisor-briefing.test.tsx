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

const NAME = 'CaddyAgent Supervisor';

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
});
