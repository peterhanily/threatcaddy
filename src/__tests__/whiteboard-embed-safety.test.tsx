import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import WhiteboardEditor from '../components/Whiteboard/WhiteboardEditor';
import { ToastProvider } from '../contexts/ToastContext';
import { db } from '../db';
import { flushEntityDrafts } from '../lib/entity-drafts';
import type { Whiteboard } from '../types';

type Change = (elements: readonly unknown[], state: Record<string, unknown>, files?: Record<string, unknown>) => void;
type Paste = (data: { elements?: readonly unknown[] }, event: ClipboardEvent | null) => boolean | Promise<boolean>;
const scene = vi.hoisted(() => ({
  initialData: {} as Record<string, unknown>,
  change: undefined as Change | undefined,
  paste: undefined as Paste | undefined,
  updateScene: vi.fn(),
}));
vi.mock('@excalidraw/excalidraw', () => {
  const Menu = Object.assign(({ children }: { children?: ReactNode }) => <>{children}</>, {
    DefaultItems: { ClearCanvas: () => null, ChangeCanvasBackground: () => null, ToggleTheme: () => null, Help: () => null },
    Separator: () => null,
  });
  return { MainMenu: Menu, exportToBlob: vi.fn(), Excalidraw: ({ children, onChange, onPaste, initialData, excalidrawAPI }: {
    children?: ReactNode; onChange: Change; onPaste?: Paste; initialData: Record<string, unknown>; excalidrawAPI: (api: unknown) => void;
  }) => {
    scene.change = onChange;
    scene.paste = onPaste;
    scene.initialData = initialData;
    excalidrawAPI({ updateScene: scene.updateScene });
    return <div>{children}</div>;
  } };
});

// Excalidraw renders customData.generationData.html as an allow-scripts srcdoc.
const hostileFrame = { id: 'hostile', type: 'iframe', x: 0, y: 0, width: 400, height: 300, isDeleted: false,
  customData: { generationData: { status: 'done', html: '<script>parent.postMessage("pwned", "*")</script><form>Re-enter your API key</form>' } } };
const rectangle = { id: 'shape', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, isDeleted: false };
const videoEmbed = { id: 'video', type: 'embeddable', x: 0, y: 0, width: 560, height: 315, isDeleted: false, link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' };
const ids = (elements: unknown) => (elements as Array<{ id: string }>).map(element => element.id);

function whiteboard(elements: unknown[]): Whiteboard {
  return { id: `embed-board-${crypto.randomUUID()}`, name: 'Shared board', elements: JSON.stringify(elements), tags: [],
    order: 0, trashed: false, archived: false, createdAt: 1, updatedAt: 1 };
}
const props = { allTags: [], folders: [], onCreateTag: vi.fn(), onBack: vi.fn() };
async function persist(id: string, patch: Partial<Whiteboard>) {
  await db.whiteboards.update(id, patch);
}

beforeEach(async () => { scene.updateScene.mockClear(); await db.whiteboards.clear(); });
afterEach(async () => { cleanup(); await flushEntityDrafts(); });

describe('WhiteboardEditor scriptable embeds', () => {
  it('never hands a stored iframe element to the canvas, whatever delivered it', async () => {
    const board = whiteboard([rectangle, hostileFrame, videoEmbed]);
    await db.whiteboards.add(board);
    render(<WhiteboardEditor {...props} whiteboard={board} onUpdate={persist} />, { wrapper: ToastProvider });
    expect(ids(scene.initialData.elements)).toEqual(['shape', 'video']);
  });

  it('rejects a pasted scene that carries an iframe element', async () => {
    const board = whiteboard([]);
    render(<WhiteboardEditor {...props} whiteboard={board} onUpdate={persist} />, { wrapper: ToastProvider });
    expect(scene.paste).toBeTypeOf('function');
    expect(await scene.paste?.({ elements: [rectangle, hostileFrame] }, null)).toBe(false);
    expect(await scene.paste?.({ elements: [rectangle] }, null)).toBe(true);
    expect(await scene.paste?.({}, null)).toBe(true);
  });

  it('removes an iframe element that reaches the canvas another way and never saves it', async () => {
    const board = whiteboard([rectangle]);
    await db.whiteboards.add(board);
    const update = vi.fn(persist);
    render(<WhiteboardEditor {...props} whiteboard={board} onUpdate={update} />, { wrapper: ToastProvider });
    act(() => { scene.change?.([rectangle, hostileFrame], { zoom: { value: 1 }, scrollX: 0, scrollY: 0, theme: 'dark' }, {}); });
    expect(scene.updateScene).toHaveBeenCalledTimes(1);
    expect(ids(scene.updateScene.mock.calls[0][0].elements)).toEqual(['shape']);
    await act(async () => { await flushEntityDrafts(); });
    const saved = await db.whiteboards.get(board.id);
    expect(ids(JSON.parse(saved?.elements ?? 'null'))).toEqual(['shape']);
  });
});
