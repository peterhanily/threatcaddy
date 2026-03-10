import React, { Suspense, useEffect } from 'react';
import type { Whiteboard, Folder, Tag, Settings } from '../../types';
import { WhiteboardList } from './WhiteboardList';
import { Loader2 } from 'lucide-react';

const WhiteboardEditor = React.lazy(() => import('./WhiteboardEditor'));

interface WhiteboardViewProps {
  whiteboards: Whiteboard[];
  folders: Folder[];
  allTags: Tag[];
  onCreateWhiteboard: (name?: string) => Promise<Whiteboard>;
  onUpdateWhiteboard: (id: string, updates: Partial<Whiteboard>) => void;
  onDeleteWhiteboard: (id: string) => void;
  onTrashWhiteboard?: (id: string) => void;
  onRestoreWhiteboard?: (id: string) => void;
  onToggleArchiveWhiteboard?: (id: string) => void;
  onCreateTag: (name: string) => Promise<Tag>;
  selectedWhiteboardId?: string | null;
  onWhiteboardSelect?: (id: string | null) => void;
  settings?: Settings;
}

export function WhiteboardView({
  whiteboards,
  folders,
  allTags,
  onCreateWhiteboard,
  onUpdateWhiteboard,
  onDeleteWhiteboard,
  onTrashWhiteboard,
  onRestoreWhiteboard,
  onToggleArchiveWhiteboard,
  onCreateTag,
  selectedWhiteboardId = null,
  onWhiteboardSelect,
  settings,
}: WhiteboardViewProps) {
  const selectedWhiteboard = selectedWhiteboardId ? whiteboards.find((w) => w.id === selectedWhiteboardId) : null;

  // Auto-deselect if whiteboard was deleted
  useEffect(() => {
    if (selectedWhiteboardId && !whiteboards.find((w) => w.id === selectedWhiteboardId)) {
      onWhiteboardSelect?.(null);
    }
  }, [selectedWhiteboardId, whiteboards, onWhiteboardSelect]);

  const handleCreate = async () => {
    const wb = await onCreateWhiteboard();
    onWhiteboardSelect?.(wb.id);
  };

  const handleDelete = (id: string) => {
    onDeleteWhiteboard(id);
    if (selectedWhiteboardId === id) onWhiteboardSelect?.(null);
  };

  if (selectedWhiteboard) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <Suspense
          fallback={
            <div className="flex flex-col items-center justify-center flex-1 text-gray-500 gap-3">
              <Loader2 size={32} className="animate-spin" />
              <p className="text-sm">Loading whiteboard...</p>
            </div>
          }
        >
          <WhiteboardEditor
            whiteboard={selectedWhiteboard}
            allTags={allTags}
            folders={folders}
            onUpdate={onUpdateWhiteboard}
            onCreateTag={onCreateTag}
            onBack={() => onWhiteboardSelect?.(null)}
            onDelete={handleDelete}
            settings={settings}
          />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <WhiteboardList
        whiteboards={whiteboards}
        folders={folders}
        onSelect={(id) => onWhiteboardSelect?.(id)}
        onCreate={handleCreate}
        onDelete={handleDelete}
        onRename={(id, name) => onUpdateWhiteboard(id, { name })}
        onTrash={onTrashWhiteboard}
        onRestore={onRestoreWhiteboard}
        onToggleArchive={onToggleArchiveWhiteboard}
      />
    </div>
  );
}
