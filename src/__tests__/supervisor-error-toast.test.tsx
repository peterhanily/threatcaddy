/** The whole App: a supervisor cycle that could not run says why in an error toast instead of failing silently. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, configure, getConfig, render, screen } from '@testing-library/react';
import App from '../App';
import { db } from '../db';
import { workspaceStorageKey } from '../lib/workspace-profiles';

const supervisor = vi.hoisted(() => ({ runSupervisorCycle: vi.fn() }));
vi.mock('../lib/caddy-agent-supervisor', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/caddy-agent-supervisor')>(), runSupervisorCycle: supervisor.runSupervisorCycle,
}));

// A cold render of the App and its lazy chunks can exceed the default timeouts under a loaded suite.
const defaultAsyncTimeout = getConfig().asyncUtilTimeout;
beforeAll(() => { configure({ asyncUtilTimeout: 5_000 }); });
afterAll(() => { configure({ asyncUtilTimeout: defaultAsyncTimeout }); });

beforeEach(async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, onchange: null, addListener() {},
    removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = () => {};
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/');
  await Promise.all(db.tables.map(table => table.clear()));
  localStorage.setItem(workspaceStorageKey('threatcaddy-settings'), JSON.stringify({ agentSupervisorEnabled: true }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('supervisor refusal', () => {
  it('a supervisor cycle that returns an error shows it in an error toast', async () => {
    supervisor.runSupervisorCycle.mockResolvedValue({ findings: [], escalations: [], error: 'Synthetic refusal' });
    // The supervisor's first run waits 10 s; only that wait is skipped.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    render(<App />);
    await screen.findAllByRole('button', { name: /^Investigations/ });
    // The fake clock also moves while the render is idle, so one 10 s step could run past the run and the
    // 4 s error toast's removal. Step 1 s at a time and stop once the run has happened.
    await act(async () => {
      for (let step = 0; step < 20 && supervisor.runSupervisorCycle.mock.calls.length === 0; step++) await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(await screen.findByText('The supervisor agent could not run: Synthetic refusal')).toBeInTheDocument();
    expect(supervisor.runSupervisorCycle).toHaveBeenCalledOnce();
  }, 30_000);
});
