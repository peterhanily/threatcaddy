import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConflictDialog } from '../components/Common/ConflictDialog';
import type { SyncResult } from '../lib/server-api';

const note: SyncResult = { table: 'notes', entityId: 'shared-id', status: 'conflict', serverVersion: 4,
  localData: { title: 'Local note', content: 'Analyst note text' }, serverData: { id: 'shared-id', title: 'Remote note', content: 'Team note text' } };
const task: SyncResult = { table: 'tasks', entityId: 'shared-id', status: 'conflict', serverVersion: 8,
  localData: { title: 'Local task', description: 'Analyst task text' }, serverData: { id: 'shared-id', title: 'Remote task', description: 'Team task text' } };
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

  it('explains a change the server refused as invalid instead of blaming permissions', () => {
    const invalid: SyncResult = { ...task, status: 'rejected', reason: 'Evidence image MIME type must be image/png, image/jpeg, image/gif or image/webp' };
    render(<ConflictDialog conflicts={[invalid]} onResolve={vi.fn()} onResolveAll={vi.fn()} onClose={vi.fn()} />);
    expect(row('Task: Local task').getByText(/refused this change as invalid \(Evidence image MIME type must be image\/png/)).toBeVisible();
    expect(screen.queryByText(/permissions/)).toBeNull();
    expect(row('Task: Local task').queryByRole('button')).toBeNull();
  });

  it('offers only Mine when this device cannot read the server version', async () => {
    const unreadable: SyncResult = { table: 'standaloneIOCs', entityId: 'i1', status: 'conflict', serverVersion: 3,
      localData: { id: 'i1', type: 'domain', value: 'mine.test' }, serverData: { id: 'i1', type: 'ip', value: '198.51.100.1', version: 3 } };
    const all = vi.fn();
    render(<ConflictDialog conflicts={[unreadable, note]} onResolve={vi.fn()} onResolveAll={all} onClose={vi.fn()} />);
    expect(row('IOC: i1').queryByRole('button', { name: 'Theirs' })).toBeNull();
    expect(row('IOC: i1').getByRole('button', { name: 'Mine' })).toBeEnabled();
    expect(row('IOC: i1').getByText(/cannot read the team server's version/)).toBeVisible();
    expect(row('Note: Local note').getByRole('button', { name: 'Theirs' })).toBeEnabled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'All Theirs' })); });
    expect(all).toHaveBeenCalledExactlyOnceWith('theirs');
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

  it('does not show fields that stay on this device as changes', () => {
    const local: SyncResult = { table: 'tasks', entityId: 't1', status: 'conflict', serverVersion: 4,
      localData: { title: 'Mine task', checklist: [{ id: 'c', text: 'Collect logs', done: true }], escalated: true }, serverData: { id: 't1', title: 'Theirs task', escalated: null } };
    const folder: SyncResult = { table: 'folders', entityId: 'f1', status: 'conflict', serverVersion: 2,
      localData: { name: 'Case', description: 'local text', agentEnabled: false }, serverData: { id: 'f1', name: 'Case', description: 'remote text', agentEnabled: true } };
    render(<ConflictDialog conflicts={[local, folder]} onResolve={vi.fn()} onResolveAll={vi.fn()} onClose={vi.fn()} />);
    for (const button of screen.getAllByRole('button', { name: 'Diff' })) fireEvent.click(button);
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/Mine.*Theirs/);
    expect(text).toContain('remote');
    expect(text).not.toMatch(/Collect logs|Checklist|Escalated|Agent Enabled/);
  });
});
