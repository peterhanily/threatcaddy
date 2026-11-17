/**
 * The sidebar's AgentCaddy row names the agent status in the analyst's
 * language, as the AgentCaddy panel header does.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from '../components/Layout/Sidebar';
import i18n from '../i18n';
import deCommon from '../../public/locales/de/common.json';

vi.mock('../contexts/NavigationContext', () => ({
  useNavigation: () => ({ activeView: 'agent', selectedTimelineId: undefined, setSelectedTimelineId: vi.fn(), selectedWhiteboardId: undefined, setSelectedWhiteboardId: vi.fn(), navigateTo: vi.fn() }),
}));
vi.mock('../contexts/InvestigationContext', () => ({
  useInvestigation: () => ({
    selectedFolderId: 'case', folders: [{ id: 'case', name: 'Case', order: 0, createdAt: 1, agentEnabled: true }], tags: [],
    selectedTag: undefined, setSelectedTag: vi.fn(), setSelectedFolderId: vi.fn(), showTrash: false, setShowTrash: vi.fn(),
    showArchive: false, setShowArchive: vi.fn(), setEditingFolderId: vi.fn(), agentPendingCount: 0,
  }),
}));
vi.mock('../contexts/UIModalContext', () => ({ useUIModals: () => ({ openSettings: vi.fn() }) }));
vi.mock('../hooks/ScreenshareContext', () => ({ useScreenshare: () => ({ maxLevel: null }) }));

const renderSidebar = (agentStatus: 'running' | 'waiting' | 'paused' | 'error') => render(
  <Sidebar collapsed={false} onToggleCollapsed={vi.fn()} noteCounts={{ total: 0, archived: 0, trashed: 0 }} taskCounts={{ todo: 0, 'in-progress': 0, done: 0, total: 0 }}
    agentStatus={agentStatus} />,
);

beforeEach(async () => {
  for (const [namespace, values] of Object.entries(i18n.getDataByLanguage('en') ?? {})) i18n.addResourceBundle('de', namespace, values, true, false);
  i18n.addResourceBundle('de', 'common', deCommon, true, true);
  await i18n.changeLanguage('de');
});
afterEach(async () => { cleanup(); await act(async () => { await i18n.changeLanguage('en'); }); });

describe('sidebar AgentCaddy status in the analyst’s language', () => {
  it.each([['running', 'läuft'], ['waiting', 'wartet'], ['paused', 'pausiert'], ['error', 'Fehler']] as const)(
    'the %s badge', (status, german) => {
      renderSidebar(status);
      expect(screen.getByText(german)).toBeInTheDocument();
      expect(screen.queryByText(status)).not.toBeInTheDocument();
    });
});
