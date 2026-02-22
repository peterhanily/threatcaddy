const SHORTCUTS = [
  { keys: 'Ctrl+N', action: 'New note / Quick capture' },
  { keys: 'Ctrl+K', action: 'Focus search' },
  { keys: 'Ctrl+S', action: 'Save current note' },
  { keys: 'Ctrl+Shift+T', action: 'New task' },
  { keys: 'Ctrl+B', action: 'Bold text' },
  { keys: 'Ctrl+I', action: 'Italic text' },
  { keys: 'Ctrl+K', action: 'Insert link' },
  { keys: 'Ctrl+`', action: 'Toggle editor/preview' },
  { keys: 'Esc', action: 'Close modals' },
];

export function KeyboardShortcuts() {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-gray-300">Keyboard Shortcuts</h3>
      <div className="grid gap-2">
        {SHORTCUTS.map((s) => (
          <div key={s.keys + s.action} className="flex items-center justify-between py-1.5">
            <span className="text-sm text-gray-400">{s.action}</span>
            <kbd className="px-2 py-0.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-300 font-mono">
              {s.keys}
            </kbd>
          </div>
        ))}
      </div>
    </div>
  );
}
