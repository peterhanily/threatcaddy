import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPanel } from '../components/Settings/SettingsPanel';
import { DEFAULT_SETTINGS } from '../types';
import type { Settings } from '../types';
import { workspaceStorageKey } from '../lib/workspace-profiles';
import packageJson from '../../package.json';

// Mock contexts
vi.mock('../contexts/ToastContext', () => ({
  useToast: () => ({ addToast: vi.fn(), toasts: [], removeToast: vi.fn() }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ connected: false, user: null, serverUrl: null }),
}));

// Mock child components that have complex dependencies
vi.mock('../components/Settings/ExportImport', () => ({
  ExportImport: () => <div data-testid="export-import">ExportImport</div>,
}));
vi.mock('../components/Settings/ThreatIntelConfig', () => ({
  ThreatIntelConfig: () => <div data-testid="threat-intel-config">ThreatIntelConfig</div>,
}));
vi.mock('../components/Settings/CloudBackup', () => ({
  CloudBackup: () => <div data-testid="cloud-backup">CloudBackup</div>,
}));
vi.mock('../components/Settings/KeyboardShortcuts', () => ({
  KeyboardShortcuts: () => <div data-testid="keyboard-shortcuts">KeyboardShortcuts</div>,
}));
vi.mock('../components/Encryption/EncryptionSettings', () => ({
  EncryptionSettings: () => <div data-testid="encryption-settings">EncryptionSettings</div>,
}));
vi.mock('../components/Integrations/IntegrationPanel', () => ({
  IntegrationPanel: () => <div data-testid="integration-panel">IntegrationPanel</div>,
}));
vi.mock('../components/Settings/ServerBackup', () => ({
  ServerBackup: () => <div data-testid="server-backup">ServerBackup</div>,
}));

const defaultProps = {
  settings: { ...DEFAULT_SETTINGS } as Settings,
  onUpdateSettings: vi.fn(),
  notes: [],
  onImportComplete: vi.fn(),
};

function clickTab(label: string) {
  fireEvent.click(screen.getByRole('tab', { name: label }));
}

