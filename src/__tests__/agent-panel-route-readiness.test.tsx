/** The AgentCaddy panel is ready exactly when the agent cycle has a route: a stored sign-in is the server session, a server URL alone is not. */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AGENT_POLICY, DEFAULT_SETTINGS, type Folder, type Settings } from '../types';
import { AgentPanel } from '../components/Agent/AgentPanel';
import { workspaceStorageKey } from '../lib/workspace-profiles';
import i18n from '../i18n';
import enSettings from '../../public/locales/en/settings.json';
import deAgent from '../../public/locales/de/agent.json';
import deSettings from '../../public/locales/de/settings.json';

vi.mock('../components/Agent/AgentProfilePicker', () => ({ AgentProfilePicker: () => null }));
vi.mock('../components/Agent/AgentMeetingPanel', () => ({ AgentMeetingPanel: () => null }));

const folder: Folder = { id: 'case', name: 'Case', order: 0, createdAt: 1 };
const signIn = () => localStorage.setItem(workspaceStorageKey('threatcaddy-auth'), JSON.stringify({
  serverUrl: 'https://team.example', accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh',
  user: { id: 'user-1', email: 'analyst@example.test', displayName: 'Analyst' },
}));
const renderPanel = async (settings: Partial<Settings>, investigation = folder) => {
  render(<AgentPanel folder={investigation} settings={{ ...DEFAULT_SETTINGS, ...settings }} />);
  await act(async () => {});
};
const setupBanner = () => screen.queryByRole('heading', { name: 'Set up AgentCaddy' });
const announceExtension = () => act(() => {
  window.dispatchEvent(new MessageEvent('message', { source: window, data: { type: 'TC_EXTENSION_READY', protocolVersion: 2, capabilities: [] } }));
});

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); localStorage.clear(); });

describe('AgentCaddy readiness follows the route', () => {
  it('signed in, in a new workspace whose settings are empty: no setup banner', async () => {
    signIn();
    await renderPanel({});
    expect(setupBanner()).not.toBeInTheDocument();
  });

  it('signed out with a server URL in Settings and no other route: the setup banner shows', async () => {
    await renderPanel({ serverUrl: 'https://team.example' });
    expect(setupBanner()).toBeInTheDocument();
  });

  it('explicit Browser Extension routing while signed in, no extension and no key: the setup banner shows', async () => {
    signIn();
    await renderPanel({ serverUrl: 'https://team.example', llmRoutingMode: 'extension' });
    expect(setupBanner()).toBeInTheDocument();
  });

  it('explicit Team Server routing while signed out, with the extension and a key: the setup banner asks to sign in', async () => {
    await renderPanel({ llmRoutingMode: 'server', llmAnthropicApiKey: 'synthetic-key' });
    announceExtension();
    expect(setupBanner()).toBeInTheDocument();
    expect(screen.getByText(enSettings['ai.dataFlow.errorNoServer'])).toBeInTheDocument();
    expect(screen.queryByText('Install the browser extension')).not.toBeInTheDocument();
    expect(screen.queryByText('Configure an API key')).not.toBeInTheDocument();
  });

  it('explicit Browser Extension routing with no extension, a local endpoint and a cloud default model: the setup banner shows', async () => {
    await renderPanel({ llmRoutingMode: 'extension', llmDefaultProvider: 'anthropic', llmAnthropicApiKey: 'synthetic-key', llmLocalEndpoint: 'http://localhost:11434/v1' });
    expect(setupBanner()).toBeInTheDocument();
    expect(screen.getByText('Install the browser extension')).toBeInTheDocument();
  });

  it('a local default model with an endpoint is called directly, so it needs no extension or server', async () => {
    await renderPanel({ llmRoutingMode: 'extension', llmDefaultProvider: 'local', llmLocalEndpoint: 'http://localhost:11434/v1' });
    expect(setupBanner()).not.toBeInTheDocument();
  });

  it('explicit Team Server routing while signed out and no extension: the setup banner asks only to sign in', async () => {
    await renderPanel({ llmRoutingMode: 'server', llmAnthropicApiKey: 'synthetic-key' });
    expect(setupBanner()).toBeInTheDocument();
    expect(screen.getByText(enSettings['ai.dataFlow.errorNoServer'])).toBeInTheDocument();
    expect(screen.queryByText('Install the browser extension')).not.toBeInTheDocument();
    expect(screen.queryByText('Configure an API key')).not.toBeInTheDocument();
  });
});

