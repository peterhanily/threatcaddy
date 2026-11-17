/** Design D10: the Settings → AI switch, saved through the normal settings path, is what turns window.threatcaddy on and off. */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { SettingsPanel } from '../components/Settings/SettingsPanel';
import { useSettings } from '../hooks/useSettings';
import { installAgentBridge, syncBridgeFolderId } from '../lib/agent-bridge';
import { workspaceStorageKey } from '../lib/workspace-profiles';
import { seedAIWorkspace } from './helpers/ai-workspace';

vi.mock('../lib/workspace-initialization', () => ({ isWorkspaceInitialized: () => true }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn(), toasts: [], removeToast: vi.fn() }) }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ connected: false, user: null, serverUrl: null }) }));
vi.mock('../components/Settings/ExportImport', () => ({ ExportImport: () => null }));
vi.mock('../components/Settings/ThreatIntelConfig', () => ({ ThreatIntelConfig: () => null }));
vi.mock('../components/Settings/CloudBackup', () => ({ CloudBackup: () => null }));
vi.mock('../components/Settings/KeyboardShortcuts', () => ({ KeyboardShortcuts: () => null }));
vi.mock('../components/Encryption/EncryptionSettings', () => ({ EncryptionSettings: () => null }));
vi.mock('../components/Integrations/IntegrationPanel', () => ({ IntegrationPanel: () => null }));
vi.mock('../components/Settings/ServerBackup', () => ({ ServerBackup: () => null }));

type Bridge = { exec(nonce: string, name: string, input: Record<string, unknown>): Promise<string> };
const bridge = () => (window as unknown as { threatcaddy: Bridge }).threatcaddy;
const savedSettings = () => JSON.parse(localStorage.getItem(workspaceStorageKey('threatcaddy-settings')) ?? '{}');

function SettingsWithSavedState() {
  const { settings, updateSettings } = useSettings();
  return <SettingsPanel settings={settings} onUpdateSettings={updateSettings} notes={[]} onImportComplete={() => {}} initialTab="ai" />;
}

let nonce: string;
beforeEach(async () => {
  localStorage.clear();
  await seedAIWorkspace();
  nonce = installAgentBridge();
  syncBridgeFolderId('S');
});
afterEach(() => localStorage.clear());

describe('agent bridge switch in Settings → AI', () => {
  it('is off by default, and the bridge refuses while off and works while on', async () => {
    const user = userEvent.setup();
    render(<SettingsWithSavedState />);
    const toggle = screen.getByRole('switch', { name: 'Agent bridge' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(bridge().exec(nonce, 'create_note', { title: 'Refused', content: 'x' })).rejects.toThrow('Turn on the agent bridge');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(savedSettings().agentBridgeEnabled).toBe(true);
    const created = JSON.parse(await bridge().exec(nonce, 'create_note', { title: 'Bridge note', content: 'From the bridge' }));
    expect((await db.notes.get(created.id))?.folderId).toBe('S');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(savedSettings().agentBridgeEnabled).toBe(false);
    await expect(bridge().exec(nonce, 'create_note', { title: 'Refused again', content: 'x' })).rejects.toThrow('Turn on the agent bridge');
  });
});
