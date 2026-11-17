import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execute: vi.fn(), folders: vi.fn(), log: vi.fn(), ready: vi.fn(), enabled: vi.fn(), metadata: vi.fn(), key: vi.fn() }));
vi.mock('../lib/llm-tools', () => ({ executeTool: mocks.execute }));
vi.mock('../lib/llm-tool-defs', () => ({ TOOL_DEFINITIONS: [{ name: 'search_notes' }], isWriteTool: () => false }));
vi.mock('../db', () => ({ db: { folders: { toArray: mocks.folders }, activityLog: { add: mocks.log } } }));
vi.mock('../lib/workspace-initialization', () => ({ isWorkspaceInitialized: mocks.ready }));
vi.mock('../lib/encryptionStore', () => ({ isEncryptionEnabled: mocks.enabled, getEncryptionMeta: mocks.metadata }));
vi.mock('../lib/encryptionMiddleware', () => ({ ENCRYPTION_COVERAGE_VERSION: 2, getSessionKey: mocks.key }));

import { installAgentBridge, syncBridgeFolderId } from '../lib/agent-bridge';
import { workspaceStorageKey } from '../lib/workspace-profiles';

type Bridge = {
  exec(nonce: string, name: string, input: Record<string, unknown>): Promise<string>;
  investigations(nonce: string): Promise<string>;
  folderId(): string | undefined;
  setFolderId(nonce: string, id: string): void;
  version: string;
};
const enableBridge = (enabled = true) => localStorage.setItem(workspaceStorageKey('threatcaddy-settings'), JSON.stringify({ agentBridgeEnabled: enabled }));
const bridge = () => (window as unknown as { threatcaddy: Bridge }).threatcaddy;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.ready.mockReturnValue(true);
  mocks.enabled.mockReturnValue(true);
  mocks.metadata.mockReturnValue({ coverageVersion: 2 });
  mocks.key.mockReturnValue({});
  mocks.execute.mockResolvedValue({ result: '[]', isError: false });
  mocks.folders.mockResolvedValue([]);
  enableBridge();
  syncBridgeFolderId('case');
});

describe('agent bridge workspace readiness', () => {
  it.each(['startup', 'locked', 'conversion', 'old-coverage'])('defers all persisted-content entrypoints during %s', async state => {
    if (state === 'startup') mocks.ready.mockReturnValue(false);
    if (state === 'locked') mocks.key.mockReturnValue(null);
    if (state === 'conversion') mocks.metadata.mockReturnValue({ coverageVersion: 2, transition: 'encrypting' });
    if (state === 'old-coverage') mocks.metadata.mockReturnValue({ coverageVersion: 1 });
    const nonce = installAgentBridge();
    await expect(bridge().exec(nonce, 'search_notes', {})).rejects.toThrow('Unlock the workspace');
    await expect(bridge().investigations(nonce)).rejects.toThrow('Unlock the workspace');
    expect(() => bridge().folderId()).toThrow('Unlock the workspace');
    expect(() => bridge().setFolderId(nonce, 'case')).toThrow('follows the investigation selected');
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.folders).not.toHaveBeenCalled();
  });

  it('permits normal reads only after unlocked initialization succeeds', async () => {
    const nonce = installAgentBridge();
    await expect(bridge().exec(nonce, 'search_notes', {})).resolves.toBe('[]');
    await expect(bridge().investigations(nonce)).resolves.toBe('[]');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.folders).toHaveBeenCalledTimes(1);
  });
});

describe('A-BRIDGE-1 the bridge is off by default and scoped to the selected investigation', () => {
  it('refuses every tool until the bridge is turned on', async () => {
    const nonce = installAgentBridge();
    localStorage.removeItem(workspaceStorageKey('threatcaddy-settings'));
    await expect(bridge().exec(nonce, 'search_notes', {})).rejects.toThrow('Turn on the agent bridge');
    enableBridge(false);
    await expect(bridge().exec(nonce, 'search_notes', {})).rejects.toThrow('Turn on the agent bridge');
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('refuses when no investigation is selected', async () => {
    const nonce = installAgentBridge();
    syncBridgeFolderId(undefined);
    await expect(bridge().exec(nonce, 'search_notes', {})).rejects.toThrow('Select an investigation');
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('dispatches on the bridge surface in the selected investigation', async () => {
    const nonce = installAgentBridge();
    await bridge().exec(nonce, 'search_notes', { query: 'x' });
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'search_notes' }), 'case', undefined,
      expect.objectContaining({ surface: 'bridge', allowedTools: new Set(['search_notes']) }));
    expect(bridge().version).toBe('1.2.0');
  });

  it('requires the nonce to list investigations and never re-scopes', async () => {
    installAgentBridge();
    await expect(bridge().investigations('wrong')).rejects.toThrow('Invalid agent bridge nonce');
    expect(mocks.folders).not.toHaveBeenCalled();
    expect(() => bridge().setFolderId(installAgentBridge(), 'other')).toThrow('follows the investigation selected');
    expect(bridge().folderId()).toBe('case');
  });
});
