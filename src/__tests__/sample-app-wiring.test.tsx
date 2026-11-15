import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../App';
import { db } from '../db';
import type { Note } from '../types';
import { getSampleFolderId, loadSampleInvestigation } from '../lib/sample-investigation-store';

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

  it('names what the user added from Settings and keeps it when asked', async () => {
    await loadSampleInvestigation('realistic');
    await db.notes.add(userNote);
    render(<App />);
    await openSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Sample Investigation' }));
    let dialog = await removalDialog();
    expect(dialog).toHaveTextContent('(1 in total)');
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
    expect(await db.notes.count()).toBe(1);
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
