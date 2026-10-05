import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentAction, Folder, Settings } from '../types';
import { AgentPanel } from '../components/Agent/AgentPanel';

const api = vi.hoisted(() => ({ actions: vi.fn(), tasks: vi.fn(), run: vi.fn() }));
vi.mock('../db', () => ({ db: {
  agentActions: { where: () => ({ between: ([folder]: [string, number]) => ({ reverse: () => ({ limit: (limit: number) => ({ toArray: () => api.actions(folder, limit) }) }) }) }) },
  tasks: { where: () => ({ equals: (folder: string) => ({ toArray: () => api.tasks(folder) }) }) },
} }));
vi.mock('../lib/caddy-agent', () => ({ executeApprovedAction: vi.fn(), rejectAction: vi.fn(), bulkApproveActions: vi.fn() }));
vi.mock('../lib/agent-handoff', () => ({ acknowledgeReconciliation: vi.fn() }));
vi.mock('../components/Agent/AgentActionCard', () => ({ AgentActionCard: ({ action }: { action: AgentAction }) => <article>{action.rationale}</article> }));
vi.mock('../components/Agent/AgentProfilePicker', () => ({ AgentProfilePicker: () => null }));
vi.mock('../components/Agent/AgentMeetingPanel', () => ({ AgentMeetingPanel: () => null }));

function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Not initialized'); };
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const action = (folder: string, rationale = `Action for ${folder}`): AgentAction => ({ id: `action-${folder}`, investigationId: folder,
  threadId: `thread-${folder}`, toolName: 'create_note', toolInput: {}, rationale, status: 'pending', createdAt: 1 });
const folder = (id: string): Folder => ({ id, name: `Synthetic ${id}`, order: 0, createdAt: 1 });
const settings = { llmLocalEndpoint: 'http://localhost:11434' } as Settings;
beforeEach(() => { vi.clearAllMocks(); api.tasks.mockResolvedValue([]); api.run.mockResolvedValue(undefined); });
afterEach(cleanup);

describe('release hardening: investigation action inbox ownership', () => {
  it('ignores actions loaded for an investigation that is no longer selected', async () => {
    const earlier = deferred<AgentAction[]>();
    api.actions.mockImplementation((id: string) => id === 'a' ? earlier.promise : Promise.resolve([action('b')]));
    const view = render(<AgentPanel folder={folder('a')} settings={settings} />);
    view.rerender(<AgentPanel folder={folder('b')} settings={settings} />);
    expect(await screen.findByText('Action for b')).toBeInTheDocument();
    await act(async () => { earlier.resolve([action('a')]); });
    expect(screen.queryByText('Action for a')).not.toBeInTheDocument();
    expect(screen.getByText('Action for b')).toBeInTheDocument();
  });

  it('clears old actions and bulk confirmation before the next investigation loads', async () => {
    const next = deferred<AgentAction[]>();
    api.actions.mockImplementation((id: string) => id === 'a' ? Promise.resolve([action('a')]) : next.promise);
    const view = render(<AgentPanel folder={folder('a')} settings={settings} />);
    expect(await screen.findByText('Action for a')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /approve all/i }));
    expect(screen.getByText('Execute 1?')).toBeInTheDocument();
    view.rerender(<AgentPanel folder={folder('b')} settings={settings} />);
    expect(screen.queryByText('Action for a')).not.toBeInTheDocument();
    expect(screen.queryByText('Execute 1?')).not.toBeInTheDocument();
    await act(async () => { next.resolve([action('b')]); });
    expect(screen.getByText('Action for b')).toBeInTheDocument();
  });

  it('keeps the newest action refresh when repeated reloads complete out of order', async () => {
    const earlier = deferred<AgentAction[]>(); const latest = deferred<AgentAction[]>();
    api.actions.mockResolvedValueOnce([action('a')]).mockReturnValueOnce(earlier.promise).mockReturnValueOnce(latest.promise);
    render(<AgentPanel folder={folder('a')} settings={settings} onRunOnce={api.run} />);
    expect(await screen.findByText('Action for a')).toBeInTheDocument();
    const run = screen.getByRole('button', { name: /run agent cycle/i });
    await act(async () => { fireEvent.click(run); fireEvent.click(run); });
    expect(api.actions).toHaveBeenCalledTimes(3);
    await act(async () => { latest.resolve([action('a', 'Latest action revision')]); });
    await act(async () => { earlier.resolve([action('a', 'Stale action revision')]); });
    expect(screen.getByText('Latest action revision')).toBeInTheDocument();
    expect(screen.queryByText('Stale action revision')).not.toBeInTheDocument();
  });
});
