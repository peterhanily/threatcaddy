import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode, useLayoutEffect, type ReactNode } from 'react';
import WhiteboardEditor from '../components/Whiteboard/WhiteboardEditor';
import { ToastProvider } from '../contexts/ToastContext';
import { db } from '../db';
import { flushEntityDrafts, getEntityDraft, getFailedDrafts } from '../lib/entity-drafts';
import { hasPendingChanges } from '../lib/pending-changes';
import type { Whiteboard } from '../types';

const scene = vi.hoisted(() => ({ emitOnRender: false, renders: 0, initialData: {} as Record<string, unknown>, change: undefined as undefined | ((elements: readonly unknown[], state: Record<string, unknown>, files?: Record<string, unknown>) => void) }));
vi.mock('@excalidraw/excalidraw', () => {
  const Menu = Object.assign(({ children }: { children?: ReactNode }) => <>{children}</>, {
    DefaultItems: { ClearCanvas: () => null, ChangeCanvasBackground: () => null, ToggleTheme: () => null, Help: () => null },
    Separator: () => null,
  });
  return { MainMenu: Menu, exportToBlob: vi.fn(), Excalidraw: ({ children, onChange, initialData }: { children?: ReactNode; onChange: typeof scene.change; initialData: Record<string, unknown> }) => {
    scene.change = onChange;
    scene.initialData = initialData;
    useLayoutEffect(() => {
      scene.renders++;
      if (scene.emitOnRender) onChange?.([], { zoom: { value: 1 }, scrollX: 0, scrollY: 0, theme: 'dark' }, {});
    });
    return <div>{children}</div>;
  } };
});

let sequence = 0;
function whiteboard(): Whiteboard {
  return { id: `draft-whiteboard-${++sequence}`, name: 'Original board', elements: '[]', tags: [],
    order: 0, trashed: false, archived: false, createdAt: 1, updatedAt: 1 };
}
const commonProps = { allTags: [], folders: [], onCreateTag: vi.fn(), onBack: vi.fn() };
async function persist(id: string, patch: Partial<Whiteboard>) {
  const updated = await db.whiteboards.update(id, patch);
  if (!updated) throw new Error('Whiteboard no longer exists');
}

beforeEach(async () => { scene.emitOnRender = false; scene.renders = 0; await db.whiteboards.clear(); });
afterEach(async () => {
  cleanup();
  for (const { draft } of getFailedDrafts()) {
    const release = draft.attach(() => {});
    await draft.retry();
    release();
  }
  await flushEntityDrafts();
});

describe('WhiteboardEditor draft persistence', () => {
  it('does not republish identical render notifications or transient selection changes', async () => {
    const initial = whiteboard();
    await db.whiteboards.add(initial);
    scene.emitOnRender = true;
    const update = vi.fn(persist);
    render(<WhiteboardEditor {...commonProps} whiteboard={initial} onUpdate={update} />, { wrapper: ToastProvider });
    const controller = getEntityDraft(`whiteboard:${initial.id}`);
    await act(async () => { await controller.flush(); });
    expect(update).toHaveBeenCalledTimes(1);
    expect(scene.renders).toBeLessThan(10);
    act(() => { scene.change?.([], { zoom: { value: 1 }, scrollX: 0, scrollY: 0, theme: 'dark', selectedElementIds: { one: true } }, {}); });
    await act(async () => { await controller.flush(); });
    expect(update).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().status).toBe('saved');
  });
  it('round-trips image bytes with the scene on immediate navigation', async () => {
    const initial = whiteboard();
    const files = { 'image-one': { id: 'image-one', mimeType: 'image/png', dataURL: 'data:image/png;base64,aGVsbG8=', created: 1 } };
    await db.whiteboards.add(initial);
    const view = render(<WhiteboardEditor {...commonProps} whiteboard={initial} onUpdate={persist} />, { wrapper: ToastProvider });
    act(() => { scene.change?.([{ id: 'image-shape', type: 'image', fileId: 'image-one' }], {}, files); });
    view.unmount();
    await flushEntityDrafts();
    const saved = (await db.whiteboards.get(initial.id))!;
    expect(JSON.parse(saved.files!)).toEqual(files);
    render(<WhiteboardEditor {...commonProps} whiteboard={saved} onUpdate={persist} />, { wrapper: ToastProvider });
    expect(scene.initialData.files).toEqual(files);
  });
  it('flushes both the name and latest scene on immediate unmount', async () => {
    const initial = whiteboard();
    await db.whiteboards.add(initial);
    const view = render(<StrictMode><WhiteboardEditor {...commonProps} whiteboard={initial} onUpdate={persist} /></StrictMode>, { wrapper: ToastProvider });
    fireEvent.change(screen.getByPlaceholderText('Whiteboard name'), { target: { value: 'Edited board' } });
    act(() => { scene.change?.([{ id: 'shape-one', type: 'rectangle' }], { zoom: { value: 1.5 }, scrollX: 20, scrollY: 30, selectedElementIds: { 'shape-one': true } }); });
    view.unmount();
    await flushEntityDrafts();
    expect(await db.whiteboards.get(initial.id)).toMatchObject({
      name: 'Edited board', elements: JSON.stringify([{ id: 'shape-one', type: 'rectangle' }]),
      appState: JSON.stringify({ zoom: { value: 1.5 }, scrollX: 20, scrollY: 30 }),
    });
    expect(hasPendingChanges()).toBe(false);
  });

  it('does not claim a failed name save succeeded and lets the user retry', async () => {
    const initial = whiteboard();
    await db.whiteboards.add(initial);
    const update = vi.fn().mockRejectedValueOnce(new Error('Storage unavailable')).mockImplementation(persist);
    render(<WhiteboardEditor {...commonProps} whiteboard={initial} onUpdate={update} />, { wrapper: ToastProvider });
    fireEvent.change(screen.getByPlaceholderText('Whiteboard name'), { target: { value: 'Recoverable board' } });
    const controller = getEntityDraft(`whiteboard:${initial.id}`);
    await act(async () => { await controller.flush(); });
    expect(screen.queryByText('Saved', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('could not be saved');
    expect(hasPendingChanges()).toBe(true);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry save' })); await controller.flush(); });
    expect(await db.whiteboards.get(initial.id)).toMatchObject({ name: 'Recoverable board' });
    expect(screen.getByText('Saved', { exact: true })).toBeInTheDocument();
    expect(hasPendingChanges()).toBe(false);
  });
});
