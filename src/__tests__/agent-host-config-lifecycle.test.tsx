import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentHostsConfig } from '../components/Settings/AgentHostsConfig';
import { useSettings } from '../hooks/useSettings';
import { fetchHostSkills } from '../lib/agent-hosts';
import type { AgentHost, AgentHostSkill } from '../types';

vi.mock('../lib/agent-hosts', () => ({ fetchHostSkills: vi.fn() }));
const fetchSkills = vi.mocked(fetchHostSkills);
const host = (id: string): AgentHost => ({ id, name: id, displayName: `Fictional ${id}`, url: `https://${id}.example.test`, enabled: true, skills: [] });
const skills = (name: string): AgentHostSkill[] => [{ name, description: 'Synthetic skill, never executed', parameters: { type: 'object', properties: {} } }];
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
let settingsControl: ReturnType<typeof useSettings>;
function Harness() {
  const current = useSettings();
  useLayoutEffect(() => { settingsControl = current; });
  return <AgentHostsConfig settings={current.settings} onUpdateSettings={current.updateSettings} />;
}
const saved = (): AgentHost[] => JSON.parse(localStorage.getItem('threatcaddy-settings') || '{}').agentHosts;
const firstFetch = () => fireEvent.click(screen.getAllByRole('button', { name: 'Fetch Skills' })[0]);

beforeEach(() => {
  fetchSkills.mockReset(); localStorage.clear();
  localStorage.setItem('threatcaddy-settings', JSON.stringify({ agentHosts: [host('alpha'), host('beta')] }));
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('agent-host discovery ownership', () => {
  it('Refresh All accumulates each result in current persisted settings', async () => {
    const first = deferred<AgentHostSkill[]>(); const second = deferred<AgentHostSkill[]>();
    fetchSkills.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<Harness />); fireEvent.click(screen.getByRole('button', { name: 'Refresh All' }));
    await act(async () => { first.resolve(skills('alpha-skill')); });
    expect(fetchSkills).toHaveBeenCalledTimes(2);
    await act(async () => { second.resolve(skills('beta-skill')); });
    expect(saved().map(item => item.skills[0]?.name)).toEqual(['alpha-skill', 'beta-skill']);
    expect(screen.getByRole('status')).toHaveTextContent('Connected');
  });

  it.each(['remove', 'disable'] as const)('does not undo %s while discovery is pending', async operation => {
    const work = deferred<AgentHostSkill[]>(); fetchSkills.mockReturnValue(work.promise);
    render(<Harness />); firstFetch();
    const signal = fetchSkills.mock.calls[0][1];
    fireEvent.click(screen.getByRole(operation === 'remove' ? 'button' : 'switch', { name: `${operation === 'remove' ? 'Delete' : 'Disable'} Fictional alpha` }));
    expect(signal?.aborted).toBe(true);
    const before = localStorage.getItem('threatcaddy-settings');
    await act(async () => { work.resolve(skills('must-not-save')); });
    expect(localStorage.getItem('threatcaddy-settings')).toBe(before);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it.each(['url', 'apiKey', 'name'] as const)('discards completion after current %s configuration changes', async field => {
    const work = deferred<AgentHostSkill[]>(); fetchSkills.mockReturnValue(work.promise);
    render(<Harness />); firstFetch();
    act(() => settingsControl.updateSettings(current => ({ agentHosts: current.agentHosts?.map(item => item.id === 'alpha'
      ? { ...item, [field]: field === 'url' ? 'https://changed.example.test' : 'synthetic-new-value' } : item) })));
    expect(fetchSkills.mock.calls[0][1]?.aborted).toBe(true);
    const before = localStorage.getItem('threatcaddy-settings');
    await act(async () => { work.reject(new Error('Stale synthetic failure')); });
    expect(localStorage.getItem('threatcaddy-settings')).toBe(before);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('merges skills without overwriting concurrently added hosts, labels or unrelated settings', async () => {
    const work = deferred<AgentHostSkill[]>(); fetchSkills.mockReturnValue(work.promise);
    render(<Harness />); firstFetch();
    await act(async () => {
      settingsControl.updateSettings(current => ({ language: 'en', agentHosts: [...(current.agentHosts || []).map(item => item.id === 'alpha' ? { ...item, displayName: 'Renamed by analyst' } : item), host('gamma')] }));
      work.resolve(skills('read-only-discovery'));
    });
    expect(saved()).toHaveLength(3);
    expect(saved()[0]).toMatchObject({ displayName: 'Renamed by analyst', skills: skills('read-only-discovery') });
    expect(saved()[2].id).toBe('gamma');
  });

  it('checks the current settings again inside the atomic updater, even before props commit', async () => {
    const work = deferred<AgentHostSkill[]>(); fetchSkills.mockReturnValue(work.promise);
    render(<Harness />); firstFetch();
    await act(async () => {
      settingsControl.updateSettings(current => ({ agentHosts: current.agentHosts?.filter(item => item.id !== 'alpha') }));
      work.resolve(skills('must-not-resurrect'));
    });
    expect(saved().map(item => item.id)).toEqual(['beta']);
  });

  it('keeps the latest request pending and ignores an older completion', async () => {
    const old = deferred<AgentHostSkill[]>(); const latest = deferred<AgentHostSkill[]>();
    fetchSkills.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise).mockResolvedValue(skills('beta'));
    render(<Harness />); firstFetch();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh All' }));
    expect(fetchSkills.mock.calls[0][1]?.aborted).toBe(true);
    await act(async () => { old.resolve(skills('old')); });
    expect(screen.getAllByRole('button', { name: 'Fetch Skills' })[0]).toBeDisabled();
    await act(async () => { latest.resolve(skills('current')); });
    expect(saved()[0].skills[0].name).toBe('current');
  });

  it.each(['unmount', 'workspace'] as const)('aborts %s ownership and never continues its batch', async ending => {
    const work = deferred<AgentHostSkill[]>(); fetchSkills.mockReturnValue(work.promise);
    const view = render(<Harness />); fireEvent.click(screen.getByRole('button', { name: 'Refresh All' }));
    const before = localStorage.getItem('threatcaddy-settings');
    if (ending === 'unmount') view.unmount();
    else act(() => window.dispatchEvent(new Event('workspace-will-switch')));
    expect(fetchSkills.mock.calls[0][1]?.aborted).toBe(true);
    await act(async () => { work.resolve(skills('old-workspace')); });
    expect(fetchSkills).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('threatcaddy-settings')).toBe(before);
  });

  it('skips a now-disabled queued host and allows retry after a current failure', async () => {
    const first = deferred<AgentHostSkill[]>(); fetchSkills.mockReturnValueOnce(first.promise).mockResolvedValue(skills('retry'));
    render(<Harness />); fireEvent.click(screen.getByRole('button', { name: 'Refresh All' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Disable Fictional beta' }));
    await act(async () => { first.reject(new Error('Synthetic offline failure')); });
    expect(fetchSkills).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent('Synthetic offline failure');
    firstFetch();
    await waitFor(() => expect(saved()[0].skills[0]?.name).toBe('retry'));
    expect(saved()[1].enabled).toBe(false);
  });
});
