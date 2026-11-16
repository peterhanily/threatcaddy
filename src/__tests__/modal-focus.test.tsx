import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useLayoutEffect, useState, type ReactNode } from 'react';
import { Modal } from '../components/Common/Modal';
import { QuickLinkForm } from '../components/Dashboard/QuickLinkForm';
import { CreateInvestigationModal } from '../components/Investigations/CreateInvestigationModal';
import { PlaybookPicker } from '../components/Playbooks/PlaybookPicker';
import { ScreenshareContext } from '../hooks/ScreenshareContext';
import type { PlaybookTemplate } from '../types';
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

  it('returns to its autoFocus field after the opener was focused during a screenshare suspension', () => {
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

  it('does not treat its own field as the opener when focus stays inside across a suspension', () => {
    const ui = (maxLevel: string | null) => <ScreenshareContext.Provider value={{ maxLevel, effectiveLevels: [] }}>
      <NewInvestigation />
    </ScreenshareContext.Provider>;
    const view = render(ui(null));
    const opener = openWithKeyboardFocus('New investigation');
    const field = screen.getByLabelText('Name');
    view.rerender(ui('TLP:CLEAR'));
    // The resume commit then finds focus inside the dialog itself.
    expect(field).toHaveFocus();
    view.rerender(ui(null));
    expect(field).toHaveFocus();
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

describe('Enter that saves an autoFocus dialog', () => {
  // Closing restores focus to the opener while the Enter keydown is still in
  // flight. Unless the field cancels it, the keypress then clicks the opener.
  const opens = vi.fn();
  afterEach(() => opens.mockClear());
  function Opener({ label, children }: { label: string; children: (open: boolean, close: () => void) => ReactNode }) {
    const [open, setOpen] = useState(false);
    return <>
      <button onClick={() => { opens(); setOpen(true); }}>{label}</button>
      {children(open, () => setOpen(false))}
    </>;
  }
  async function openFrom(label: string) {
    const user = userEvent.setup();
    const opener = screen.getByRole('button', { name: label });
    await user.click(opener);
    return { user, opener };
  }
  function expectClosedOnce(opener: HTMLElement) {
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opens).toHaveBeenCalledOnce();
    expect(opener).toHaveFocus();
  }

  it.each(['e.g. VirusTotal', 'e.g. virustotal.com', 'Short description'])('Quick Link saves once from %s', async (field) => {
    const save = vi.fn();
    render(<Opener label="Add link">{(open, close) => open && <QuickLinkForm onSave={data => { save(data); close(); }} onCancel={close} />}</Opener>);
    const { user, opener } = await openFrom('Add link');
    await user.keyboard('Fictional reference');
    await user.tab();
    await user.keyboard('reference.example');
    screen.getByPlaceholderText(field).focus();
    await user.keyboard('{Enter}');
    expect(save).toHaveBeenCalledOnce();
    expectClosedOnce(opener);
  });

  it('New Investigation creates once', async () => {
    const create = vi.fn();
    render(<Opener label="New Investigation">{(open, close) => <CreateInvestigationModal open={open} onClose={close} onCreate={create} />}</Opener>);
    const { user, opener } = await openFrom('New Investigation');
    await user.keyboard('Operation Fictional{Enter}');
    expect(create).toHaveBeenCalledExactlyOnceWith('Operation Fictional');
    expectClosedOnce(opener);
  });

  it('Playbook picker starts once', async () => {
    const playbook: PlaybookTemplate = { id: 'fictional-playbook', name: 'Fictional playbook', investigationType: 'generic', steps: [], source: 'user', createdAt: 0, updatedAt: 0 };
    const select = vi.fn();
    render(<Opener label="From playbook">{(open, close) => <PlaybookPicker open={open} onClose={close} playbooks={[playbook]} onSelect={select} />}</Opener>);
    const { user, opener } = await openFrom('From playbook');
    await user.click(screen.getByRole('button', { name: /Fictional playbook/ }));
    await user.keyboard('Operation Fictional{Enter}');
    expect(select).toHaveBeenCalledExactlyOnceWith('fictional-playbook', 'Operation Fictional');
    expectClosedOnce(opener);
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
