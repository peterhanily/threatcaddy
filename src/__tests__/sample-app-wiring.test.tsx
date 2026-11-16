import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../App';
import { DataImportModal } from '../components/Import/DataImportModal';
import { db } from '../db';
import type { Note } from '../types';
import { getSampleFolderId, loadSampleInvestigation } from '../lib/sample-investigation-store';
import { createClipRevision } from '../lib/clip-protocol';
import { getActiveWorkspaceId } from '../lib/workspace-profiles';

// The whole App, so a change to its wiring cannot bypass the confirmation.
const REALISTIC = getSampleFolderId('realistic');
const PARODY = getSampleFolderId('parody');
const REMOVE_TITLE = 'Remove sample investigation?';
const userNote: Note = { id: 'u-note', title: 'My report', content: '', tags: [], pinned: false, archived: false,
  trashed: false, createdAt: 1, updatedAt: 1, folderId: REALISTIC };

const removalDialog = () => screen.findByRole('dialog', { name: REMOVE_TITLE });
async function openSettings() {
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
  await screen.findByText('Sample Data');
}

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
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('every sample removal entry point asks first', () => {
  it('keeps every row when Delete Demo & Start Fresh is cancelled', async () => {
    window.history.replaceState({}, '', '/?demo');
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Demo & Start Fresh' }));
    fireEvent.click(within(await removalDialog()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: REMOVE_TITLE })).toBeNull());
    expect(await db.folders.get(REALISTIC)).toBeDefined();
    expect(await db.notes.count()).toBe(6);
  });

  it('removes the demo from the welcome modal only after the confirmation', async () => {
    window.history.replaceState({}, '', '/?demo');
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Demo & Start Fresh' }));
    const dialog = await removalDialog();
    expect(await db.folders.get(REALISTIC)).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove sample' }));
    await waitFor(async () => expect(await db.folders.get(REALISTIC)).toBeUndefined());
    expect(await db.notes.count()).toBe(0);
  });

  it('names what the user added or rewrote from Settings and keeps it when asked', async () => {
    await loadSampleInvestigation('realistic');
    await db.notes.add(userNote);
    // The guide asks the user to rewrite the seeded draft report.
    await db.notes.update('sample-realistic-note-6', { content: 'My reviewed assessment', updatedAt: Date.now() });
    render(<App />);
    await openSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Sample Investigation' }));
    let dialog = await removalDialog();
    expect(dialog).toHaveTextContent('(2 in total)');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: REMOVE_TITLE })).toBeNull());
    expect(await db.notes.count()).toBe(7);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Sample Investigation' }));
    dialog = await removalDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep my items' }));
    await waitFor(async () => expect(await db.folders.get(REALISTIC)).toBeUndefined());
    const [kept] = await db.folders.toArray();
    expect(kept).toMatchObject({ name: 'My work from Mailbox Compromise — Synthetic Exercise', localOnly: true });
    expect((await db.notes.get('u-note'))?.folderId).toBe(kept.id);
    expect(await db.notes.get('sample-realistic-note-6')).toMatchObject({ folderId: kept.id, content: 'My reviewed assessment' });
    expect(await db.notes.count()).toBe(2);
  });

  it('shows the removed case as gone when a cleanup step after the cascade fails', async () => {
    await loadSampleInvestigation('realistic');
    const fail = () => { throw new Error('Simulated disk failure'); };
    db.timelines.hook('deleting', fail);
    try {
      render(<App />);
      await openSettings();
      fireEvent.click(screen.getByRole('button', { name: 'Remove Sample Investigation' }));
      fireEvent.click(within(await removalDialog()).getByRole('button', { name: 'Remove sample' }));
      expect(await screen.findByText('Simulated disk failure')).toBeInTheDocument();
      expect(await db.folders.get(REALISTIC)).toBeUndefined();
      expect(await screen.findByRole('button', { name: 'Load Sample Investigation' })).toBeInTheDocument();
    } finally { db.timelines.hook('deleting').unsubscribe(fail); }
  });

  it('asks before the parody Remove button deletes the parody', async () => {
    await loadSampleInvestigation('parody');
    render(<App />);
    await openSettings();
    fireEvent.click(screen.getByRole('button', { name: /^Remove Sample Investigation — Parody/ }));
    const dialog = await removalDialog();
    expect(await db.folders.get(PARODY)).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove sample' }));
    await waitFor(async () => expect(await db.folders.get(PARODY)).toBeUndefined());
  });
});

