import { act, cleanup, renderHook } from '@testing-library/react';
import type { KeyboardEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentDeployments } from '../hooks/useAgentDeployments';
import { useAgentProfiles } from '../hooks/useAgentProfiles';
import { useCustomSlashCommands } from '../hooks/useCustomSlashCommands';
import { useDropdownKeyboard } from '../hooks/useDropdownKeyboard';
import { DEFAULT_AGENT_POLICY, type AgentDeployment, type AgentProfile, type CustomSlashCommand } from '../types';

const queries = vi.hoisted(() => ({ deployments: vi.fn(), profiles: vi.fn(), commands: vi.fn() }));
vi.mock('../db', () => ({ db: {
  agentDeployments: { where: () => ({ between: ([id]: [string, number]) => ({ toArray: () => queries.deployments(id) }) }) },
  agentProfiles: { toArray: queries.profiles },
  customSlashCommands: { toArray: queries.commands },
} }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const deployment = (id: string, investigationId = 'first'): AgentDeployment => ({ id, investigationId, profileId: 'profile', status: 'idle', order: 0, createdAt: 1, updatedAt: 1 });
const profile = (id: string): AgentProfile => ({ id, name: id, role: 'specialist', systemPrompt: 'Summarize notes.', policy: DEFAULT_AGENT_POLICY, source: 'user', createdAt: 1, updatedAt: 1 });
const command = (id: string): CustomSlashCommand => ({ id, name: id, description: id, template: 'Summarize {{input}}', createdAt: 1, updatedAt: 1 });
beforeEach(() => {
  queries.deployments.mockReset().mockResolvedValue([]);
  queries.profiles.mockReset().mockResolvedValue([]);
  queries.commands.mockReset().mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('agent deployment reload ownership', () => {
  it('fences old-folder success and callbacks while the new folder is loading', async () => {
    const old = deferred<AgentDeployment[]>(); const next = deferred<AgentDeployment[]>();
    queries.deployments.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const { result, rerender } = renderHook(({ id }) => useAgentDeployments(id), { initialProps: { id: 'first' } });
    const retainedReload = result.current.reload;
    rerender({ id: 'second' });
    await act(async () => { old.resolve([deployment('old')]); await retainedReload(); });
    expect(result.current.deployments).toEqual([]);
    expect(result.current.loading).toBe(true);
    expect(queries.deployments).toHaveBeenCalledTimes(2);
    await act(async () => next.resolve([deployment('current', 'second')]));
    expect(result.current.deployments.map(row => row.id)).toEqual(['current']);
    expect(result.current.loading).toBe(false);
  });

  it('ignores a superseded rejection without clearing the latest rows, loading or error', async () => {
    const old = deferred<AgentDeployment[]>(); const next = deferred<AgentDeployment[]>();
    queries.deployments.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const { result } = renderHook(() => useAgentDeployments('first'));
    let newest!: Promise<void>;
    act(() => { newest = result.current.reload(); });
    await act(async () => old.reject(new Error('Old query failed')));
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
    await act(async () => { next.resolve([deployment('current')]); await newest; });
    expect(result.current.deployments.map(row => row.id)).toEqual(['current']);
    queries.deployments.mockRejectedValueOnce(new Error('Current query failed'));
    await act(async () => { await expect(result.current.reload()).rejects.toThrow('Current query failed'); });
    expect(result.current.deployments.map(row => row.id)).toEqual(['current']);
    expect(result.current.error).toBe('Current query failed');
    expect(result.current.loading).toBe(false);
  });

  it('coalesces the owned debounce and cancels it plus polling on navigation/unmount', async () => {
    vi.useFakeTimers();
    const { result, rerender, unmount } = renderHook(({ id }) => useAgentDeployments(id), { initialProps: { id: 'first' } });
    await act(async () => {});
    act(() => {
      window.dispatchEvent(new Event('tc-folders-changed'));
      window.dispatchEvent(new Event('tc-folders-changed'));
      window.dispatchEvent(new Event('tc-folders-changed'));
    });
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(queries.deployments).toHaveBeenCalledTimes(2);
    act(() => window.dispatchEvent(new Event('tc-folders-changed')));
    rerender({ id: 'second' });
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(queries.deployments).toHaveBeenCalledTimes(3);
    expect(queries.deployments).toHaveBeenLastCalledWith('second');
    const reload = result.current.reload;
    act(() => window.dispatchEvent(new Event('tc-folders-changed')));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { await reload(); await vi.advanceTimersByTimeAsync(10_000); });
    expect(queries.deployments).toHaveBeenCalledTimes(3);
  });

  it('clears the selected list immediately when the investigation is removed', async () => {
    queries.deployments.mockResolvedValueOnce([deployment('current')]);
    const { result, rerender } = renderHook(({ id }: { id?: string }) => useAgentDeployments(id), { initialProps: { id: 'first' } as { id?: string } });
    await act(async () => {});
    expect(result.current.deployments).toHaveLength(1);
    rerender({ id: undefined });
    expect(result.current.deployments).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });
});

const globalLists = [
  { name: 'profiles', query: queries.profiles, row: profile, useRows() { const state = useAgentProfiles(); return { rows: state.userProfiles, reload: state.reload, error: state.error }; } },
  { name: 'slash commands', query: queries.commands, row: command, useRows() { const state = useCustomSlashCommands(); return { rows: state.commands, reload: state.reload, error: state.error }; } },
];
for (const list of globalLists) describe(`${list.name} reload ordering`, () => {
  it('does not resurrect deleted rows from an older in-flight reload', async () => {
    const old = deferred<Array<AgentProfile | CustomSlashCommand>>(); const next = deferred<Array<AgentProfile | CustomSlashCommand>>();
    list.query.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const { result } = renderHook(() => list.useRows());
    let latest!: Promise<void>;
    act(() => { latest = result.current.reload(); });
    await act(async () => { next.resolve([]); await latest; });
    await act(async () => old.resolve([list.row('removed')]));
    expect(result.current.rows).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('ignores stale failure, preserves sorting, and rejects only the current failed refresh', async () => {
    const old = deferred<Array<AgentProfile | CustomSlashCommand>>();
    list.query.mockReturnValueOnce(old.promise).mockResolvedValueOnce([list.row('zeta'), list.row('alpha')]);
    const { result } = renderHook(() => list.useRows());
    await act(async () => result.current.reload());
    await act(async () => old.reject(new Error('Old query failed')));
    expect(result.current.rows.map(row => row.name)).toEqual(['alpha', 'zeta']);
    expect(result.current.error).toBeNull();
    list.query.mockRejectedValueOnce(new Error('Current query failed'));
    await act(async () => { await expect(result.current.reload()).rejects.toThrow('Current query failed'); });
    expect(result.current.error).toBe('Current query failed');
    expect(result.current.rows.map(row => row.name)).toEqual(['alpha', 'zeta']);
  });

  it('does not issue retained reloads after unmount or publish a pending result', async () => {
    const pending = deferred<Array<AgentProfile | CustomSlashCommand>>(); list.query.mockReturnValueOnce(pending.promise);
    const { result, unmount } = renderHook(() => list.useRows());
    const reload = result.current.reload;
    unmount();
    await act(async () => { pending.resolve([list.row('late')]); await reload(); });
    expect(list.query).toHaveBeenCalledOnce();
    expect(result.current.rows).toEqual([]);
  });
});

it('coalesces profile refresh events and clears the pending timer on unmount', async () => {
  vi.useFakeTimers();
  const { unmount } = renderHook(useAgentProfiles);
  await act(async () => {});
  act(() => {
    window.dispatchEvent(new Event('tc-folders-changed'));
    window.dispatchEvent(new Event('tc-folders-changed'));
  });
  await act(async () => vi.advanceTimersByTimeAsync(200));
  expect(queries.profiles).toHaveBeenCalledTimes(2);
  act(() => window.dispatchEvent(new Event('tc-folders-changed')));
  unmount();
  expect(vi.getTimerCount()).toBe(0);
  await act(async () => vi.advanceTimersByTimeAsync(200));
  expect(queries.profiles).toHaveBeenCalledTimes(2);
});

const key = (name: string) => ({ key: name, preventDefault: vi.fn() }) as unknown as KeyboardEvent;
describe('dropdown bounds when options change', () => {
  it('clears an invalid selection after shrink, does not resurrect it after growth, and safely resumes navigation', () => {
    const onSelect = vi.fn(); const onClose = vi.fn();
    const { result, rerender } = renderHook(({ count }) => useDropdownKeyboard({ itemCount: count, onSelect, onClose, isOpen: true }), { initialProps: { count: 5 } });
    act(() => result.current.setActiveIndex(4));
    rerender({ count: 2 });
    expect(result.current.activeIndex).toBe(-1);
    act(() => { result.current.onKeyDown(key('Enter')); result.current.onKeyDown(key(' ')); });
    expect(onSelect).not.toHaveBeenCalled();
    rerender({ count: 5 });
    expect(result.current.activeIndex).toBe(-1);
    act(() => result.current.onKeyDown(key('ArrowDown')));
    expect(result.current.activeIndex).toBe(0);
    act(() => result.current.onKeyDown(key('Enter')));
    expect(onSelect).toHaveBeenCalledWith(0);
  });

  it('preserves a still-valid index and lets an empty menu close with Escape or Tab', () => {
    const onSelect = vi.fn(); const onClose = vi.fn();
    const { result, rerender } = renderHook(({ count }) => useDropdownKeyboard({ itemCount: count, onSelect, onClose, isOpen: true }), { initialProps: { count: 5 } });
    act(() => result.current.setActiveIndex(1));
    rerender({ count: 2 });
    expect(result.current.activeIndex).toBe(1);
    rerender({ count: 0 });
    expect(result.current.activeIndex).toBe(-1);
    act(() => { result.current.onKeyDown(key('ArrowUp')); result.current.onKeyDown(key('Enter')); result.current.onKeyDown(key('Escape')); result.current.onKeyDown(key('Tab')); });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
