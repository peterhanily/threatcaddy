/** The AgentCaddy panel is ready exactly when the agent cycle has a route: a stored sign-in is the server session, a server URL alone is not. */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Folder, type Settings } from '../types';
import { AgentPanel } from '../components/Agent/AgentPanel';
import { workspaceStorageKey } from '../lib/workspace-profiles';

vi.mock('../components/Agent/AgentProfilePicker', () => ({ AgentProfilePicker: () => null }));
vi.mock('../components/Agent/AgentMeetingPanel', () => ({ AgentMeetingPanel: () => null }));

const folder: Folder = { id: 'case', name: 'Case', order: 0, createdAt: 1 };
const signIn = () => localStorage.setItem(workspaceStorageKey('threatcaddy-auth'), JSON.stringify({
  serverUrl: 'https://team.example', accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh',
  user: { id: 'user-1', email: 'analyst@example.test', displayName: 'Analyst' },
}));
const renderPanel = async (settings: Partial<Settings>) => {
  render(<AgentPanel folder={folder} settings={{ ...DEFAULT_SETTINGS, ...settings }} />);
  await act(async () => {});
};
const setupBanner = () => screen.queryByRole('heading', { name: 'Set up AgentCaddy' });

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
});