describe('SettingsPanel', () => {
  it('uses manual horizontal tab activation, wrapped arrow focus, Home/End and one tab stop', async () => {
    const user = userEvent.setup();
    render(<SettingsPanel {...defaultProps} />);
    const tablist = screen.getByRole('tablist', { name: 'Settings' });
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs).toHaveLength(9);
    expect(tablist).toHaveAttribute('aria-orientation', 'horizontal');
    expect(tabs.filter(tab => tab.tabIndex === 0)).toEqual([screen.getByRole('tab', { name: 'General' })]);
    await user.click(screen.getByRole('tab', { name: 'General' }));
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Shortcuts' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'General' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Shortcuts' })).toHaveFocus();
    await user.keyboard('{Home}{ArrowRight}{Enter}');
    const appearance = screen.getByRole('tab', { name: 'Appearance' });
    expect(appearance).toHaveFocus();
    expect(appearance).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}{ArrowUp}');
    expect(appearance).toHaveFocus();
    await user.tab();
    const panel = screen.getByRole('tabpanel', { name: 'Appearance' });
    expect(panel).toHaveFocus();
    expect(appearance.getAttribute('aria-controls')).toBe(panel.id);
    await user.tab({ shift: true });
    expect(appearance).toHaveFocus();
    await user.keyboard('{End} ');
    expect(screen.getByRole('tab', { name: 'Shortcuts' })).toHaveAttribute('aria-selected', 'true');
    expect(within(tablist).getAllByRole('tab').filter(tab => tab.tabIndex === 0)).toHaveLength(1);
  });

  it('leaves a manually focused inactive tab for the current panel and reenters at the selected tab', async () => {
    const user = userEvent.setup();
    render(<SettingsPanel {...defaultProps} />);
    await user.click(screen.getByRole('tab', { name: 'General' }));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Appearance' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('tabpanel', { name: 'General' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('tab', { name: 'General' })).toHaveFocus();
  });

  it('moves focus in the physical arrow direction for a right-to-left tablist without automatic activation', async () => {
    const user = userEvent.setup();
    render(<SettingsPanel {...defaultProps} />);
    screen.getByRole('tablist').style.direction = 'rtl';
    await user.click(screen.getByRole('tab', { name: 'General' }));
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Appearance' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'General' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Shortcuts' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'General' })).toHaveFocus();
    await user.keyboard('{End}{Enter}');
    expect(screen.getByRole('tab', { name: 'Shortcuts' })).toHaveAttribute('aria-selected', 'true');
  });

  it('exposes associated general controls and named notification switches without changing other preferences', async () => {
    const user = userEvent.setup();
    const onUpdateSettings = vi.fn();
    render(<SettingsPanel {...defaultProps} onUpdateSettings={onUpdateSettings} settings={{ ...DEFAULT_SETTINGS, notificationPrefs: { mention: true, reply: false } }} />);
    for (const name of ['Display Name', 'Default Editor Mode', 'Default Task View', 'Interface Language']) expect(screen.getByLabelText(name)).toBeInTheDocument();
    for (const name of ['Mentions', 'Replies', 'Reactions', 'Invites', 'Bot alerts']) expect(screen.getByRole('switch', { name })).toBeInTheDocument();
    const mentions = screen.getByRole('switch', { name: 'Mentions' });
    expect(mentions).toHaveAttribute('aria-checked', 'true');
    expect(mentions).toHaveAccessibleDescription('When someone @mentions you');
    expect(screen.getByRole('switch', { name: 'Replies' })).toHaveAttribute('aria-checked', 'false');
    await user.click(mentions);
    expect(onUpdateSettings).toHaveBeenCalledExactlyOnceWith({ notificationPrefs: { mention: false, reply: false } });
  });

  it('names AI fields and expandable prompt/slash-command editors without relying on placeholders', async () => {
    const user = userEvent.setup();
    render(<SettingsPanel {...defaultProps} initialTab="ai" />);
    for (const name of ['Anthropic API Key', 'OpenAI API Key', 'Google Gemini API Key', 'Mistral API Key', 'Default Model']) expect(screen.getByLabelText(name)).toBeInTheDocument();
    expect(screen.getByLabelText('Endpoint URL')).toBeInTheDocument();
    expect(screen.getByLabelText('API Key (optional)')).toBeInTheDocument();
    expect(screen.getByLabelText('Model')).toBeInTheDocument();
    const prompt = screen.getByRole('button', { name: /System Prompt/ });
    expect(prompt).toHaveAttribute('aria-expanded', 'false');
    await user.click(prompt);
    expect(prompt).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('textbox', { name: 'CaddyAI System Prompt' })).toHaveAttribute('id', prompt.getAttribute('aria-controls'));
    await user.click(screen.getByRole('button', { name: 'Add' }));
    for (const name of ['Command name', 'Description', 'Prompt template']) expect(screen.getByRole('textbox', { name })).toBeInTheDocument();
  });

  it('honors recovery navigation on an already mounted controlled panel', () => {
    const onTabChange = vi.fn();
    const view = render(<SettingsPanel {...defaultProps} activeTab="ai" onTabChange={onTabChange} />);
    expect(screen.getByRole('tab', { name: 'AI' })).toHaveAttribute('aria-selected', 'true');
    clickTab('Data');
    expect(onTabChange).toHaveBeenCalledExactlyOnceWith('data');
    view.rerender(<SettingsPanel {...defaultProps} activeTab="general" onTabChange={onTabChange} />);
    expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Sync history recovery')).toBeInTheDocument();
  });

  it('renders Settings heading', () => {
    render(<SettingsPanel {...defaultProps} />);
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('renders Display Preferences section on General tab', () => {
    render(<SettingsPanel {...defaultProps} />);
    expect(screen.getByText('Display Preferences')).toBeInTheDocument();
  });

  it('shows an Offline use status row on the General tab only', () => {
    render(<SettingsPanel {...defaultProps} />);
    const general = screen.getByRole('tabpanel', { name: 'General' });
    expect(within(general).getByRole('heading', { name: 'Offline use' })).toBeInTheDocument();
    // jsdom has no service worker support, so the row reports that plainly.
    expect(within(general).getByTestId('offline-status')).toHaveTextContent("This browser can't keep ThreatCaddy available offline, but it still works online.");
    clickTab('Data');
    expect(screen.queryByRole('heading', { name: 'Offline use' })).not.toBeInTheDocument();
  });

  it('shows the running version under About, from package.json at build time', () => {
    render(<SettingsPanel {...defaultProps} />);
    const general = screen.getByRole('tabpanel', { name: 'General' });
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(within(general).getByText(`Version ${packageJson.version}`)).toBeInTheDocument();
  });

  it('says in About which features send data out of this browser', () => {
    render(<SettingsPanel {...defaultProps} />);
    expect(screen.getByText('Local-first. Your data stays in this browser unless you connect a team server or use AI, integrations '
      + 'or cloud backup. Settings → AI shows where AI requests go.')).toBeInTheDocument();
    expect(screen.queryByText(/self-hosted server/)).not.toBeInTheDocument();
  });

  it('describes the routing modes as resolveRoute applies them, including local models', () => {
    render(<SettingsPanel {...defaultProps} initialTab="ai" />);
    expect(screen.getByRole('option', { name: 'Auto (server while signed in)' })).toBeInTheDocument();
    expect(screen.getByText('Extension: through the browser extension, with API keys saved on this device. Server: through the team '
      + 'server you are signed in to, with its API keys. Auto: the team server while you are signed in, otherwise the extension. '
      + 'A local model with an endpoint is always called directly.')).toBeInTheDocument();
  });

  it('describes both samples above their buttons and shows no stale version number', () => {
    render(<SettingsPanel {...defaultProps} onLoadSample={vi.fn()} onLoadParody={vi.fn()} />);
    const description = screen.getByText(/fictional training investigation/);
    expect(description).toHaveTextContent('realistic mailbox-compromise exercise');
    expect(description).toHaveTextContent('FERMENTED PERSISTENCE parody');
    expect(description).not.toHaveTextContent('VirusTotal');
    expect(screen.getByText(/Threat Investigation Workspace/)).not.toHaveTextContent(/v\d+\.\d+/);
  });

  it('renders Anthropic API Key input on AI tab', () => {
    render(<SettingsPanel {...defaultProps} />);
    clickTab('AI');
    expect(screen.getByText('Anthropic API Key')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('sk-ant-...')).toBeInTheDocument();
  });

  it('renders OpenAI API Key input on AI tab', () => {
    render(<SettingsPanel {...defaultProps} />);
    clickTab('AI');
    expect(screen.getByText('OpenAI API Key')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('sk-...')).toBeInTheDocument();
  });

  it('renders Google Gemini API Key input on AI tab', () => {
    render(<SettingsPanel {...defaultProps} />);
    clickTab('AI');
    expect(screen.getByText('Google Gemini API Key')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('AIza...')).toBeInTheDocument();
  });

  it('renders Mistral API Key input on AI tab', () => {
    render(<SettingsPanel {...defaultProps} />);
    clickTab('AI');
    expect(screen.getByText('Mistral API Key')).toBeInTheDocument();
  });

  it('fires onChange for Anthropic API key', () => {
    const onUpdateSettings = vi.fn();
    render(<SettingsPanel {...defaultProps} onUpdateSettings={onUpdateSettings} />);
    clickTab('AI');
    const input = screen.getByPlaceholderText('sk-ant-...');
    fireEvent.change(input, { target: { value: 'sk-ant-test123' } });
    expect(onUpdateSettings).toHaveBeenCalledWith({ llmAnthropicApiKey: 'sk-ant-test123' });
  });

  it('fires onChange for OpenAI API key', () => {
    const onUpdateSettings = vi.fn();
    render(<SettingsPanel {...defaultProps} onUpdateSettings={onUpdateSettings} />);
    clickTab('AI');
    const input = screen.getByPlaceholderText('sk-...');
    fireEvent.change(input, { target: { value: 'sk-openai-test' } });
    expect(onUpdateSettings).toHaveBeenCalledWith({ llmOpenAIApiKey: 'sk-openai-test' });
  });

  it('renders Local LLM section on AI tab', () => {
    render(<SettingsPanel {...defaultProps} />);
    clickTab('AI');
    expect(screen.getByText('Local LLM (Ollama / LM Studio / vLLM)')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('http://localhost:11434/v1')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('llama3.1, qwen2.5, mistral-nemo, etc.')).toBeInTheDocument();
  });

  it('renders Default Model selector on AI tab', () => {
    render(<SettingsPanel {...defaultProps} />);
    clickTab('AI');
    expect(screen.getByText('Default Model')).toBeInTheDocument();
  });

  it('shows "API key saved" when Anthropic key is set', () => {
    const settings = { ...DEFAULT_SETTINGS, llmAnthropicApiKey: 'sk-test' } as Settings;
    render(<SettingsPanel {...defaultProps} settings={settings} />);
    clickTab('AI');
    expect(screen.getByText('API key saved')).toBeInTheDocument();
  });

  it('shows "API key saved" when Gemini key is set', () => {
    const settings = { ...DEFAULT_SETTINGS, llmGeminiApiKey: 'AIza-test' } as Settings;
    render(<SettingsPanel {...defaultProps} settings={settings} />);
    clickTab('AI');
    expect(screen.getByText('API key saved')).toBeInTheDocument();
  });

  it('hides "API key saved" when no keys are set on AI tab', () => {
    render(<SettingsPanel {...defaultProps} />);
    clickTab('AI');
    expect(screen.queryByText('API key saved')).not.toBeInTheDocument();
  });

  it('renders Data tab components', () => {
    render(<SettingsPanel {...defaultProps} />);
    clickTab('Data');
    expect(screen.getByTestId('export-import')).toBeInTheDocument();
    expect(screen.getByTestId('encryption-settings')).toBeInTheDocument();
    expect(screen.getByTestId('cloud-backup')).toBeInTheDocument();
  });

  it('renders Threat Intel tab components', () => {
    render(<SettingsPanel {...defaultProps} />);
    clickTab('Intel');
    expect(screen.getByTestId('threat-intel-config')).toBeInTheDocument();
  });

  it('renders Integrations tab components', () => {
    render(<SettingsPanel {...defaultProps} />);
    clickTab('Integrations');
    expect(screen.getByTestId('integration-panel')).toBeInTheDocument();
  });

  it('renders Shortcuts tab components', () => {
    render(<SettingsPanel {...defaultProps} />);
    clickTab('Shortcuts');
    expect(screen.getByTestId('keyboard-shortcuts')).toBeInTheDocument();
  });
});

