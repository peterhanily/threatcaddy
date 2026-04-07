import { useTranslation } from 'react-i18next';

const SHORTCUT_KEYS: { keys: string; i18nKey: string }[] = [
  { keys: 'Ctrl+N', i18nKey: 'shortcuts.newNote' },
  { keys: 'Ctrl+K', i18nKey: 'shortcuts.focusSearch' },
  { keys: 'Ctrl+S', i18nKey: 'shortcuts.saveBackup' },
  { keys: 'Ctrl+O', i18nKey: 'shortcuts.openFile' },
  { keys: 'Ctrl+Shift+T', i18nKey: 'shortcuts.newTask' },
  { keys: 'Ctrl+B', i18nKey: 'shortcuts.bold' },
  { keys: 'Ctrl+I', i18nKey: 'shortcuts.italic' },
  { keys: 'Ctrl+E', i18nKey: 'shortcuts.toggleEditorMode' },
  { keys: 'Ctrl+`', i18nKey: 'shortcuts.togglePreview' },
  { keys: 'Ctrl+/', i18nKey: 'shortcuts.showShortcuts' },
  { keys: 'Ctrl+1/2/3/4', i18nKey: 'shortcuts.switchView' },
  { keys: 'Esc', i18nKey: 'shortcuts.closeModals' },
];

export function KeyboardShortcuts() {
  const { t } = useTranslation('settings');
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-gray-300">{t('shortcuts.title')}</h3>
      <div className="grid gap-2">
        {SHORTCUT_KEYS.map((s) => (
          <div key={s.keys + s.i18nKey} className="flex items-center justify-between py-1.5">
            <span className="text-sm text-gray-400">{t(s.i18nKey)}</span>
            <kbd className="px-2 py-0.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-300 font-mono">
              {s.keys}
            </kbd>
          </div>
        ))}
      </div>
    </div>
  );
}
