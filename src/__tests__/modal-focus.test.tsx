import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode, useLayoutEffect, useState, type ReactNode } from 'react';
import { Modal } from '../components/Common/Modal';
import { ScreenshareContext } from '../hooks/ScreenshareContext';
afterEach(cleanup);

function NewInvestigation({ wrap = (node: ReactNode) => node }: { wrap?: (node: ReactNode) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return <>
    <button onClick={() => setOpen(true)}>New investigation</button>
    {wrap(open && <Modal open onClose={() => setOpen(false)} title="New investigation">
      <label>Name<input autoFocus /></label>
    </Modal>)}
  </>;
}

function openWithKeyboardFocus(name: string) {
  const opener = screen.getByRole('button', { name });
  opener.focus();
  fireEvent.click(opener);
  return opener;
}

describe('modal focus with autoFocus content', () => {
  it.each([
    ['plain', (node: ReactNode) => <>{node}</>],
    ['StrictMode', (node: ReactNode) => <StrictMode>{node}</StrictMode>],
  ])('keeps the autoFocus field and returns focus to the opener (%s)', (_mode, wrap) => {
    render(wrap(<NewInvestigation />));
    const opener = openWithKeyboardFocus('New investigation');
    expect(screen.getByLabelText('Name')).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('restores the parent control when an autoFocus child dialog closes', () => {
    function Parent() {
      const [open, setOpen] = useState(false);
      const [child, setChild] = useState(false);
      return <>
        <button onClick={() => setOpen(true)}>Open playbooks</button>
        <Modal open={open} onClose={() => setOpen(false)} title="Playbooks">
          <button onClick={() => setChild(true)}>Pick playbook</button>
          {child && <Modal open onClose={() => setChild(false)} title="Playbook picker"><label>Filter<input autoFocus /></label></Modal>}
        </Modal>
      </>;
    }
    render(<Parent />);
    const opener = openWithKeyboardFocus('Open playbooks');
    const pick = openWithKeyboardFocus('Pick playbook');
    expect(screen.getByLabelText('Filter')).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(pick).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(opener).toHaveFocus();
  });

  it('does not treat its own autoFocus field as the opener across a screenshare suspension', () => {
    const ui = (maxLevel: string | null) => <ScreenshareContext.Provider value={{ maxLevel, effectiveLevels: [] }}>
      <NewInvestigation />
    </ScreenshareContext.Provider>;
    const view = render(ui(null));
    const opener = openWithKeyboardFocus('New investigation');
    view.rerender(ui('TLP:CLEAR'));
    // A browser cannot focus the hidden field; jsdom lets React re-focus it.
    opener.focus();
    view.rerender(ui(null));
    expect(screen.getByLabelText('Name')).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(opener).toHaveFocus();
  });

  it('keeps the opener when focus falls to body while a screenshare hides the dialog', () => {
    const ui = (maxLevel: string | null) => <ScreenshareContext.Provider value={{ maxLevel, effectiveLevels: [] }}>
      <NewInvestigation />
    </ScreenshareContext.Provider>;
    const view = render(ui(null));
    const opener = openWithKeyboardFocus('New investigation');
    view.rerender(ui('TLP:CLEAR'));
    // A browser drops focus from the hidden dialog to <body>.
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    view.rerender(ui(null));
    expect(screen.getByLabelText('Name')).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(opener).toHaveFocus();
  });
});

describe('modal keyboard handling before paint (UX-07)', () => {
  // A later sibling's layout effect runs after the Modal's layout effect and
  // before any passive effect. Escape dispatched there models a key pressed
  // as soon as a lazily loaded dialog becomes visible.
  function EscapeBeforePaint() {
    useLayoutEffect(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); }, []);
    return null;
  }

  it('handles Escape before passive effects run', () => {
    const close = vi.fn();
    render(<><Modal open onClose={close} title="Lazy dialog"><input aria-label="Field" /></Modal><EscapeBeforePaint /></>);
    expect(close).toHaveBeenCalledOnce();
  });
});