describe('a ?demo link in a workspace with the user’s own investigations', () => {
  beforeEach(async () => {
    await db.folders.add({ id: 'real', name: 'Real case', order: 0, status: 'active', createdAt: 1 });
    window.history.replaceState({}, '', '/?demo');
  });

  it('writes nothing when the load prompt is cancelled', async () => {
    render(<App />);
    const prompt = await screen.findByRole('dialog', { name: 'Load the sample investigation?' });
    expect(window.location.search).toBe('');
    fireEvent.click(within(prompt).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Load the sample investigation?' })).toBeNull());
    expect(await db.folders.toArray()).toEqual([expect.objectContaining({ id: 'real' })]);
    expect(await db.notes.count()).toBe(0);
    expect(await db.timelines.count()).toBe(0);
  });

  it('loads the demo once the prompt is confirmed', async () => {
    render(<App />);
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Load the sample investigation?' }))
      .getByRole('button', { name: 'Load the demo' }));
    expect(await screen.findByRole('button', { name: 'Delete Demo & Start Fresh' })).toBeInTheDocument();
    expect(await db.folders.get(REALISTIC)).toBeDefined();
  });
});

describe('a demo timeline is never the default for real events', () => {
  // Builds before this fix wrote the realistic demo timeline first in the order.
  beforeEach(async () => {
    await loadSampleInvestigation('realistic');
    await db.timelines.update('sample-realistic-timeline-1', { order: 0 });
    await db.timelines.add({ id: 'mine', name: 'Mine', order: 1, createdAt: 1, updatedAt: 1 });
  });

  it('files a new event under the user’s timeline', async () => {
    render(<App />);
    fireEvent.click((await screen.findAllByRole('button', { name: /^Timeline/ }))[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'New event' }));
    fireEvent.change(await screen.findByLabelText(/^Title/), { target: { value: 'Real event' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));
    await waitFor(async () => expect(await db.timelineEvents.filter(event => event.title === 'Real event').count()).toBe(1));
    const [event] = await db.timelineEvents.filter(event => event.title === 'Real event').toArray();
    expect(event.timelineId).toBe('mine');
  });

  it('files an event created inside the demo case under the demo case’s timeline', async () => {
    render(<App />);
    fireEvent.click((await screen.findAllByRole('button', { name: /^Investigations/ }))[0]);
    fireEvent.click(await screen.findByRole('group', { name: 'Mailbox Compromise — Synthetic Exercise' }));
    fireEvent.click((await screen.findAllByRole('button', { name: /^Timeline/ }))[0]);
    // With no timeline selected, the case's own timeline still applies.
    fireEvent.click(await screen.findByRole('button', { name: /^All Events/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'New event' }));
    fireEvent.change(await screen.findByLabelText(/^Title/), { target: { value: 'Exercise event' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));
    await waitFor(async () => expect(await db.timelineEvents.filter(event => event.title === 'Exercise event').count()).toBe(1));
    const [event] = await db.timelineEvents.filter(event => event.title === 'Exercise event').toArray();
    expect(event).toMatchObject({ folderId: REALISTIC, timelineId: 'sample-realistic-timeline-1' });
  });

  it('files a clipped event under the user’s timeline', async () => {
    render(<App />);
    await screen.findByRole('button', { name: 'Settings' });
    const clip = await createClipRevision({ id: 'clip-event', revision: 1, title: 'Clipped event', content: 'Fictional clip',
      sourceUrl: 'https://example.com/a', sourceTitle: 'Example', entityType: 'timeline-event', folderName: 'Clips case',
      clsLevel: '', createdAt: 1 });
    window.dispatchEvent(new MessageEvent('message', { source: window, origin: window.location.origin, data: {
      type: 'THREATCADDY_IMPORT_CLIPS', protocol: 2, sourceId: 'test-source', attemptId: 'attempt-1',
      expectedWorkspaceId: getActiveWorkspaceId(), clips: [clip] } }));
    await waitFor(async () => expect(await db.timelineEvents.filter(event => event.title === 'Clipped event').count()).toBe(1));
    const [event] = await db.timelineEvents.filter(event => event.title === 'Clipped event').toArray();
    expect(event.timelineId).toBe('mine');
  });

  it('gives imported rows a new timeline when the demo timeline is the only one', async () => {
    await db.timelines.delete('mine');
    const demo = await db.timelines.get('sample-realistic-timeline-1');
    if (!demo) throw new Error('Expected the demo timeline');
    const onCreateTimeline = vi.fn(async (name: string) => ({ id: 'created', name, order: 1, createdAt: 1, updatedAt: 1 }));
    render(<DataImportModal open onClose={() => {}} folders={[]} timelines={[demo]} onCreateTimeline={onCreateTimeline}
      onImportComplete={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/^Paste CSV/), { target: { value: 'timestamp,message\n2026-01-01T00:00:00Z,Imported row' } });
    fireEvent.click(screen.getByRole('button', { name: /Parse & Preview/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^Import 1 rows/ }));
    await screen.findByText('Import Complete');
    expect(onCreateTimeline).toHaveBeenCalledExactlyOnceWith('Data Import');
    expect((await db.timelineEvents.filter(event => event.timelineId === 'created').toArray())).toHaveLength(1);
  });
});
