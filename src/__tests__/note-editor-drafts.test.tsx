import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render as renderView, screen } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { ToastProvider } from '../contexts/ToastContext';
import { NoteEditor } from '../components/Notes/NoteEditor';
import { DraftRecoveryNotice } from '../components/Common/DraftRecoveryNotice';
import { db } from '../db';
import { flushEntityDrafts, getEntityDraft, getFailedDrafts } from '../lib/entity-drafts';
import { hasPendingChanges } from '../lib/pending-changes';
import type { Note } from '../types';

vi.mock('../hooks/useCloudSync', () => ({ useCloudSync: () => ({ hasDestinations: false }) }));
vi.mock('../hooks/useAutoIOCExtraction', () => ({ useAutoIOCExtraction: () => {} }));
vi.mock('../components/Notes/MarkdownPreview', () => ({ MarkdownPreview: () => null }));
vi.mock('../components/Analysis/IOCPanel', () => ({ IOCPanel: () => null }));

let sequence = 0;
const render = (ui: ReactNode) => renderView(ui, { wrapper: ToastProvider });
function note(title = 'Original title', content = 'Original body'): Note {
  return { id: `draft-note-${++sequence}`, title, content, tags: [], pinned: false, archived: false,
    trashed: false, createdAt: 1, updatedAt: 1 };
}
const commonProps = { onTrash: vi.fn(), onRestore: vi.fn(), onTogglePin: vi.fn(), onToggleArchive: vi.fn(),
  allTags: [], folders: [], onCreateTag: vi.fn(), editorMode: 'edit' as const, onEditorModeChange: vi.fn() };
async function persist(id: string, patch: Partial<Note>) {
  const updated = await db.notes.update(id, patch);
  if (!updated) throw new Error('Note no longer exists');
}

beforeEach(async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  await db.notes.clear();
});
afterEach(async () => {
  cleanup();
  // Resolve deliberate failure fixtures so their tokens cannot leak into tests.
  for (const { draft } of getFailedDrafts()) {
    const release = draft.attach(() => {});
    await draft.retry();
    draft.discard(true);
    release();
  }
  await flushEntityDrafts();
  vi.unstubAllGlobals();
});

