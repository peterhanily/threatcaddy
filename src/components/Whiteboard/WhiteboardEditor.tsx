import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Excalidraw, MainMenu, exportToBlob } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';

// Self-host fonts — prevent CDN fallback to esm.sh
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).EXCALIDRAW_ASSET_PATH = new URL(import.meta.env.BASE_URL, window.location.href).href;
}
import { ArrowLeft, Briefcase, Trash2, Image } from 'lucide-react';
import { useEntityDraft } from '../../hooks/useEntityDraft';
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
  onUpdate: (id: string, updates: Partial<Whiteboard>) => void | Promise<void>;
  onCreateTag: (name: string) => Promise<Tag>;
  onBack: () => void;
  onDelete?: (id: string) => void;
  settings?: Settings;
}

function pickAppState(appState: Record<string, unknown>): Record<string, unknown> {
  const { zoom, scrollX, scrollY, theme } = appState;
  return { zoom, scrollX, scrollY, theme };
}

const CANVAS_UI_OPTIONS = { canvasActions: {
  loadScene: false, saveToActiveFile: false, export: { saveFileToDisk: true },
} };

export default function WhiteboardEditor({ whiteboard, allTags, folders, onUpdate, onCreateTag, onBack, onDelete, settings }: WhiteboardEditorProps) {
  const { t } = useTranslation('whiteboard');
  const draft = useEntityDraft<Whiteboard>('whiteboard', whiteboard.id, onUpdate);
  const draftController = draft.controller;
  const [name, setName] = useState(draft.patch.name ?? whiteboard.name);
  const saved = draft.status === 'saved';
  const [showFolderSelect, setShowFolderSelect] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const excalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const lastScene = useRef<{ key: string; elements: string; appState: string; files: string } | undefined>(undefined);
  const sceneKey = `${whiteboard.id}:${draft.discardVersion ?? 0}`;
  const setExcalidrawApi = useCallback((api: ExcalidrawImperativeAPI) => { excalidrawApiRef.current = api; }, []);

  useEffect(() => {
    const retainedName = draftController.getSnapshot().patch.name;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(typeof retainedName === 'string' ? retainedName : whiteboard.name);
  }, [whiteboard.id, whiteboard.name, draftController]);

  const handleNameChange = (value: string) => {
    setName(value);
    draftController.queue({ name: value });
  };

  const handleExcalidrawChange = useCallback((elements: readonly unknown[], appState: Record<string, unknown>, files: Record<string, unknown> = {}) => {
    const next = {
      elements: JSON.stringify(elements),
      appState: JSON.stringify(pickAppState(appState)),
      files: JSON.stringify(files),
    };
    // Excalidraw emits onChange after its own prop/UI updates as well as edits.
    // Publishing an identical draft causes a parent render and another onChange.
    // Compare only persisted scene state, not transient selection/cursor state.
    const previous = lastScene.current;
    if (previous?.key === sceneKey && previous.elements === next.elements
      && previous.appState === next.appState && previous.files === next.files) return;
    lastScene.current = { key: sceneKey, ...next };
    draftController.queue(next);
  }, [draftController, sceneKey]);

  const handleTagsChange = useCallback((tags: string[]) => {
    draftController.queue({ tags }, 0);
  }, [draftController]);

  const handleFolderChange = useCallback((folderId?: string) => {
    draftController.queue({ folderId }, 0);
    setShowFolderSelect(false);
  }, [draftController]);

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

  const retainedElements = draft.patch.elements ?? whiteboard.elements;
  const retainedFiles = draft.patch.files ?? whiteboard.files;
  const retainedAppState = draft.patch.appState ?? whiteboard.appState;
  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  const initialData = useMemo(() => {
    let elements: unknown[] = [];
    let appState: Record<string, unknown> = {};
    let files: Record<string, unknown> = {};
    try { elements = JSON.parse(retainedElements); } catch (e) { console.warn('Failed to parse whiteboard elements:', e); }
    if (retainedFiles) {
      try { files = JSON.parse(retainedFiles); } catch (e) { console.warn('Failed to parse whiteboard files:', e); }
    }
    if (retainedAppState) {
      try { appState = pickAppState(JSON.parse(retainedAppState)); } catch (e) { console.warn('Failed to parse whiteboard appState:', e); }
    }
    return { elements: elements as never, files: files as never,
      appState: { ...appState, theme: isDark ? 'dark' : 'light' } as never };
  }, [retainedElements, retainedFiles, retainedAppState, isDark]);

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
                className={cn('w-full text-start px-3 py-1.5 text-xs hover:bg-gray-800', !whiteboard.folderId && 'text-accent')}
              >
                No investigation
              </button>
              {folders.map((f) => (
                <button
                  key={f.id}
                  onClick={() => handleFolderChange(f.id)}
                  className={cn('w-full text-start px-3 py-1.5 text-xs hover:bg-gray-800', whiteboard.folderId === f.id && 'text-accent')}
                >
                  {f.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <ClsSelect
          value={whiteboard.clsLevel}
          onChange={(clsLevel) => { draftController.queue({ clsLevel }, 0); }}
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

      {draft.status === 'error' && (
        <div role="alert" className="flex items-center gap-3 px-3 py-2 text-sm text-red-300 bg-red-950/30">
          <span>{t('saveFailed')}</span>
          <button className="underline shrink-0" onClick={() => { void draftController.retry(); }}>{t('retrySave')}</button>
        </div>
      )}

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
            key={sceneKey}
            excalidrawAPI={setExcalidrawApi}
            initialData={initialData}
            onChange={handleExcalidrawChange as never}
            UIOptions={CANVAS_UI_OPTIONS}
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
        onConfirm={async () => {
          if (await draftController.flush()) onDelete?.(whiteboard.id);
        }}
        title="Delete Whiteboard"
        message="This whiteboard will be permanently deleted. This cannot be undone."
        confirmLabel="Delete Whiteboard"
        danger
      />
    </div>
  );
}
