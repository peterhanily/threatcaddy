import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCaddyAgent } from '../hooks/useCaddyAgent';
import { DEFAULT_SETTINGS, type Folder } from '../types';
import type { AgentAction } from '../types';
import type { AgentCycleResult } from '../lib/caddy-agent';

const mocks = vi.hoisted(() => ({
  folders: new Map<string, Folder>(), get: vi.fn(), count: vi.fn(), metrics: vi.fn(), pending: vi.fn(), memory: vi.fn(),
  run: vi.fn(), multi: vi.fn(), supervisor: vi.fn(), notify: vi.fn(),
}));
vi.mock('../lib/caddy-agent', () => ({ runAgentCycle: mocks.run }));
vi.mock('../lib/caddy-agent-manager', () => ({ runMultiAgentCycle: mocks.multi }));
vi.mock('../lib/caddy-agent-supervisor', () => ({ runSupervisorCycle: mocks.supervisor, sendEscalationNotification: mocks.notify }));
vi.mock('../lib/utils', () => ({ postMessageOrigin: () => '*' }));
vi.mock('../db', () => ({ db: {
  folders: { get: mocks.get, update: vi.fn() },
  agentDeployments: { where: () => ({ equals: () => ({ count: mocks.count, toArray: mocks.metrics }) }) },
  // mocks.pending resolves the investigation's pending rows.
  agentActions: { where: () => ({ equals: () => ({
    count: async () => (await mocks.pending()).length,
    filter: (keep: (row: Partial<AgentAction>) => boolean) => ({ count: async () => (await mocks.pending()).filter(keep).length }),
  }) }) },
  chatThreads: { where: () => ({ equals: () => ({ modify: mocks.memory }) }) },
} }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const outcome: AgentCycleResult = { threadId: 'audit', autoExecuted: [], proposed: [] };
const folder = (id = 'first', enabled = true): Folder => ({ id, name: id, order: 0, createdAt: 1, agentEnabled: enabled });
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); mocks.folders.clear();
  mocks.get.mockImplementation(async (id: string) => mocks.folders.get(id));
  mocks.count.mockResolvedValue(0); mocks.pending.mockResolvedValue([]); mocks.metrics.mockResolvedValue([]);
  mocks.run.mockResolvedValue(outcome); mocks.multi.mockResolvedValue({ deploymentResults: new Map(), errors: [], waitingForReview: [] });
  mocks.supervisor.mockResolvedValue({ findings: [], escalations: [] });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('agent hook lifecycle ownership', () => {
  it('aborts an active cycle and cannot reschedule it after the agent is disabled', async () => {
    const first = folder(); mocks.folders.set(first.id, first);
    const pending = deferred<AgentCycleResult>(); mocks.run.mockReturnValueOnce(pending.promise);
    const changed = vi.fn();
    const { rerender } = renderHook(({ selected }) => useCaddyAgent({ folder: selected, settings: DEFAULT_SETTINGS, onEntitiesChanged: changed }), { initialProps: { selected: first } });
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(mocks.run).toHaveBeenCalledOnce();
    const signal = mocks.run.mock.calls[0][7] as AbortSignal;
    rerender({ selected: { ...first, agentEnabled: false } });
    expect(signal.aborted).toBe(true);
    await act(async () => { pending.resolve(outcome); });
    await act(async () => vi.advanceTimersByTimeAsync(600_000));
    expect(mocks.run).toHaveBeenCalledOnce();
    expect(mocks.metrics).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  });

  it('cannot recreate an old folder timer from a metrics read that finishes after navigation', async () => {
    const first = folder(); const second = folder('second', false); mocks.folders.set(first.id, first); mocks.folders.set(second.id, second);
    const metrics = deferred<never[]>(); mocks.metrics.mockReturnValueOnce(metrics.promise);
    const { rerender } = renderHook(({ selected }) => useCaddyAgent({ folder: selected, settings: DEFAULT_SETTINGS }), { initialProps: { selected: first } });
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(mocks.metrics).toHaveBeenCalledOnce();
    rerender({ selected: second });
    await act(async () => metrics.resolve([]));
    await act(async () => vi.advanceTimersByTimeAsync(600_000));
    expect(mocks.run).toHaveBeenCalledOnce();
  });

  it('fences pending preflight reads while manual commands retain their latest-committed-folder contract', async () => {
    const first = folder('first', false); const second = folder('second', false);
    mocks.folders.set(first.id, first); mocks.folders.set(second.id, second);
    const count = deferred<number>(); mocks.count.mockReturnValueOnce(count.promise);
    const { result, rerender } = renderHook(({ selected }) => useCaddyAgent({ folder: selected, settings: DEFAULT_SETTINGS }), { initialProps: { selected: first } });
    const retained = result.current.runOnce;
    let initial!: Promise<void>;
    await act(async () => { initial = retained(); });
    rerender({ selected: second });
    await act(async () => { count.resolve(0); await initial; });
    expect(mocks.run).not.toHaveBeenCalled();
    await act(async () => retained());
    expect(mocks.run).toHaveBeenCalledOnce();
    expect(mocks.run.mock.calls[0][0].id).toBe('second');
  });

  it('cancels the supervisor on disable, without late notifications or another scheduled cycle', async () => {
    const pending = deferred<{ findings: string[]; escalations: Array<{ title: string }> }>();
    mocks.supervisor.mockReturnValueOnce(pending.promise);
    const { rerender } = renderHook(({ enabled }) => useCaddyAgent({ settings: { ...DEFAULT_SETTINGS, agentSupervisorEnabled: enabled, agentSupervisorIntervalMinutes: 1 } }), { initialProps: { enabled: true } });
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    const signal = mocks.supervisor.mock.calls[0][3] as AbortSignal;
    rerender({ enabled: false });
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve({ findings: [], escalations: [{ title: 'Late synthetic result' }] }));
    await act(async () => vi.advanceTimersByTimeAsync(300_000));
    expect(mocks.supervisor).toHaveBeenCalledOnce();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('uses the latest extension readiness instead of the initial timer closure', async () => {
    const first = folder(); mocks.folders.set(first.id, first);
    renderHook(() => useCaddyAgent({ folder: first, settings: DEFAULT_SETTINGS }));
    act(() => window.dispatchEvent(new MessageEvent('message', { source: window, data: { type: 'TC_EXTENSION_READY' } })));
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(mocks.run.mock.calls[0][2]).toBe(true);
  });

  it('does not auto-start the legacy agent while its own proposal is pending', async () => {
    const first = folder(); mocks.folders.set(first.id, first); mocks.pending.mockResolvedValue([{ toolName: 'fetch_url' }]);
    const { result } = renderHook(() => useCaddyAgent({ folder: first, settings: DEFAULT_SETTINGS }));
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.metrics).toHaveBeenCalledOnce();
    expect(result.current.agentStatus).toBe('waiting');
  });

  it('a manual run still runs the legacy agent while its own proposal is pending', async () => {
    const first = folder('first', false); mocks.folders.set(first.id, first); mocks.pending.mockResolvedValue([{ toolName: 'fetch_url' }]);
    const { result } = renderHook(() => useCaddyAgent({ folder: first, settings: DEFAULT_SETTINGS }));
    await act(async () => result.current.runOnce());
    expect(mocks.run).toHaveBeenCalledOnce();
  });

  it('one agent waiting for review does not slow the others', async () => {
    const first = folder(); mocks.folders.set(first.id, first); mocks.count.mockResolvedValue(2);
    mocks.multi.mockResolvedValue({ deploymentResults: new Map([['dep-ap-lead-analyst', outcome]]), errors: [], waitingForReview: ['ap-threat-hunter'] });
    const { result } = renderHook(() => useCaddyAgent({ folder: first, settings: DEFAULT_SETTINGS }));
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(result.current.agentStatus).toBe('waiting');
    await act(async () => vi.advanceTimersByTimeAsync(300_000));
    expect(mocks.multi).toHaveBeenCalledTimes(2);
  });

  it('B-PAUSE-1 keeps running deployed agents while one of them waits for review', async () => {
    const first = folder(); mocks.folders.set(first.id, first); mocks.count.mockResolvedValue(2);
    mocks.pending.mockResolvedValue([{ toolName: 'fetch_url', agentConfigId: 'ap-threat-hunter' }]);
    renderHook(() => useCaddyAgent({ folder: first, settings: DEFAULT_SETTINGS }));
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(mocks.multi).toHaveBeenCalledOnce();
  });

  it('a manual run or chat run_agent_cycle also runs deployed agents waiting for review; the timer does not', async () => {
    const first = folder(); mocks.folders.set(first.id, first); mocks.count.mockResolvedValue(1);
    const { result } = renderHook(() => useCaddyAgent({ folder: first, settings: DEFAULT_SETTINGS }));
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(mocks.multi).toHaveBeenCalledOnce();
    expect(mocks.multi.mock.calls[0][5]).toEqual({ manual: false });
    await act(async () => result.current.runOnce());
    expect(mocks.multi.mock.calls[1][5]).toEqual({ manual: true });
    await act(async () => { window.dispatchEvent(new CustomEvent('tc-run-agent-cycle', { detail: { folderId: first.id } })); });
    expect(mocks.multi.mock.calls[2][5]).toEqual({ manual: true });
  });

  it('B-PAUSE-1 a deployed agent\'s or the supervisor\'s proposal does not pause the legacy agent', async () => {
    const first = folder(); mocks.folders.set(first.id, first);
    mocks.pending.mockResolvedValue([{ toolName: 'fetch_url', agentConfigId: 'ap-threat-hunter' }, { toolName: 'update_ioc', agentConfigId: 'caddy-supervisor' }]);
    renderHook(() => useCaddyAgent({ folder: first, settings: DEFAULT_SETTINGS }));
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(mocks.run).toHaveBeenCalledOnce();
  });

  it('every deployed agent waiting for review leaves the investigation waiting, without an error', async () => {
    const first = folder(); mocks.folders.set(first.id, first); mocks.count.mockResolvedValue(1);
    mocks.multi.mockResolvedValue({ deploymentResults: new Map(), errors: [], waitingForReview: ['ap-threat-hunter'] });
    const { result } = renderHook(() => useCaddyAgent({ folder: first, settings: DEFAULT_SETTINGS }));
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(result.current.agentStatus).toBe('waiting');
    expect(result.current.error).toBeNull();
  });

  it('does not shorten the interval for agents whose actions mostly ran', async () => {
    const first = folder(); mocks.folders.set(first.id, first); mocks.count.mockResolvedValue(1);
    mocks.metrics.mockResolvedValue([{ metrics: { toolCallsExecuted: 100, toolCallsProposed: 0 } }]);
    renderHook(() => useCaddyAgent({ folder: first, settings: DEFAULT_SETTINGS }));
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(mocks.multi).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(299_000));
    expect(mocks.multi).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(mocks.multi).toHaveBeenCalledTimes(2);
  });

  it('still slows down agents whose actions mostly wait for review', async () => {
    const first = folder(); mocks.folders.set(first.id, first); mocks.count.mockResolvedValue(1);
    mocks.metrics.mockResolvedValue([{ metrics: { toolCallsExecuted: 2, toolCallsProposed: 18 } }]);
    renderHook(() => useCaddyAgent({ folder: first, settings: DEFAULT_SETTINGS }));
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    await act(async () => vi.advanceTimersByTimeAsync(599_000));
    expect(mocks.multi).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(mocks.multi).toHaveBeenCalledTimes(2);
  });

  it('stops active requests and ignores manual callbacks when the workspace switches', async () => {
    const first = folder('first', false); mocks.folders.set(first.id, first);
    const pending = deferred<AgentCycleResult>(); mocks.run.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useCaddyAgent({ folder: first, settings: DEFAULT_SETTINGS }));
    let running!: Promise<void>;
    await act(async () => { running = result.current.runOnce(); });
    const signal = mocks.run.mock.calls[0][7] as AbortSignal;
    act(() => window.dispatchEvent(new Event('workspace-will-switch')));
    expect(signal.aborted).toBe(true);
    await act(async () => { pending.resolve(outcome); await running; await result.current.runOnce(); });
    expect(mocks.run).toHaveBeenCalledOnce();
    expect(mocks.memory).not.toHaveBeenCalled();
  });
});
