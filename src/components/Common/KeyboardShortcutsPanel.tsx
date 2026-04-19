import { useTranslation } from 'react-i18next';
import { Modal } from './Modal';

interface ShortcutItem {
  keys: string;
  description: string;
}

interface ShortcutGroup {
  title: string;
  shortcuts: ShortcutItem[];
}

function useShortcutGroups(): ShortcutGroup[] {
  const { t } = useTranslation('common');
  return [
    {
      title: t('shortcuts.general'),
      shortcuts: [
        { keys: 'Ctrl+K', description: t('shortcuts.openSearch') },
        { keys: 'Ctrl+S', description: t('shortcuts.saveBackup') },
        { keys: 'Ctrl+O', description: t('shortcuts.openFile') },
        { keys: 'Ctrl+/', description: t('shortcuts.showKeyboardShortcuts') },
        { keys: 'Escape', description: t('shortcuts.closeDialog') },
      ],
    },
    {
      title: t('create'),
      shortcuts: [
        { keys: 'Ctrl+N', description: t('shortcuts.newNote') },
        { keys: 'Ctrl+Shift+T', description: t('shortcuts.newTask') },
      ],
    },
    {
      title: t('shortcuts.editor'),
      shortcuts: [
        { keys: 'Ctrl+E', description: t('shortcuts.toggleEditorMode') },
        { keys: 'Ctrl+`', description: t('shortcuts.togglePreview') },
        { keys: 'Ctrl+B', description: t('shortcuts.boldText') },
        { keys: 'Ctrl+I', description: t('shortcuts.italicText') },
      ],
    },
    {
      title: t('shortcuts.navigation'),
      shortcuts: [
        { keys: 'Ctrl+1', description: t('shortcuts.switchToNotes') },
        { keys: 'Ctrl+2', description: t('shortcuts.switchToTasks') },
        { keys: 'Ctrl+3', description: t('shortcuts.switchToTimeline') },
        { keys: 'Ctrl+4', description: t('shortcuts.switchToWhiteboards') },
      ],
    },
  ];
}

interface KeyboardShortcutsPanelProps {
  open: boolean;
  onClose: () => void;
}

export function KeyboardShortcutsPanel({ open, onClose }: KeyboardShortcutsPanelProps) {
  const { t } = useTranslation('common');
  const shortcutGroups = useShortcutGroups();
  return (
    <Modal open={open} onClose={onClose} title={t('shortcuts.title')}>
      <div className="space-y-5 max-h-[60vh] overflow-y-auto">
        {shortcutGroups.map((group) => (
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
                  <kbd className="ms-4 shrink-0 px-2 py-0.5 rounded bg-bg-deep border border-border-medium text-xs font-mono text-text-muted">
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
