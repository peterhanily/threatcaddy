import { useState, useEffect, useRef, useCallback } from 'react';
import { Excalidraw, MainMenu, exportToBlob } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';

// Self-host fonts — prevent CDN fallback to esm.sh
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).EXCALIDRAW_ASSET_PATH = '/';
}
import { ArrowLeft, Briefcase, Trash2, Image } from 'lucide-react';
import type { Whiteboard, Tag, Folder, Settings } from '../../types';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { TagInput } from '../Common/TagInput';
import { ClsSelect } from '../Common/ClsSelect';
import { ConfirmDialog } from '../Common/ConfirmDialog';
import { cn } from '../../lib/utils';

interface WhiteboardEditorProps {
  whiteboard: Whiteboard;
  allTags: Tag[];
  folders: Folder[];
  onUpdate: (id: string, updates: Partial<Whiteboard>) => void;
  onCreateTag: (name: string) => Promise<Tag>;
  onBack: () => void;
  onDelete?: (id: string) => void;
  settings?: Settings;
}

function pickAppState(appState: Record<string, unknown>): Record<string, unknown> {
  const { zoom, scrollX, scrollY, theme } = appState;
  return { zoom, scrollX, scrollY, theme };
}

export default function WhiteboardEditor({ whiteboard, allTags, folders, onUpdate, onCreateTag, onBack, onDelete, settings }: WhiteboardEditorProps) {
  const [name, setName] = useState(whiteboard.name);
  const [saved, setSaved] = useState(false);
  const [showFolderSelect, setShowFolderSelect] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const excalidrawSaveRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const excalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(whiteboard.name);
  }, [whiteboard.id, whiteboard.name]);

  useEffect(() => {
    return () => {
      clearTimeout(saveTimeoutRef.current);
      clearTimeout(savedTimeoutRef.current);
      clearTimeout(excalidrawSaveRef.current);
    };
  }, []);

  const flashSaved = useCallback(() => {
    setSaved(true);
    clearTimeout(savedTimeoutRef.current);
    savedTimeoutRef.current = setTimeout(() => setSaved(false), 1500);
  }, []);

  const handleNameChange = (value: string) => {
    setName(value);
    clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      onUpdate(whiteboard.id, { name: value });
      flashSaved();
    }, 500);
  };

  const handleExcalidrawChange = useCallback((elements: readonly unknown[], appState: Record<string, unknown>) => {
    clearTimeout(excalidrawSaveRef.current);
    excalidrawSaveRef.current = setTimeout(() => {
      onUpdate(whiteboard.id, {
        elements: JSON.stringify(elements),
        appState: JSON.stringify(pickAppState(appState)),
      });
      flashSaved();
    }, 500);
  }, [whiteboard.id, onUpdate, flashSaved]);

  const handleTagsChange = useCallback((tags: string[]) => {
    onUpdate(whiteboard.id, { tags });
    flashSaved();
  }, [whiteboard.id, onUpdate, flashSaved]);

  const handleFolderChange = useCallback((folderId?: string) => {
    onUpdate(whiteboard.id, { folderId });
    setShowFolderSelect(false);
    flashSaved();
  }, [whiteboard.id, onUpdate, flashSaved]);

  const handleExportPNG = useCallback(async () => {
    const api = excalidrawApiRef.current;
    if (!api) return;
    try {
      const elements = api.getSceneElements();
      const appState = api.getAppState();
      const blob = await exportToBlob({
        elements,
        appState: { ...appState, exportWithDarkMode: appState.theme === 'dark' },
        files: api.getFiles(),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${whiteboard.name || 'whiteboard'}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export whiteboard as PNG:', err);
    }
  }, [whiteboard.name]);

  // Parse initial data
  let initialElements: unknown[] = [];
  try { initialElements = JSON.parse(whiteboard.elements); } catch (e) { console.warn('Failed to parse whiteboard elements:', e); }

  let initialAppState: Record<string, unknown> = {};
  if (whiteboard.appState) {
    try { initialAppState = pickAppState(JSON.parse(whiteboard.appState)); } catch (e) { console.warn('Failed to parse whiteboard appState:', e); }
  }

  // Detect theme from document
  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

  const currentFolder = folders.find((f) => f.id === whiteboard.folderId);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 border-b border-gray-800 shrink-0">
        <button
          onClick={onBack}
          className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors"
          title="Back to list"
        >
          <ArrowLeft size={18} />
        </button>
        <input
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          className="flex-1 bg-transparent text-gray-200 text-sm font-medium px-2 py-1 rounded focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder="Whiteboard name"
        />
        <div className="relative">
          <button
            onClick={() => setShowFolderSelect(!showFolderSelect)}
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors',
              currentFolder ? 'bg-gray-800 text-gray-300' : 'text-gray-500 hover:text-gray-300'
            )}
            title="Assign to investigation"
          >
            <Briefcase size={14} />
            <span>{currentFolder?.name || 'No investigation'}</span>
          </button>
          {showFolderSelect && (
            <div className="absolute right-0 top-full mt-1 z-50 bg-gray-900 border border-gray-700 rounded-lg shadow-xl py-1 min-w-[160px]">
              <button
                onClick={() => handleFolderChange(undefined)}
                className={cn('w-full text-left px-3 py-1.5 text-xs hover:bg-gray-800', !whiteboard.folderId && 'text-accent')}
              >
                No investigation
              </button>
              {folders.map((f) => (
                <button
                  key={f.id}
                  onClick={() => handleFolderChange(f.id)}
                  className={cn('w-full text-left px-3 py-1.5 text-xs hover:bg-gray-800', whiteboard.folderId === f.id && 'text-accent')}
                >
                  {f.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <ClsSelect
          value={whiteboard.clsLevel}
          onChange={(clsLevel) => { onUpdate(whiteboard.id, { clsLevel }); flashSaved(); }}
          clsLevels={settings?.tiClsLevels}
        />
        <button
          onClick={handleExportPNG}
          className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors"
          title="Export as PNG"
        >
          <Image size={16} />
        </button>
        {saved && <span className="text-xs text-green-500 shrink-0">Saved</span>}
        {onDelete && (
          <button
            onClick={() => setShowConfirmDelete(true)}
            className="p-1.5 rounded text-red-500 hover:text-red-400 hover:bg-gray-800"
            title="Delete whiteboard"
            aria-label="Delete whiteboard"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>

      {/* Tags */}
      <div className="px-3 py-1.5 border-b border-gray-800 shrink-0">
        <TagInput
          selectedTags={whiteboard.tags}
          allTags={allTags}
          onChange={handleTagsChange}
          onCreateTag={onCreateTag}
        />
      </div>

      {/* Excalidraw canvas — needs a container with explicit dimensions */}
      <div className="flex-1 min-h-0 relative">
        <div className="absolute inset-0">
          <Excalidraw
            key={whiteboard.id}
            excalidrawAPI={(api) => { excalidrawApiRef.current = api; }}
            initialData={{
              elements: initialElements as never,
              appState: {
                ...initialAppState,
                theme: isDark ? 'dark' : 'light',
              } as never,
            }}
            onChange={handleExcalidrawChange as never}
            UIOptions={{
              canvasActions: {
                loadScene: false,
                saveToActiveFile: false,
                export: { saveFileToDisk: true },
              },
            }}
          >
            {/* Custom menu without social links (GitHub, X, Discord) */}
            <MainMenu>
              <MainMenu.DefaultItems.ClearCanvas />
              <MainMenu.DefaultItems.ChangeCanvasBackground />
              <MainMenu.Separator />
              <MainMenu.DefaultItems.ToggleTheme />
              <MainMenu.DefaultItems.Help />
            </MainMenu>
          </Excalidraw>
        </div>
      </div>

      <ConfirmDialog
        open={showConfirmDelete}
        onClose={() => setShowConfirmDelete(false)}
        onConfirm={() => onDelete?.(whiteboard.id)}
        title="Delete Whiteboard"
        message="This whiteboard will be permanently deleted. This cannot be undone."
        confirmLabel="Delete Whiteboard"
        danger
      />
    </div>
  );
}
