/** The investigation filter bar and the sidebar's investigation status, both always visible, in the analyst's language. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActiveFilterBar } from '../components/Common/ActiveFilterBar';
import { Sidebar } from '../components/Layout/Sidebar';
import i18n from '../i18n';
import deCommon from '../../public/locales/de/common.json';
import deInvestigations from '../../public/locales/de/investigations.json';
import type { InvestigationStatus } from '../types';

const de = deInvestigations as Record<string, string>;
const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name]));
const selected = vi.hoisted(() => ({ status: undefined as InvestigationStatus | undefined }));

vi.mock('../contexts/NavigationContext', () => ({
  useNavigation: () => ({ activeView: 'notes', selectedTimelineId: undefined, setSelectedTimelineId: vi.fn(), selectedWhiteboardId: undefined, setSelectedWhiteboardId: vi.fn(), navigateTo: vi.fn() }),
}));
vi.mock('../contexts/InvestigationContext', () => ({
  useInvestigation: () => ({
    selectedFolderId: 'case', folders: [{ id: 'case', name: 'Fictional Case Alpha', order: 0, createdAt: 1, status: selected.status }], tags: [],
    selectedTag: undefined, setSelectedTag: vi.fn(), setSelectedFolderId: vi.fn(), showTrash: false, setShowTrash: vi.fn(),
    showArchive: false, setShowArchive: vi.fn(), setEditingFolderId: vi.fn(), agentPendingCount: 0,
  }),
}));
vi.mock('../contexts/UIModalContext', () => ({ useUIModals: () => ({ openSettings: vi.fn() }) }));
vi.mock('../hooks/ScreenshareContext', () => ({ useScreenshare: () => ({ maxLevel: null }) }));

beforeEach(async () => {
  for (const [namespace, values] of Object.entries(i18n.getDataByLanguage('en') ?? {})) i18n.addResourceBundle('de', namespace, values, true, false);
  i18n.addResourceBundle('de', 'common', deCommon, true, true);
  i18n.addResourceBundle('de', 'investigations', deInvestigations, true, true);
  await act(async () => { await i18n.changeLanguage('de'); });
});
afterEach(async () => { cleanup(); await act(async () => { await i18n.changeLanguage('en'); }); });

describe('investigation filter bar in the analyst\'s language', () => {
  it('names Show all, the details link and the playbook progress', () => {
    const onClear = vi.fn();
    const execution = { templateId: 'pb', templateName: 'Fictional triage', startedAt: 1,
      steps: [{ stepIndex: 0, completed: true }, { stepIndex: 1, completed: false }, { stepIndex: 2, completed: false }] };
    const view = render(<ActiveFilterBar folderName="Fictional Case Alpha" folderStatus="active" onClear={onClear} onEditFolder={vi.fn()} playbookExecution={execution} />);
    const showAll = screen.getByRole('button', { name: de['filterBar.showAll'] });
    expect(showAll).toHaveTextContent(de['filterBar.showAll']);
    expect(showAll).toHaveAttribute('title', de['filterBar.showAll']);
    fireEvent.click(showAll);
    expect(onClear).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Fictional Case Alpha' })).toHaveAttribute('title', de['filterBar.viewDetails']);
    expect(screen.getByTitle(fill(de['filterBar.playbookProgress_other'], { name: 'Fictional triage', completed: 1, count: 3 }))).toBeInTheDocument();
    expect(view.container).not.toHaveTextContent(/Show all/i);
    expect(view.container.querySelector('[title*="steps"], [title="View investigation details"], [title="Show all"]')).toBeNull();
    view.unmount();

    render(<ActiveFilterBar folderName="Fictional Case Alpha" onClear={vi.fn()} playbookExecution={{ ...execution, steps: [{ stepIndex: 0, completed: true }] }} />);
    expect(screen.getByTitle(fill(de['filterBar.playbookProgress_one'], { name: 'Fictional triage', completed: 1, count: 1 }))).toBeInTheDocument();
  });
});

describe('sidebar investigation status in the analyst\'s language', () => {
  it.each([[undefined, 'hub.active'], ['active', 'hub.active'], ['closed', 'hub.closed'], ['archived', 'hub.archived']] as const)(
    'status %s', (status, key) => {
      selected.status = status;
      render(<Sidebar collapsed={false} onToggleCollapsed={vi.fn()} noteCounts={{ total: 0, archived: 0, trashed: 0 }} taskCounts={{ todo: 0, 'in-progress': 0, done: 0, total: 0 }} />);
      const card = screen.getByTitle((deCommon as Record<string, string>)['sidebar.investigationSettings']);
      expect(card).toHaveTextContent(de[key]);
      expect(card).not.toHaveTextContent(/Active|Closed|Archived/);
    });
});
