import type { ComponentProps } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WhiteboardView } from '../components/Whiteboard/WhiteboardView';
import { ScreenshareContext } from '../hooks/ScreenshareContext';
import { DEFAULT_CLS_LEVELS, type Whiteboard } from '../types';

vi.mock('../components/Whiteboard/WhiteboardEditor', () => ({
  default: ({ whiteboard }: { whiteboard: Whiteboard }) => <div data-testid="whiteboard-editor">{whiteboard.name}</div>,
}));
vi.mock('../components/Whiteboard/WhiteboardList', () => ({
  WhiteboardList: ({ whiteboards }: { whiteboards: Whiteboard[] }) => <div data-testid="whiteboard-list">{whiteboards.map(board => board.name).join(', ')}</div>,
}));

const board: Whiteboard = {
  id: 'selected', name: 'Fictional restricted whiteboard', elements: '[]', clsLevel: 'TLP:RED',
  tags: [], order: 0, trashed: false, archived: false, createdAt: 0, updatedAt: 0,
};
function props(): ComponentProps<typeof WhiteboardView> {
  return {
    whiteboards: [board], folders: [], allTags: [], selectedWhiteboardId: board.id,
    onCreateWhiteboard: vi.fn().mockResolvedValue(board), onUpdateWhiteboard: vi.fn(),
    onDeleteWhiteboard: vi.fn(), onCreateTag: vi.fn().mockResolvedValue({ id: 'tag', name: 'Tag', color: 'gray' }),
    onWhiteboardSelect: vi.fn(),
  };
}
const view = (properties: ComponentProps<typeof WhiteboardView>, maxLevel: string | null) => (
  <ScreenshareContext.Provider value={{ maxLevel, effectiveLevels: DEFAULT_CLS_LEVELS }}>
    <WhiteboardView {...properties} />
  </ScreenshareContext.Provider>
);

describe('whiteboard selection across privacy filtering', () => {
  it('waits for hydration before deciding whether the selected board still exists', async () => {
    const properties = props();
    const { rerender } = render(view({ ...properties, whiteboards: [], loading: true }, null));
    expect(properties.onWhiteboardSelect).not.toHaveBeenCalled();
    rerender(view({ ...properties, loading: false }, null));
    expect(await screen.findByTestId('whiteboard-editor')).toHaveTextContent(board.name);
    expect(properties.onWhiteboardSelect).not.toHaveBeenCalled();
    rerender(view({ ...properties, whiteboards: [], loading: false }, null));
    expect(properties.onWhiteboardSelect).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('hides a restricted board without clearing its selection, then restores the editor', async () => {
    const properties = props();
    const { rerender } = render(view(properties, null));
    expect(await screen.findByTestId('whiteboard-editor')).toHaveTextContent(board.name);

    rerender(view({ ...properties, whiteboards: [] }, 'TLP:CLEAR'));
    expect(screen.queryByText(board.name)).not.toBeInTheDocument();
    expect(screen.getByTestId('whiteboard-list')).toBeEmptyDOMElement();
    expect(properties.onWhiteboardSelect).not.toHaveBeenCalled();

    rerender(view(properties, null));
    expect(await screen.findByTestId('whiteboard-editor')).toHaveTextContent(board.name);
    expect(properties.onWhiteboardSelect).not.toHaveBeenCalled();
  });

  it('still clears a deleted selection when screenshare is off', () => {
    const properties = props();
    render(view({ ...properties, whiteboards: [] }, null));
    expect(properties.onWhiteboardSelect).toHaveBeenCalledWith(null);
  });

  it('clears a board deleted during screenshare only once normal visibility resumes', () => {
    const properties = { ...props(), whiteboards: [] };
    const { rerender } = render(view(properties, 'TLP:CLEAR'));
    expect(properties.onWhiteboardSelect).not.toHaveBeenCalled();
    rerender(view(properties, null));
    expect(properties.onWhiteboardSelect).toHaveBeenCalledTimes(1);
    expect(properties.onWhiteboardSelect).toHaveBeenCalledWith(null);
  });
});
