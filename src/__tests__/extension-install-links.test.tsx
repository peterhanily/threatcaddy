/** While the Chrome Web Store serves extension 1.1.1, which the app does not use, every in-app install link
 * goes to the GitHub release with the install steps, and says the store version is older. */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Header } from '../components/Layout/Header';
import { Sidebar } from '../components/Layout/Sidebar';
import { ChatInput } from '../components/Chat/ChatInput';
import i18n from '../i18n';
import enCommon from '../../public/locales/en/common.json';
import deCommon from '../../public/locales/de/common.json';
import enChat from '../../public/locales/en/chat.json';

vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn(), toasts: [], removeToast: vi.fn() }) }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ connected: false, user: null, serverUrl: null }) }));
vi.mock('../contexts/UIModalContext', () => ({
  useUIModals: () => ({ screenshareMaxLevel: null, setScreenshareMaxLevel: vi.fn(), setSearchOverlayOpen: vi.fn(), openSettings: vi.fn() }),
}));
vi.mock('../contexts/InvestigationContext', () => ({
  useInvestigation: () => ({
    selectedFolder: undefined, selectedFolderId: undefined, folders: [], tags: [], selectedTag: undefined, setSelectedTag: vi.fn(),
    setSelectedFolderId: vi.fn(), showTrash: false, setShowTrash: vi.fn(), showArchive: false, setShowArchive: vi.fn(),
    setEditingFolderId: vi.fn(), agentPendingCount: 0,
  }),
}));
vi.mock('../contexts/NavigationContext', () => ({
  useNavigation: () => ({ activeView: 'notes', selectedTimelineId: undefined, setSelectedTimelineId: vi.fn(), selectedWhiteboardId: undefined, setSelectedWhiteboardId: vi.fn(), navigateTo: vi.fn() }),
}));
vi.mock('../hooks/ScreenshareContext', () => ({ useScreenshare: () => ({ maxLevel: null }) }));

const RELEASES = 'https://github.com/peterhanily/threatcaddy/releases/latest';
const STEPS = 'https://github.com/peterhanily/threatcaddy/blob/main/extension/README.md#install--chrome';
const common = enCommon as Record<string, string>;

afterEach(async () => { cleanup(); await act(async () => { await i18n.changeLanguage('en'); }); });

function header() {
  render(<Header theme="dark" onToggleTheme={vi.fn()} onQuickNote={vi.fn()} onNewNote={vi.fn()} onNewTask={vi.fn()} onNewTimelineEvent={vi.fn()}
    onNewWhiteboard={vi.fn()} onToggleSidebar={vi.fn()} onMobileMenuToggle={vi.fn()} sidebarCollapsed={false} onQuickSave={vi.fn()} onQuickLoad={vi.fn()}
    effectiveClsLevels={['TLP:CLEAR']} />);
  fireEvent.click(screen.getByRole('button', { name: common['header.helpMenu'] }));
  return document.body;
}
function sidebar() {
  render(<Sidebar collapsed={false} onToggleCollapsed={vi.fn()} noteCounts={{ total: 0, archived: 0, trashed: 0 }} taskCounts={{ todo: 0, 'in-progress': 0, done: 0, total: 0 }} />);
  return document.body;
}
function chatBanner() {
  render(<ChatInput onSend={vi.fn()} onStop={vi.fn()} isStreaming={false} extensionAvailable={false} model="claude-sonnet-4-6" onModelChange={vi.fn()} />);
  return screen.getByText(enChat.input.extensionRequiredTitle).parentElement as HTMLElement;
}

/** Links that send people to an extension store. */
const storeLinks = (place: HTMLElement) => [...place.querySelectorAll('a')].filter(link => /chromewebstore|addons\.mozilla/.test(link.href));

describe('in-app extension install links', () => {
  it.each([['the header help menu', header], ['the sidebar', sidebar], ['the CaddyAI connection banner', chatBanner]])(
    '%s links the GitHub release and its install steps, and says the store version is older', (_place, open) => {
      const place = open();
      const links = within(place).getAllByRole('link');
      expect(links.filter(link => link.getAttribute('href') === RELEASES)).toHaveLength(1);
      expect(within(place).getByRole('link', { name: common['extension.installSteps'] })).toHaveAttribute('href', STEPS);
      expect(within(place).getByText(common['extension.storeOlder'], { exact: false })).toBeInTheDocument();
      for (const link of links.filter(link => [RELEASES, STEPS].includes(link.getAttribute('href') ?? ''))) {
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      }
      expect(storeLinks(place)).toEqual([]);
    });

  it('names the version CaddyAI needs where it asks for the extension', () => {
    expect(chatBanner()).toHaveTextContent('1.1.3');
  });

  it('says the same in the analyst’s language', async () => {
    for (const [namespace, values] of Object.entries(i18n.getDataByLanguage('en') ?? {})) i18n.addResourceBundle('de', namespace, values, true, false);
    i18n.addResourceBundle('de', 'common', deCommon, true, true);
    await act(async () => { await i18n.changeLanguage('de'); });
    const german = deCommon as Record<string, string>;
    for (const key of ['extension.menuLink', 'extension.installSteps', 'extension.storeOlder']) expect(german[key], key).not.toBe(common[key]);
    // The header's notification bell applies the stored settings language, so the sidebar shows it here.
    const place = sidebar();
    expect(within(place).getByRole('link', { name: german['extension.menuLink'] })).toHaveAttribute('href', RELEASES);
    expect(within(place).getByRole('link', { name: german['extension.installSteps'] })).toHaveAttribute('href', STEPS);
    expect(within(place).getByText(german['extension.storeOlder'], { exact: false })).toBeInTheDocument();
  });
});
