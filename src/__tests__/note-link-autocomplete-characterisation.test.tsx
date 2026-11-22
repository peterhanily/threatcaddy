import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render as renderView, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ToastProvider } from '../contexts/ToastContext';
import { NoteEditor } from '../components/Notes/NoteEditor';
import { db } from '../db';
import { flushEntityDrafts } from '../lib/entity-drafts';
import type { Note } from '../types';

vi.mock('../hooks/useCloudSync', () => ({ useCloudSync: () => ({ hasDestinations: false }) }));
vi.mock('../hooks/useAutoIOCExtraction', () => ({ useAutoIOCExtraction: () => {} }));
vi.mock('../components/Notes/MarkdownPreview', () => ({ MarkdownPreview: () => null }));
vi.mock('../components/Analysis/IOCPanel', () => ({ IOCPanel: () => null }));

/**
 * Characterisation of the `[[` note-link autocomplete before Identities. The planned
 * `@` identity autocomplete follows this pattern, so it must keep working unchanged.
 */
const render = (ui: ReactNode) => renderView(ui, { wrapper: ToastProvider });
/** Trigger detection runs on a zero-delay timer after each change. */
const type = async (el: HTMLElement, value: string) => {
  fireEvent.change(el, { target: { value } });
  await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
};
const note = (id: string, title: string, extra: Partial<Note> = {}): Note =>
  ({ id, title, content: '', tags: [], pinned: false, archived: false, trashed: false, createdAt: 1, updatedAt: 1, ...extra });
const props = { onTrash: vi.fn(), onRestore: vi.fn(), onTogglePin: vi.fn(), onToggleArchive: vi.fn(), allTags: [], folders: [],
  onCreateTag: vi.fn(), editorMode: 'edit' as const, onEditorModeChange: vi.fn(), onUpdate: vi.fn() };
// 'A lure kit' contains the query mid-title and sorts first alphabetically, so prefix-first ordering is visible.
const others = [note('n-kit', 'A lure kit'), note('n-lure', 'Lure analysis'), note('n-triage', 'Initial triage: payroll diversion'),
  note('n-old', 'Lure draft (deleted)', { trashed: true })];

const originalScroll = Element.prototype.scrollIntoView;
beforeEach(async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = () => {}; // jsdom has no layout
  await db.notes.clear();
});
afterEach(async () => { cleanup(); await flushEntityDrafts(); vi.unstubAllGlobals(); Element.prototype.scrollIntoView = originalScroll; });

describe('[[ note links today', () => {
  it('offers matching notes, prefix matches first, without trashed notes or the note itself, and inserts [[Title]]', async () => {
    const current = note('n-current', 'Lunch call with Dana'); // matches the query, but is the note being edited
    render(<NoteEditor {...props} note={current} allNotes={[current, ...others]} />);
    const body = screen.getByPlaceholderText('Start writing in markdown...');
    await type(body, 'See [[lu');
    // The suggestions are a listbox of options tied to the editor (aria-controls, aria-activedescendant).
    const listbox = screen.getByRole('listbox', { name: 'Link to note' });
    const options = within(listbox).getAllByRole('option');
    expect(listbox).toHaveAttribute('id', body.getAttribute('aria-controls'));
    expect(body).toHaveAttribute('aria-activedescendant', options[0].id);
    expect(options.map((b) => b.textContent?.trim())).toEqual(['Lure analysis', 'A lure kit']);
    fireEvent.mouseDown(options[0]); // suggestions are chosen on mousedown so the textarea keeps focus
    expect(body).toHaveValue('See [[Lure analysis]]');
  });

  it('does not open inside inline code or after the link is closed', async () => {
    const current = note('n-current', 'Phone call with Dana');
    render(<NoteEditor {...props} note={current} allNotes={[current, ...others]} />);
    const body = screen.getByPlaceholderText('Start writing in markdown...');
    await type(body, 'See [[lu');
    expect(screen.getByRole('option', { name: /Lure analysis/ })).toBeInTheDocument();
    await type(body, 'Run `[[lu');
    expect(screen.queryByRole('option', { name: /Lure analysis/ })).toBeNull();
    await type(body, 'See [[Lure analysis]] then');
    expect(screen.queryByRole('option', { name: /Lure analysis/ })).toBeNull();
  });
});
