import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execute: vi.fn(), folders: vi.fn(), log: vi.fn(), ready: vi.fn(), enabled: vi.fn(), metadata: vi.fn(), key: vi.fn() }));
vi.mock('../lib/llm-tools', () => ({ executeTool: mocks.execute }));
vi.mock('../lib/llm-tool-defs', () => ({ TOOL_DEFINITIONS: [{ name: 'search_notes' }], isWriteTool: () => false }));
vi.mock('../db', () => ({ db: { folders: { toArray: mocks.folders }, activityLog: { add: mocks.log } } }));
vi.mock('../lib/workspace-initialization', () => ({ isWorkspaceInitialized: mocks.ready }));
vi.mock('../lib/encryptionStore', () => ({ isEncryptionEnabled: mocks.enabled, getEncryptionMeta: mocks.metadata }));
vi.mock('../lib/encryptionMiddleware', () => ({ ENCRYPTION_COVERAGE_VERSION: 2, getSessionKey: mocks.key }));

import { installAgentBridge } from '../lib/agent-bridge';

type Bridge = {
  exec(nonce: string, name: string, input: Record<string, unknown>): Promise<string>;
  investigations(): Promise<string>;
  folderId(): string | undefined;
  setFolderId(nonce: string, id: string): void;
};
const bridge = () => (window as unknown as { threatcaddy: Bridge }).threatcaddy;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.ready.mockReturnValue(true);
  mocks.enabled.mockReturnValue(true);
  mocks.metadata.mockReturnValue({ coverageVersion: 2 });
  mocks.key.mockReturnValue({});
  mocks.execute.mockResolvedValue({ result: '[]', isError: false });
  mocks.folders.mockResolvedValue([]);
});

describe('agent bridge workspace readiness', () => {
  it.each(['startup', 'locked', 'conversion', 'old-coverage'])('defers all persisted-content entrypoints during %s', async state => {
    if (state === 'startup') mocks.ready.mockReturnValue(false);
    if (state === 'locked') mocks.key.mockReturnValue(null);
    if (state === 'conversion') mocks.metadata.mockReturnValue({ coverageVersion: 2, transition: 'encrypting' });
    if (state === 'old-coverage') mocks.metadata.mockReturnValue({ coverageVersion: 1 });
    const nonce = installAgentBridge();
    await expect(bridge().exec(nonce, 'search_notes', {})).rejects.toThrow('Unlock the workspace');
    await expect(bridge().investigations()).rejects.toThrow('Unlock the workspace');
    expect(() => bridge().folderId()).toThrow('Unlock the workspace');
    expect(() => bridge().setFolderId(nonce, 'case')).toThrow('Unlock the workspace');
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.folders).not.toHaveBeenCalled();
  });

  it('permits normal reads only after unlocked initialization succeeds', async () => {
    const nonce = installAgentBridge();
    await expect(bridge().exec(nonce, 'search_notes', {})).resolves.toBe('[]');
    await expect(bridge().investigations()).resolves.toBe('[]');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.folders).toHaveBeenCalledTimes(1);
  });
});