describe('AgentCaddy readiness follows the investigation’s agent model, as the cycle does', () => {
  const twoRoutes: Partial<Settings> = { llmRoutingMode: 'auto', llmAnthropicApiKey: 'synthetic-key', llmLocalEndpoint: 'http://localhost:11434/v1', llmLocalModelName: 'llama3' };
  const withModel = (model: string): Folder => ({ ...folder, agentPolicy: { ...DEFAULT_AGENT_POLICY, model } });

  it('the local model, signed out and no extension: the cycle calls it directly, so the panel shows', async () => {
    await renderPanel(twoRoutes, withModel('llama3'));
    expect(setupBanner()).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run agent cycle' })).toBeInTheDocument();
  });

  it('a cloud model with no route while the default local model has one: the panel stays open, so its model selector can be changed', async () => {
    await renderPanel({ ...twoRoutes, llmDefaultProvider: 'local' }, withModel('claude-sonnet-4-6'));
    expect(setupBanner()).not.toBeInTheDocument();
  });

  it('a cloud model with no route and no other route: the setup banner shows', async () => {
    await renderPanel({ llmRoutingMode: 'auto', llmAnthropicApiKey: 'synthetic-key' }, withModel('claude-sonnet-4-6'));
    expect(setupBanner()).toBeInTheDocument();
  });

  it('a run refused for a missing key offers the AI settings in the analyst’s language', async () => {
    for (const [namespace, values] of Object.entries(i18n.getDataByLanguage('en') ?? {})) i18n.addResourceBundle('de', namespace, values, true, false);
    i18n.addResourceBundle('de', 'agent', deAgent, true, true);
    await i18n.changeLanguage('de');
    try {
      signIn();
      const refusal = `${deAgent['refusal.noApiKey'].replace('{{provider}}', 'openai')} ${deAgent['refusal.configuredProviders'].replace('{{providers}}', 'anthropic')}`;
      const onOpenSettings = vi.fn();
      render(<AgentPanel folder={withModel('gpt-5.4')} settings={{ ...DEFAULT_SETTINGS, llmAnthropicApiKey: 'synthetic-key' }} agentError={refusal} onOpenSettings={onOpenSettings} />);
      await act(async () => {});
      fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: deAgent['panel.openAISettingsLink'] }));
      expect(onOpenSettings).toHaveBeenCalledExactlyOnceWith('ai');
    } finally { await act(async () => { await i18n.changeLanguage('en'); }); }
  });

  it('a run refused because the investigation model has no route offers the AI settings in the analyst’s language', async () => {
    for (const [namespace, values] of Object.entries(i18n.getDataByLanguage('en') ?? {})) i18n.addResourceBundle('de', namespace, values, true, false);
    i18n.addResourceBundle('de', 'agent', deAgent, true, true);
    i18n.addResourceBundle('de', 'settings', deSettings, true, true);
    await i18n.changeLanguage('de');
    try {
      const onOpenSettings = vi.fn();
      // The default local model has a route, so the panel is open; the cloud model has none.
      render(<AgentPanel folder={withModel('claude-sonnet-4-6')} settings={{ ...DEFAULT_SETTINGS, ...twoRoutes, llmDefaultProvider: 'local' }}
        agentError={`[Lead Analyst] ${deSettings['ai.dataFlow.errorNone']}`} onOpenSettings={onOpenSettings} />);
      await act(async () => {});
      fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: deAgent['panel.openAISettingsLink'] }));
      expect(onOpenSettings).toHaveBeenCalledExactlyOnceWith('ai');
    } finally { await act(async () => { await i18n.changeLanguage('en'); }); }
  });
});
