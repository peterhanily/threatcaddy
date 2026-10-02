import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConflictDialog } from '../components/Common/ConflictDialog';
import type { SyncResult } from '../lib/server-api';

const note: SyncResult = { table: 'notes', entityId: 'shared-id', status: 'conflict', serverVersion: 4,
  localData: { title: 'Local note', content: 'Analyst note text' }, serverData: { title: 'Remote note', content: 'Team note text' } };
const task: SyncResult = { table: 'tasks', entityId: 'shared-id', status: 'conflict', serverVersion: 8,
  localData: { title: 'Local task', description: 'Analyst task text' }, serverData: { title: 'Remote task', description: 'Team task text' } };
const row = (name: string) => within(screen.getByText(name).parentElement!.parentElement!);

describe('ConflictDialog real diff and resolution contracts', () => {
  it('keeps equal entity IDs separate by table and displays each actual local/remote diff', async () => {
    const resolve = vi.fn();
    render(<ConflictDialog conflicts={[note, task]} onResolve={resolve} onResolveAll={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(row('Note: Local note').getByRole('button', { name: 'Diff' }));
    expect(row('Note: Local note').getByText('Analyst note text')).toBeVisible();
    expect(row('Note: Local note').getByText('Team note text')).toBeVisible();
    expect(row('Task: Local task').queryByText('Team task text')).toBeNull();
    fireEvent.click(row('Task: Local task').getByRole('button', { name: 'Diff' }));
    expect(row('Task: Local task').getByText('Analyst task text')).toBeVisible();
    expect(row('Task: Local task').getByText('Team task text')).toBeVisible();
    expect(row('Note: Local note').queryByText('Team note text')).toBeNull();
    await act(async () => { fireEvent.click(row('Task: Local task').getByRole('button', { name: 'Mine' })); });
    expect(resolve).toHaveBeenCalledExactlyOnceWith('shared-id', 'mine', 'tasks');
  });

  it('keeps conflicts visible and disabled while saving, then retains the error and supports retry', async () => {
    let reject!: (reason: Error) => void;
    const resolve = vi.fn().mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; })).mockResolvedValue(undefined);
    const close = vi.fn();
    render(<ConflictDialog conflicts={[note, task]} onResolve={resolve} onResolveAll={vi.fn()} onClose={close} />);
    fireEvent.click(row('Note: Local note').getByRole('button', { name: 'Theirs' }));
    expect(screen.getByRole('region', { name: 'Sync conflicts' })).toBeVisible();
    for (const button of screen.getAllByRole('button', { name: /^(Mine|Theirs|All Mine|All Theirs|Diff|Dismiss conflict notice)$/ })) expect(button).toBeDisabled();
    await act(async () => { reject(new Error('Storage transaction failed; draft retained')); });
    expect(screen.getByRole('alert')).toHaveTextContent('Storage transaction failed; draft retained');
    expect(screen.getByText('Note: Local note')).toBeVisible();
    expect(screen.getByText('Task: Local task')).toBeVisible();
    expect(close).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(row('Note: Local note').getByRole('button', { name: 'Theirs' })); });
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('never offers rejected changes as resolvable conflicts', async () => {
    const rejected: SyncResult = { ...task, status: 'rejected' };
    const resolve = vi.fn(); const all = vi.fn();
    render(<ConflictDialog conflicts={[note, rejected]} onResolve={resolve} onResolveAll={all} onClose={vi.fn()} />);
    expect(row('Task: Local task').getByText(/remains saved locally/)).toBeVisible();
    expect(row('Task: Local task').queryByRole('button')).toBeNull();
    expect(screen.queryByRole('button', { name: 'All Mine' })).toBeNull();
    await act(async () => { fireEvent.click(row('Note: Local note').getByRole('button', { name: 'Mine' })); });
    expect(resolve).toHaveBeenCalledExactlyOnceWith('shared-id', 'mine', 'notes');
    expect(all).not.toHaveBeenCalled();
  });

  it('awaits and reports failed bulk resolution without silently dismissing any item', async () => {
    const all = vi.fn().mockRejectedValue(new Error('Bulk resolution rolled back'));
    render(<ConflictDialog conflicts={[note, task]} onResolve={vi.fn()} onResolveAll={all} onClose={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'All Theirs' })); });
    expect(all).toHaveBeenCalledExactlyOnceWith('theirs');
    expect(screen.getByRole('alert')).toHaveTextContent('Bulk resolution rolled back');
    expect(screen.getAllByRole('button', { name: 'Mine' })).toHaveLength(2);
  });

  it('offers distinct long local/remote content with bounded readable previews instead of omitting the diff', () => {
    const local = 'Local evidence '.repeat(2000) + 'LOCAL TAIL';
    const remote = 'Remote evidence '.repeat(2000) + 'REMOTE TAIL';
    const conflict = { ...note, localData: { title: 'Same title', content: local }, serverData: { title: 'Same title', content: remote } };
    render(<ConflictDialog conflicts={[conflict]} onResolve={vi.fn()} onResolveAll={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Diff' }));
    const comparison = screen.getByRole('region', { name: 'content comparison' });
    const values = comparison.querySelectorAll('pre');
    expect(values[0].textContent).toBe(local.slice(0, 20_000));
    expect(values[1].textContent).toBe(remote.slice(0, 20_000));
    expect(comparison).toHaveTextContent('Preview limited');
    expect(comparison).not.toHaveTextContent('LOCAL TAIL');
    expect(comparison).not.toHaveTextContent('REMOTE TAIL');
    expect(screen.getByRole('button', { name: 'Download complete comparison (unencrypted JSON)' })).toBeEnabled();
  });
});
