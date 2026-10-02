import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { DEFAULT_SETTINGS, type AgentDeployment, type Folder } from '../types';

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown) => void>();
  const collection = { remove: vi.fn(), removeClass: vi.fn().mockReturnThis(), addClass: vi.fn().mockReturnThis(), unselect: vi.fn().mockReturnThis() };
  const graph = { on: vi.fn((name: string, ...args: unknown[]) => { handlers.set(name + (typeof args[0] === 'string' ? ':' + args[0] : ''), args.at(-1) as (event: unknown) => void); }),
    elements: () => collection, batch: (fn: () => void) => fn(), layout: () => ({ run: vi.fn() }), fit: vi.fn(), destroy: vi.fn() };
  return { handlers, graph, cytoscape: vi.fn(() => graph), cycle: vi.fn(), meeting: vi.fn() };
});
vi.mock('cytoscape', () => ({ default: Object.assign(mocks.cytoscape, { use: vi.fn() }) }));
vi.mock('cytoscape-cose-bilkent', () => ({ default: {} }));
vi.mock('../lib/caddy-agent', () => ({ runAgentCycle: mocks.cycle }));
vi.mock('../lib/caddy-agent-manager', () => ({ runMultiAgentCycle: vi.fn() }));
vi.mock('../lib/caddy-agent-supervisor', () => ({ runSupervisorCycle: vi.fn(), sendEscalationNotification: vi.fn() }));
vi.mock('../lib/caddy-agent-meeting', () => ({ runAgentMeeting: mocks.meeting, runHandoffCall: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import GraphCanvas from '../components/Graph/GraphCanvas';
import { AgentMeetingPanel } from '../components/Agent/AgentMeetingPanel';
import { useCaddyAgent } from '../hooks/useCaddyAgent';

const folder = (id: string): Folder => ({ id, name: id, order: 0, createdAt: 1, agentEnabled: false });
beforeEach(async () => {
  vi.stubGlobal('ResizeObserver', class { observe = vi.fn(); disconnect = vi.fn(); });
  vi.clearAllMocks(); mocks.handlers.clear();
  mocks.cycle.mockResolvedValue({ autoExecuted: [], proposed: [], threadId: 'thread' });
  mocks.meeting.mockResolvedValue(undefined);
  await Promise.all([db.folders.clear(), db.notes.clear(), db.agentDeployments.clear(), db.agentMeetings.clear()]);
});
afterEach(() => vi.unstubAllGlobals());

describe('committed callback bindings', () => {
  it('keeps Cytoscape handlers stable while forwarding to the latest committed callback', () => {
    const first = vi.fn(); const second = vi.fn();
    const props = { data: { nodes: [], edges: [] }, layout: 'circle' as const, theme: 'dark' as const, onSelectNode: vi.fn() };
    const { rerender, unmount } = render(<GraphCanvas {...props} onDoubleClickNode={first} />);
    act(() => mocks.handlers.get('dbltap:node')?.({ target: { id: () => 'one' } }));
    expect(first).toHaveBeenCalledWith('one');
    rerender(<GraphCanvas {...props} onDoubleClickNode={second} />);
    act(() => mocks.handlers.get('dbltap:node')?.({ target: { id: () => 'two' } }));
    expect(second).toHaveBeenCalledWith('two');
    expect(first).toHaveBeenCalledTimes(1);
    expect(mocks.cytoscape).toHaveBeenCalledTimes(1);
    unmount();
    expect(mocks.graph.destroy).toHaveBeenCalledTimes(1);
  });

  it('runs an existing manual agent callback against the latest committed folder and settings', async () => {
    const first = folder('one'); const second = folder('two');
    await db.folders.bulkAdd([first, second]);
    const settings = { ...DEFAULT_SETTINGS, agentSupervisorEnabled: false };
    const { result, rerender } = renderHook(({ currentFolder, currentSettings }) => useCaddyAgent({ folder: currentFolder, settings: currentSettings }),
      { initialProps: { currentFolder: first, currentSettings: settings } });
    const run = result.current.runOnce;
    const latest = { ...settings, theme: 'light' as const };
    rerender({ currentFolder: second, currentSettings: latest });
    await act(async () => { await run(); });
    expect(mocks.cycle.mock.calls[0][0].id).toBe('two');
    expect(mocks.cycle.mock.calls[0][1]).toBe(latest);
  });

  it('trashes a completed meeting request only after the click, with one mutation timestamp', async () => {
    await db.notes.add({ id: 'request', folderId: 'one', title: 'Meeting Request: Review', content: '**Agenda:** Review', tags: ['meeting-request'],
      pinned: false, trashed: false, archived: false, createdAt: 1, updatedAt: 1 });
    const deployments = ['a', 'b'].map(id => ({ id, investigationId: 'one', profileId: id, status: 'idle', order: 0, createdAt: 1, updatedAt: 1 } as AgentDeployment));
    render(<AgentMeetingPanel folder={folder('one')} deployments={deployments} settings={DEFAULT_SETTINGS} extensionAvailable={false} />);
    const button = await screen.findByRole('button', { name: 'meeting.run' });
    expect(mocks.meeting).not.toHaveBeenCalled();
    expect((await db.notes.get('request'))?.trashed).toBe(false);
    fireEvent.click(button);
    await waitFor(async () => expect((await db.notes.get('request'))?.trashed).toBe(true));
    const saved = await db.notes.get('request');
    expect(saved?.trashedAt).toBe(saved?.updatedAt);
  });
});
