import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';

function fireKey(key: string, opts: Partial<KeyboardEventInit> = {}) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...opts }));
}

describe('useKeyboardShortcuts', () => {
  const noop = () => {};
  let handlers = {
    onNewNote: vi.fn(noop),
    onNewTask: vi.fn(noop),
    onSearch: vi.fn(noop),
    onSave: vi.fn(noop),
    onTogglePreview: vi.fn(noop),
    onEscape: vi.fn(noop),
    onSwitchView: vi.fn(noop),
  };

  beforeEach(() => {
    handlers = {
      onNewNote: vi.fn(noop),
      onNewTask: vi.fn(noop),
      onSearch: vi.fn(noop),
      onSave: vi.fn(noop),
      onTogglePreview: vi.fn(noop),
      onEscape: vi.fn(noop),
      onSwitchView: vi.fn(noop),
    };
  });

  it('triggers onNewNote on Ctrl+N', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(handlers));
    fireKey('n', { ctrlKey: true });
    expect(handlers.onNewNote).toHaveBeenCalledOnce();
    unmount();
  });

  it('triggers onNewNote on Meta+N (macOS)', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(handlers));
    fireKey('n', { metaKey: true });
    expect(handlers.onNewNote).toHaveBeenCalledOnce();
    unmount();
  });

  it('triggers onSearch on Ctrl+K', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(handlers));
    fireKey('k', { ctrlKey: true });
    expect(handlers.onSearch).toHaveBeenCalledOnce();
    unmount();
  });

  it('does not trigger onSearch on Ctrl+Shift+K', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(handlers));
    fireKey('k', { ctrlKey: true, shiftKey: true });
    expect(handlers.onSearch).not.toHaveBeenCalled();
    unmount();
  });

  it('triggers onSave on Ctrl+S', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(handlers));
    fireKey('s', { ctrlKey: true });
    expect(handlers.onSave).toHaveBeenCalledOnce();
    unmount();
  });

  it('triggers onNewTask on Ctrl+Shift+T', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(handlers));
    fireKey('T', { ctrlKey: true, shiftKey: true });
    expect(handlers.onNewTask).toHaveBeenCalledOnce();
    unmount();
  });

  it('triggers onNewTask on Ctrl+Shift+t (lowercase)', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(handlers));
    fireKey('t', { ctrlKey: true, shiftKey: true });
    expect(handlers.onNewTask).toHaveBeenCalledOnce();
    unmount();
  });

  it('triggers onTogglePreview on Ctrl+`', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(handlers));
    fireKey('`', { ctrlKey: true });
    expect(handlers.onTogglePreview).toHaveBeenCalledOnce();
    unmount();
  });

  it('triggers onEscape on Escape', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(handlers));
    fireKey('Escape');
    expect(handlers.onEscape).toHaveBeenCalledOnce();
    unmount();
  });

  it('does not trigger onNewNote on plain N (no modifier)', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(handlers));
    fireKey('n');
    expect(handlers.onNewNote).not.toHaveBeenCalled();
    unmount();
  });

  it('triggers onSwitchView with "notes" on Ctrl+1', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(handlers));
    fireKey('1', { ctrlKey: true });
    expect(handlers.onSwitchView).toHaveBeenCalledWith('notes');
    unmount();
  });

  it('triggers onSwitchView with "tasks" on Ctrl+2', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(handlers));
    fireKey('2', { ctrlKey: true });
    expect(handlers.onSwitchView).toHaveBeenCalledWith('tasks');
    unmount();
  });

  it('triggers onSwitchView with "timeline" on Ctrl+3', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(handlers));
    fireKey('3', { ctrlKey: true });
    expect(handlers.onSwitchView).toHaveBeenCalledWith('timeline');
    unmount();
  });

  it('triggers onSwitchView with "whiteboard" on Ctrl+4', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(handlers));
    fireKey('4', { ctrlKey: true });
    expect(handlers.onSwitchView).toHaveBeenCalledWith('whiteboard');
    unmount();
  });

  it('cleans up listener on unmount', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(handlers));
    unmount();
    fireKey('n', { ctrlKey: true });
    expect(handlers.onNewNote).not.toHaveBeenCalled();
  });
});
