import { Modal } from './Modal';

interface ShortcutItem {
  keys: string;
  description: string;
}

interface ShortcutGroup {
  title: string;
  shortcuts: ShortcutItem[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'General',
    shortcuts: [
      { keys: 'Ctrl+K', description: 'Open search' },
      { keys: 'Ctrl+S', description: 'Save backup' },
      { keys: 'Ctrl+O', description: 'Open markdown / text file' },
      { keys: 'Ctrl+/', description: 'Show keyboard shortcuts' },
      { keys: 'Escape', description: 'Close dialog / overlay' },
    ],
  },
  {
    title: 'Create',
    shortcuts: [
      { keys: 'Ctrl+N', description: 'New note' },
      { keys: 'Ctrl+Shift+T', description: 'New task' },
    ],
  },
  {
    title: 'Editor',
    shortcuts: [
      { keys: 'Ctrl+E', description: 'Toggle editor mode (edit/split/preview)' },
      { keys: 'Ctrl+`', description: 'Toggle preview' },
      { keys: 'Ctrl+B', description: 'Bold text' },
      { keys: 'Ctrl+I', description: 'Italic text' },
    ],
  },
  {
    title: 'Navigation',
    shortcuts: [
      { keys: 'Ctrl+1', description: 'Switch to Notes' },
      { keys: 'Ctrl+2', description: 'Switch to Tasks' },
      { keys: 'Ctrl+3', description: 'Switch to Timeline' },
      { keys: 'Ctrl+4', description: 'Switch to Whiteboards' },
    ],
  },
];

interface KeyboardShortcutsPanelProps {
  open: boolean;
  onClose: () => void;
}

export function KeyboardShortcutsPanel({ open, onClose }: KeyboardShortcutsPanelProps) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard Shortcuts">
      <div className="space-y-5 max-h-[60vh] overflow-y-auto">
        {SHORTCUT_GROUPS.map((group) => (
          <div key={group.title}>
            <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
              {group.title}
            </h3>
            <div className="space-y-1">
              {group.shortcuts.map((shortcut) => (
                <div
                  key={shortcut.keys}
                  className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-bg-hover transition-colors"
                >
                  <span className="text-sm text-text-secondary">{shortcut.description}</span>
                  <kbd className="ml-4 shrink-0 px-2 py-0.5 rounded bg-bg-deep border border-border-medium text-xs font-mono text-text-muted">
                    {shortcut.keys}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