describe('NoteEditor draft persistence', () => {
  it('retains overlapping title and body edits across navigation and resolves each explicitly', async () => {
    const initial = note('Original title', 'Original body');
    await db.notes.add(initial);
    const view = render(<><NoteEditor {...commonProps} note={initial} onUpdate={persist} /><DraftRecoveryNotice /></>);
    fireEvent.change(screen.getByLabelText('Note title'), { target: { value: 'Local title' } });
    fireEvent.change(screen.getByPlaceholderText('Start writing in markdown...'), { target: { value: 'Local body' } });
    const remote = { ...initial, title: 'Remote title', content: 'Remote body', updatedAt: 2 };
    await db.notes.put(remote);
    view.rerender(<><NoteEditor {...commonProps} note={remote} onUpdate={persist} /><DraftRecoveryNotice /></>);
    const controller = getEntityDraft(`note:${initial.id}`);
    expect(Object.keys(controller.getSnapshot().conflicts ?? {}).sort()).toEqual(['content', 'title']);
    expect(await controller.retry()).toBe(false);
    view.unmount();
    await controller.flush();
    render(<><NoteEditor {...commonProps} note={remote} onUpdate={persist} /><DraftRecoveryNotice /></>);
    expect(screen.getByLabelText('Note title')).toHaveValue('Local title');
    expect(screen.getByPlaceholderText('Start writing in markdown...')).toHaveValue('Local body');
    fireEvent.click(screen.getByRole('button', { name: 'Use remote title' }));
    expect(screen.getByLabelText('Note title')).toHaveValue('Remote title');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Keep my content' })); await controller.flush(); });
    expect(await db.notes.get(initial.id)).toMatchObject({ title: 'Remote title', content: 'Local body' });
    expect(hasPendingChanges()).toBe(false);
  });

  it('keeps a failed draft on cancelled discard and clears it only after confirmation', async () => {
    const initial = note();
    await db.notes.add(initial);
    render(<><NoteEditor {...commonProps} note={initial} onUpdate={async () => { throw new Error('Storage unavailable'); }} /><DraftRecoveryNotice /></>);
    fireEvent.change(screen.getByLabelText('Note title'), { target: { value: 'Unsaved title' } });
    await act(async () => { await flushEntityDrafts(); });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    expect(hasPendingChanges()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    expect(hasPendingChanges()).toBe(false);
    expect(screen.getByLabelText('Note title')).toHaveValue('Original title');
    expect(await db.notes.get(initial.id)).toMatchObject({ title: 'Original title' });
    confirm.mockRestore();
  });

  it('persists rapid title/body edits through view unmount under StrictMode', async () => {
    const initial = note();
    await db.notes.add(initial);
    const { unmount } = render(<StrictMode><NoteEditor {...commonProps} note={initial} onUpdate={persist} /></StrictMode>);
    fireEvent.change(screen.getByLabelText('Note title'), { target: { value: 'Edited title' } });
    fireEvent.change(screen.getByPlaceholderText('Start writing in markdown...'), { target: { value: 'Edited body' } });
    expect(screen.queryByText('Saved', { exact: true })).not.toBeInTheDocument();
    unmount();
    await flushEntityDrafts();
    expect(await db.notes.get(initial.id)).toMatchObject({ title: 'Edited title', content: 'Edited body' });
    expect(hasPendingChanges()).toBe(false);
  });

  it('keeps writes attached to the original note during an immediate selection change', async () => {
    const first = note('First');
    const second = note('Second');
    await db.notes.bulkAdd([first, second]);
    const view = render(<NoteEditor {...commonProps} note={first} onUpdate={persist} />);
    fireEvent.change(screen.getByLabelText('Note title'), { target: { value: 'First edited' } });
    view.rerender(<NoteEditor {...commonProps} note={second} onUpdate={persist} />);
    expect(screen.getByLabelText('Note title')).toHaveValue('Second');
    fireEvent.change(screen.getByPlaceholderText('Start writing in markdown...'), { target: { value: 'Second edited body' } });
    await act(async () => { await flushEntityDrafts(); });
    expect(await db.notes.get(first.id)).toMatchObject({ title: 'First edited', content: 'Original body' });
    expect(await db.notes.get(second.id)).toMatchObject({ title: 'Second', content: 'Second edited body' });
  });

  it('shows Saved only after persistence resolves and retains failed drafts across remount', async () => {
    const initial = note();
    await db.notes.add(initial);
    let reject!: (reason: Error) => void;
    const update = vi.fn().mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; }))
      .mockImplementation(persist);
    const view = render(<NoteEditor {...commonProps} note={initial} onUpdate={update} />);
    fireEvent.change(screen.getByLabelText('Note title'), { target: { value: 'Recoverable title' } });
    const controller = getEntityDraft(`note:${initial.id}`);
    let saving!: Promise<boolean>;
    await act(async () => { saving = controller.flush(); });
    expect(screen.queryByText('Saved', { exact: true })).not.toBeInTheDocument();
    expect(hasPendingChanges()).toBe(true);
    await act(async () => { reject(new Error('Quota exceeded')); await saving; });
    expect(screen.getByRole('alert')).toHaveTextContent('could not be saved');
    expect(controller.getSnapshot().patch.title).toBe('Recoverable title');
    view.unmount();
    // Detaching does not implicitly retry a failed write.
    await act(async () => { await controller.flush(); });
    render(<><NoteEditor {...commonProps} note={initial} onUpdate={update} /><DraftRecoveryNotice /></>);
    expect(screen.getByLabelText('Note title')).toHaveValue('Recoverable title');
    expect(screen.getByRole('button', { name: 'Download draft' })).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Retry save' })[0]); await controller.flush(); });
    expect(await db.notes.get(initial.id)).toMatchObject({ title: 'Recoverable title' });
    expect(screen.getByText('Saved', { exact: true })).toBeInTheDocument();
    expect(hasPendingChanges()).toBe(false);
  });

  it('preserves a dirty title when a remote body update arrives during debounce', async () => {
    const initial = note();
    await db.notes.add(initial);
    const view = render(<NoteEditor {...commonProps} note={initial} onUpdate={persist} />);
    fireEvent.change(screen.getByLabelText('Note title'), { target: { value: 'Local title' } });
    await db.notes.update(initial.id, { content: 'Remote body' });
    view.rerender(<NoteEditor {...commonProps} note={{ ...initial, content: 'Remote body' }} onUpdate={persist} />);
    expect(screen.getByPlaceholderText('Start writing in markdown...')).toHaveValue('Remote body');
    await act(async () => { await flushEntityDrafts(); });
    expect(await db.notes.get(initial.id)).toMatchObject({ title: 'Local title', content: 'Remote body' });
  });
});