describe('SettingsPanel: where AI data goes', () => {
  const renderAI = (settings: Partial<Settings> = {}, onUpdateSettings = vi.fn()) =>
    render(<SettingsPanel {...defaultProps} initialTab="ai" onUpdateSettings={onUpdateSettings} settings={{ ...DEFAULT_SETTINGS, ...settings } as Settings} />);
  const signIn = () => localStorage.setItem(workspaceStorageKey('threatcaddy-auth'), JSON.stringify({
    serverUrl: 'https://team.example', accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh',
    user: { id: 'user-1', email: 'analyst@example.test', displayName: 'Analyst' },
  }));
  const GUARDED_CAPS = 'llm_streaming,fetch_url,clip_import,clip_import_ack_v2,proxy_fetch';
  const STORE_1_1_1_CAPS = 'llm_streaming,fetch_url,clip_import,proxy_fetch';
  /** As in a browser, a posted message reaches the window's listeners on a later task. */
  const deliver = (data: unknown) => setTimeout(() => window.dispatchEvent(new MessageEvent('message', { source: window, data })), 0);
  let bridges: ((event: MessageEvent) => void) | undefined;
  /** Extension bridges that answer TC_EXTENSION_PING from their listener; only a bridge that owns the page's listeners answers. */
  const answerPing = (...replies: string[]) => {
    bridges = event => {
      if (event.source !== window || event.data?.type !== 'TC_EXTENSION_PING') return;
      for (const caps of replies) deliver({ type: 'TC_EXTENSION_READY', protocolVersion: 1, capabilities: caps.split(',') });
    };
    window.addEventListener('message', bridges);
    return vi.spyOn(window, 'postMessage').mockImplementation((message: unknown) => { deliver(message); });
  };
  const section = () => screen.getByRole('region', { name: 'Where AI data goes' });
  const lines = () => Array.from(section().querySelectorAll('p'), line => line.textContent);
  afterEach(() => {
    localStorage.clear(); delete document.documentElement.dataset.tcBridgeCaps; vi.restoreAllMocks();
    if (bridges) window.removeEventListener('message', bridges);
    bridges = undefined;
  });

  it('D-ROUTE-4: shows Auto when no routing mode was chosen', () => {
    renderAI();
    expect(screen.getByLabelText('LLM request routing')).toHaveValue('auto');
  });

  it('names the team server and its operator when Auto routes through a signed-in server', () => {
    signIn();
    renderAI({ serverUrl: 'https://team.example' });
    const section = screen.getByRole('region', { name: 'Where AI data goes' });
    expect(within(section).getByText(/team server at team\.example\. Its operator can read your prompts/)).toBeInTheDocument();
  });

  it('names the signed-in session’s server in a new workspace whose settings have no server URL', () => {
    signIn();
    renderAI();
    const section = screen.getByRole('region', { name: 'Where AI data goes' });
    expect(within(section).getByText(/team server at team\.example\. Its operator can read your prompts/)).toBeInTheDocument();
  });

  it('describes local, extension and unavailable routes truthfully', () => {
    const view = renderAI({ llmDefaultProvider: 'local', llmLocalEndpoint: 'http://localhost:11434/v1' });
    expect(screen.getByText('Requests to your local model go straight to it at localhost:11434.')).toBeInTheDocument();
    view.unmount();
    document.documentElement.dataset.tcBridgeCaps = GUARDED_CAPS;
    const extension = renderAI({ serverUrl: 'https://team.example' });
    expect(screen.getByText(/from the browser extension straight to your AI provider/)).toBeInTheDocument();
    extension.unmount();
    delete document.documentElement.dataset.tcBridgeCaps;
    signIn();
    renderAI({ serverUrl: 'https://team.example', llmRoutingMode: 'extension' });
    expect(screen.getByText(/set to Browser Extension, but the extension is not available/)).toBeInTheDocument();
  });

  // IR3: the line used to describe only the default provider, so it said prompts stay local while a
  // Claude thread went through the team server.
  it('names the team server for cloud models when the default model is local', () => {
    signIn();
    renderAI({ llmDefaultProvider: 'local', llmLocalEndpoint: 'http://localhost:11434/v1', llmAnthropicApiKey: 'sk-ant-synthetic', llmRoutingMode: 'auto' });
    expect(lines().slice(0, 2)).toEqual([
      'Requests to your local model go straight to it at localhost:11434.',
      'Requests to cloud models go through the team server at team.example. Its operator can read your prompts, the investigation content the AI reads and tool results.',
    ]);
  });

  it('describes the local model and the cloud route whichever model is the default', () => {
    const local = { llmLocalEndpoint: 'http://localhost:11434/v1' };
    const routeLines = (settings: Partial<Settings>) => { const view = renderAI({ ...local, ...settings }); const found = lines().slice(0, 2); view.unmount(); return found; };
    const localLine = 'Requests to your local model go straight to it at localhost:11434.';
    expect(routeLines({ llmDefaultProvider: 'anthropic' })).toEqual([localLine,
      'Cloud models have no route. Install the browser extension or sign in to a team server to use them.']);
    expect(routeLines({ llmDefaultProvider: 'local', llmRoutingMode: 'server' })).toEqual([localLine,
      'Routing is set to Team Server Proxy, but you are not signed in to a team server, so requests to cloud models will fail.']);
    expect(routeLines({ llmDefaultProvider: 'local', llmRoutingMode: 'extension' })).toEqual([localLine,
      'Routing is set to Browser Extension, but the extension is not available, so requests to cloud models will fail.']);
    document.documentElement.dataset.tcBridgeCaps = GUARDED_CAPS;
    expect(routeLines({ llmDefaultProvider: 'local' })).toEqual([localLine,
      'Requests to cloud models go from the browser extension straight to the provider, using the API key saved on this device.']);
  });

  it('keeps one route line when no local model endpoint is set, even with a local default model', () => {
    signIn();
    renderAI({ llmDefaultProvider: 'local', llmLocalEndpoint: '  ' });
    expect(screen.queryByText(/local model go/)).not.toBeInTheDocument();
    expect(lines()[0]).toBe('Model requests go through the team server at team.example. Its operator can read your prompts, the investigation content the AI reads and tool results.');
    expect(lines()[1]).toBe('Web fetch needs the ThreatCaddy browser extension.');
  });

  const FETCH_UPDATE = 'Web fetch: unavailable. It needs the ThreatCaddy extension 1.1.3 or later, approved for this app. '
    + "If your browser's extension store offers no update, install the latest version from the ThreatCaddy releases on GitHub. "
    + 'Keep only the newest ThreatCaddy extension installed, then reload the page.';
  const FETCH_AVAILABLE = 'Web fetch: available. The extension opens only public web addresses.';

  it.each([
    [undefined, [], 'Web fetch needs the ThreatCaddy browser extension.'],
    [STORE_1_1_1_CAPS, [STORE_1_1_1_CAPS], FETCH_UPDATE],
    [GUARDED_CAPS, [GUARDED_CAPS], FETCH_AVAILABLE],
  ])('reports web fetch status for bridge capabilities %s', async (caps, replies, text) => {
    if (caps) document.documentElement.dataset.tcBridgeCaps = caps;
    answerPing(...replies);
    renderAI();
    expect(await within(section()).findByText(text)).toBeInTheDocument();
  });

  it.each([
    ['store 1.1.1 answers although the page shows guarded capabilities', [STORE_1_1_1_CAPS]],
    ['no bridge answers, as after the only extension updates without a page reload', []],
    ['one of two answering bridges is old', [GUARDED_CAPS, STORE_1_1_1_CAPS]],
  ])('asks the bridge, as web fetch does, and shows the update line when %s', async (_case, replies) => {
    document.documentElement.dataset.tcBridgeCaps = GUARDED_CAPS;
    const post = answerPing(...replies);
    renderAI();
    expect(await within(section()).findByText(FETCH_UPDATE, {}, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.queryByText(FETCH_AVAILABLE)).not.toBeInTheDocument();
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'TC_EXTENSION_PING' }), expect.anything());
  });

  it('updates the route and web fetch lines when the extension publishes or withdraws its capabilities', async () => {
    answerPing(GUARDED_CAPS);
    renderAI();
    expect(screen.getByText('Web fetch needs the ThreatCaddy browser extension.')).toBeInTheDocument();
    document.documentElement.dataset.tcBridgeCaps = GUARDED_CAPS;
    expect(await screen.findByText(FETCH_AVAILABLE)).toBeInTheDocument();
    expect(screen.getByText(/from the browser extension straight to your AI provider/)).toBeInTheDocument();
    delete document.documentElement.dataset.tcBridgeCaps;
    expect(await screen.findByText('Web fetch needs the ThreatCaddy browser extension.')).toBeInTheDocument();
  });

  // The bridge withdraws its capabilities while it rechecks app approval and then publishes the same ones again.
  // The earlier answer belongs to the check that ran before, so it must not show while the new check runs.
  it('never shows a check result after the capabilities it was checked for are withdrawn', async () => {
    document.documentElement.dataset.tcBridgeCaps = GUARDED_CAPS;
    answerPing(GUARDED_CAPS);
    renderAI();
    expect(await within(section()).findByText(FETCH_AVAILABLE)).toBeInTheDocument();
    delete document.documentElement.dataset.tcBridgeCaps;
    expect(await within(section()).findByText('Web fetch needs the ThreatCaddy browser extension.')).toBeInTheDocument();
    // The bridge that answers now is store 1.1.1, and the new check's ping has not reached it yet.
    if (bridges) window.removeEventListener('message', bridges);
    const post = answerPing(STORE_1_1_1_CAPS);
    const held: unknown[] = [];
    post.mockImplementation((message: unknown) => { if ((message as { type?: string })?.type === 'TC_EXTENSION_PING') held.push(message); else deliver(message); });
    document.documentElement.dataset.tcBridgeCaps = GUARDED_CAPS;
    await waitFor(() => expect(held).toHaveLength(1));
    expect(within(section()).queryByText('Web fetch needs the ThreatCaddy browser extension.')).not.toBeInTheDocument();
    expect(within(section()).queryByText(FETCH_AVAILABLE)).not.toBeInTheDocument();
    held.forEach(deliver);
    expect(await within(section()).findByText(FETCH_UPDATE)).toBeInTheDocument();
  });

  // A check still waiting for its ping when the capabilities go and come back answers for the bridge that
  // published them first; that late answer must not show while the new check runs.
  it('drops the answer of a check that was still running when its capabilities were withdrawn', async () => {
    const post = answerPing(GUARDED_CAPS);
    const held: { requestId: string }[] = [];
    post.mockImplementation((message: unknown) => {
      if ((message as { type?: string })?.type === 'TC_EXTENSION_PING') held.push(message as { requestId: string });
      else deliver(message);
    });
    document.documentElement.dataset.tcBridgeCaps = GUARDED_CAPS;
    renderAI();
    await waitFor(() => expect(held).toHaveLength(1));
    delete document.documentElement.dataset.tcBridgeCaps;
    expect(await within(section()).findByText('Web fetch needs the ThreatCaddy browser extension.')).toBeInTheDocument();
    document.documentElement.dataset.tcBridgeCaps = GUARDED_CAPS;
    await waitFor(() => expect(held).toHaveLength(2));
    // The first check's ping reaches the guarded bridge, and that check finishes.
    deliver(held[0]);
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'TC_EXTENSION_PING_END', requestId: held[0].requestId }), expect.anything()));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    expect(within(section()).queryByText(FETCH_AVAILABLE)).not.toBeInTheDocument();
    expect(within(section()).queryByText(FETCH_UPDATE)).not.toBeInTheDocument();
    // The bridge that answers the second check's ping is store 1.1.1, so only the update line is true.
    if (bridges) window.removeEventListener('message', bridges);
    bridges = event => {
      if (event.source !== window || event.data?.type !== 'TC_EXTENSION_PING') return;
      deliver({ type: 'TC_EXTENSION_READY', protocolVersion: 1, capabilities: STORE_1_1_1_CAPS.split(',') });
    };
    window.addEventListener('message', bridges);
    deliver(held[1]);
    expect(await within(section()).findByText(FETCH_UPDATE)).toBeInTheDocument();
    expect(within(section()).queryByText(FETCH_AVAILABLE)).not.toBeInTheDocument();
  });

  it('says where keys and prompts go instead of claiming every call uses the extension', () => {
    renderAI();
    expect(screen.getByText(/its operator receives your prompts, attachments and tool results/)).toBeInTheDocument();
    expect(screen.queryByText(/proxied through the browser extension/)).not.toBeInTheDocument();
  });

  it('D-HOSTS-1: lists a legacy agent host read-only, and Remove clears it', async () => {
    const onUpdateSettings = vi.fn();
    const keep = { id: 'keep', name: 'soc2', displayName: 'SOC Two', url: 'https://soc2.example', enabled: true, skills: [] };
    renderAI({ agentHosts: [{ id: 'legacy', name: 'soc1', displayName: 'SOC One', url: 'http://192.168.1.50:8080', enabled: true, skills: [] }, keep] }, onUpdateSettings);
    expect(screen.getByText('Configured agent hosts')).toBeInTheDocument();
    expect(screen.getByText('http://192.168.1.50:8080')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /host/i })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Remove agent host SOC One' }));
    expect(onUpdateSettings).toHaveBeenCalledExactlyOnceWith({ agentHosts: [keep] });
  });

  it('marks hosts on plain http away from this computer as unused, since every call to them is refused', () => {
    const host = (id: string, url: string) => ({ id, name: id, displayName: `Host ${id}`, url, enabled: true, skills: [] });
    renderAI({ agentHosts: [host('lab', 'http://10.0.0.5:8080'), host('soc', 'https://soc.example'), host('loop', 'http://localhost:8080')] });
    const row = (url: string) => screen.getByText(url).closest('li') as HTMLElement;
    expect(within(row('http://10.0.0.5:8080')).getByText('Not used: needs https')).toBeInTheDocument();
    expect(within(row('https://soc.example')).queryByText('Not used: needs https')).not.toBeInTheDocument();
    expect(within(row('http://localhost:8080')).queryByText('Not used: needs https')).not.toBeInTheDocument();
  });

  // On a phone a long display name used to push the address out of the same truncated line.
  it('shows each agent host name and address on lines of their own, the address left to right', () => {
    const url = 'http://soc.example.invalid/api/v1/agents';
    const name = 'Fictional SOC host with a rather long display name';
    renderAI({ agentHosts: [{ id: 'soc', name: 'soc', displayName: name, url, enabled: true, skills: [] }] });
    const nameLine = screen.getByText(name);
    const urlLine = screen.getByText(url);
    expect(nameLine).not.toContainElement(urlLine);
    for (const line of [nameLine, urlLine]) expect(line).toHaveClass('block', 'truncate');
    expect(urlLine).toHaveAttribute('dir', 'ltr');
    expect(within(urlLine.closest('li') as HTMLElement).getByText('Not used: needs https')).toBeInTheDocument();
  });

  // In Arabic a long Latin name used to be cut at its start, the part that identifies the host.
  it('lets each agent host name take its own direction, at the start of the row in either page direction', () => {
    const name = 'Fictional analysis host with an unusually long display name';
    renderAI({ agentHosts: [{ id: 'soc', name: 'soc', displayName: name, url: 'https://soc.example', enabled: true, skills: [] }] });
    const nameLine = screen.getByText(name);
    expect(nameLine).toHaveAttribute('dir', 'auto');
    // Aligned by the page's direction only (e2e/name-direction.spec.ts checks the layout in a browser).
    expect(nameLine).toHaveClass('block', 'truncate', 'text-left', '[[dir=rtl]_&]:text-right');
    expect(nameLine).not.toHaveClass('rtl:text-right');
  });

  it('hides the agent host list when none are configured', () => {
    renderAI();
    expect(screen.queryByText('Configured agent hosts')).not.toBeInTheDocument();
  });

  it('offers the agent bridge as a switch that is off by default and saves each change', async () => {
    const user = userEvent.setup();
    const onUpdateSettings = vi.fn();
    const view = renderAI({}, onUpdateSettings);
    const section = screen.getByRole('region', { name: 'Where AI data goes' });
    const off = within(section).getByRole('switch', { name: 'Agent bridge' });
    expect(off).toHaveAttribute('aria-checked', 'false');
    expect(off).toHaveAccessibleDescription(/scripts on this page, including browser automation such as Claude Code over CDP, .*window\.threatcaddy; web fetch, the contents of other investigations and agent changes are never available through it\./);
    await user.click(off);
    expect(onUpdateSettings).toHaveBeenCalledExactlyOnceWith({ agentBridgeEnabled: true });
    view.unmount();
    onUpdateSettings.mockClear();
    renderAI({ agentBridgeEnabled: true }, onUpdateSettings);
    const on = screen.getByRole('switch', { name: 'Agent bridge' });
    expect(on).toHaveAttribute('aria-checked', 'true');
    await user.click(on);
    expect(onUpdateSettings).toHaveBeenCalledExactlyOnceWith({ agentBridgeEnabled: false });
  });
});
