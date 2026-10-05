import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from '../components/Common/Modal';
import { ScreenshareContext } from '../hooks/ScreenshareContext';

function DraftForm() {
  const [text, setText] = useState('');
  return <label>Unsaved draft<input value={text} onChange={event => setText(event.target.value)} /></label>;
}

function NestedEditor({ hideOpener = false }: { hideOpener?: boolean }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  return <>
    <button hidden={hideOpener && open} onClick={() => setOpen(true)}>Compose draft</button>
    {open && <Modal open onClose={() => setConfirm(true)} title="Product editor">
      <button onClick={() => setConfirm(true)}>Cancel draft</button>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Discard confirmation">
        <button onClick={() => setConfirm(false)}>Keep editing</button>
        <button onClick={() => setOpen(false)}>Discard draft</button>
      </Modal>
    </Modal>}
  </>;
}

describe('modal screenshare suspension', () => {
  it('hides the dialog, releases keyboard/focus and preserves child draft state until sharing ends', () => {
    const close = vi.fn();
    const ui = (maxLevel: string | null) => <ScreenshareContext.Provider value={{ maxLevel, effectiveLevels: [] }}>
      <button>Outside control</button>
      <Modal open onClose={close} title="Sensitive editor"><DraftForm /></Modal>
    </ScreenshareContext.Provider>;
    document.body.style.overflow = 'auto';
    const view = render(ui(null));
    const input = screen.getByLabelText('Unsaved draft');
    fireEvent.change(input, { target: { value: 'Private unsaved edits' } });
    expect(document.body.style.overflow).toBe('hidden');

    view.rerender(ui('TLP:CLEAR'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(input).toBeInTheDocument();
    expect(input).not.toBeVisible();
    expect(input).toHaveValue('Private unsaved edits');
    expect(screen.getByRole('dialog', { hidden: true })).toHaveAttribute('inert');
    expect(document.body.style.overflow).toBe('auto');
    screen.getByRole('button', { name: 'Outside control' }).focus();
    expect(screen.getByRole('button', { name: 'Outside control' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(close).not.toHaveBeenCalled();

    view.rerender(ui(null));
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.getByLabelText('Unsaved draft')).toBe(input);
    expect(input).toHaveValue('Private unsaved edits');
    expect(document.body.style.overflow).toBe('hidden');
    screen.getByRole('button', { name: 'Outside control' }).focus();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
    view.unmount();
    expect(document.body.style.overflow).toBe('auto');
    document.body.style.overflow = '';
  });

  it('does not take focus or lock scrolling when opened during sharing', () => {
    const view = render(<ScreenshareContext.Provider value={{ maxLevel: 'TLP:CLEAR', effectiveLevels: [] }}>
      <button>Available control</button>
      <Modal open onClose={() => {}} title="Suspended editor"><DraftForm /></Modal>
    </ScreenshareContext.Provider>);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).not.toBe('hidden');
    const outside = screen.getByRole('button', { name: 'Available control' });
    outside.focus();
    expect(outside).toHaveFocus();
    view.unmount();
  });

  it('suspends and restores the complete nested-dialog stack', () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    const ui = (maxLevel: string | null) => <ScreenshareContext.Provider value={{ maxLevel, effectiveLevels: [] }}>
      <button>Outside nested dialogs</button>
      <Modal open onClose={outerClose} title="Outer editor">
        <Modal open onClose={innerClose} title="Inner editor"><DraftForm /></Modal>
      </Modal>
    </ScreenshareContext.Provider>;
    const view = render(ui(null));
    fireEvent.change(screen.getByLabelText('Unsaved draft'), { target: { value: 'Nested draft' } });
    view.rerender(ui('TLP:CLEAR'));
    expect(screen.queryAllByRole('dialog')).toHaveLength(0);
    expect(document.body.style.overflow).not.toBe('hidden');
    screen.getByRole('button', { name: 'Outside nested dialogs' }).focus();
    expect(screen.getByRole('button', { name: 'Outside nested dialogs' })).toHaveFocus();
    view.rerender(ui(null));
    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    expect(screen.getByLabelText('Unsaved draft')).toHaveValue('Nested draft');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(innerClose).toHaveBeenCalledOnce();
    expect(outerClose).not.toHaveBeenCalled();
    view.unmount();
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('restores the original opener when a nested confirmation removes both dialogs', () => {
    render(<NestedEditor />);
    const opener = screen.getByRole('button', { name: 'Compose draft' });
    opener.focus();
    fireEvent.click(opener);
    const cancel = screen.getByRole('button', { name: 'Cancel draft' });
    cancel.focus();
    fireEvent.click(cancel);
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    expect(screen.queryAllByRole('dialog')).toHaveLength(0);
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('restores the parent control and keeps the scroll lock when only the child closes', () => {
    render(<NestedEditor />);
    const opener = screen.getByRole('button', { name: 'Compose draft' });
    opener.focus();
    fireEvent.click(opener);
    const cancel = screen.getByRole('button', { name: 'Cancel draft' });
    cancel.focus();
    fireEvent.click(cancel);
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(cancel).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.click(cancel);
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    expect(opener).toHaveFocus();
  });

  it('does not restore focus to an opener hidden by screenshare privacy', () => {
    const ui = (maxLevel: string | null) => <ScreenshareContext.Provider value={{ maxLevel, effectiveLevels: [] }}>
      <NestedEditor hideOpener />
      <button>Safe sharing control</button>
    </ScreenshareContext.Provider>;
    const view = render(ui(null));
    const opener = screen.getByRole('button', { name: 'Compose draft' });
    opener.focus();
    fireEvent.click(opener);
    const focus = vi.spyOn(opener, 'focus');
    view.rerender(ui('TLP:CLEAR'));
    expect(focus).not.toHaveBeenCalled();
    screen.getByRole('button', { name: 'Safe sharing control' }).focus();
    expect(screen.getByRole('button', { name: 'Safe sharing control' })).toHaveFocus();
    view.unmount();
  });
});
