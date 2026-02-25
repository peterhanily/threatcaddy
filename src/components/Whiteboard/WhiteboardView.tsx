import React, { Suspense } from 'react';
import type { Whiteboard, Folder, Tag } from '../../types';
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
  onCreateTag: (name: string) => Promise<Tag>;
  selectedWhiteboardId?: string | null;
  onWhiteboardSelect?: (id: string | null) => void;
}

export function WhiteboardView({
  whiteboards,
  folders,
  allTags,
  onCreateWhiteboard,
  onUpdateWhiteboard,
  onDeleteWhiteboard,
  onCreateTag,
  selectedWhiteboardId = null,
  onWhiteboardSelect,
}: WhiteboardViewProps) {
  const selectedWhiteboard = selectedWhiteboardId ? whiteboards.find((w) => w.id === selectedWhiteboardId) : null;

  // Auto-deselect if whiteboard was deleted
  if (selectedWhiteboardId && !selectedWhiteboard) {
    // Use setTimeout to avoid setState during render
    setTimeout(() => onWhiteboardSelect?.(null), 0);
  }

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
      />
    </div>
  );
}
