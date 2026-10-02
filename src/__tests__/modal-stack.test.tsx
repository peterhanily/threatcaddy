import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { Modal } from '../components/Common/Modal';
import { NoteCard } from '../components/Notes/NoteCard';
import { InvestigationCard } from '../components/Investigations/InvestigationCard';
afterEach(cleanup);

describe('modal stack and keyboard controls', () => {
  it('keeps nested dialogs locked and closes/restores only the top dialog', () => {
    document.body.style.overflow = 'scroll';
    function Fixture() {
      const [outer, setOuter] = useState(false);
      const [inner, setInner] = useState(false);
      return <><button onClick={() => setOuter(true)}>Open outer</button>
        <Modal open={outer} onClose={() => setOuter(false)} title="Shared title">
          <button onClick={() => setInner(true)}>Open inner</button>
          <Modal open={inner} onClose={() => setInner(false)} title="Shared title"><input aria-label="Inner field" /></Modal>
        </Modal>
        <Modal open={false} onClose={() => {}} title="Closed"><span>Closed content</span></Modal></>;
    }
    render(<Fixture />);
    const trigger = screen.getByRole('button', { name: 'Open outer' });
    trigger.focus(); fireEvent.click(trigger);
    const innerTrigger = screen.getByRole('button', { name: 'Open inner' });
    innerTrigger.focus(); fireEvent.click(innerTrigger);
    const dialogs = screen.getAllByRole('dialog');
    expect(dialogs).toHaveLength(2);
    expect(new Set(dialogs.map(dialog => dialog.getAttribute('aria-labelledby'))).size).toBe(2);
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(document.body.style.overflow).toBe('hidden');
    expect(innerTrigger).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe('scroll');
    document.body.style.overflow = '';
  });

  it('skips hidden/disabled controls and traps programmatic focus escape', () => {
    render(<><button>Outside</button><Modal open onClose={() => {}} title="Focus">
      <button disabled>Disabled</button><div hidden><button>Hidden</button></div><button>Last enabled</button>
    </Modal></>);
    const dialog = screen.getByRole('dialog');
    const close = within(dialog).getByRole('button', { name: 'Close' });
    const last = screen.getByRole('button', { name: 'Last enabled' });
    close.focus(); fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(close).toHaveFocus();
    screen.getByRole('button', { name: 'Outside' }).focus();
    expect(close).toHaveFocus();
  });

  it('separates note primary and secondary controls without ancestor keyboard activation', () => {
    const select = vi.fn(), trash = vi.fn();
    const view = render(<NoteCard note={{ id: 'note', title: 'Finding', content: '', tags: [], pinned: false, archived: false, trashed: false, createdAt: 1, updatedAt: 1 }} active={false} onSelect={select} onTrash={trash} />);
    expect(view.container.querySelector('button button, [role="button"] button')).toBeNull();
    const remove = screen.getByRole('button', { name: 'Move note to trash' });
    fireEvent.keyDown(remove, { key: 'Enter' });
    fireEvent.click(remove);
    expect(trash).toHaveBeenCalledExactlyOnceWith('note');
    expect(select).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Finding' }));
    expect(select).toHaveBeenCalledExactlyOnceWith('note');
  });

  it('renders investigation actions as sibling native buttons', () => {
    const open = vi.fn(), sync = vi.fn();
    const view = render(<InvestigationCard folderId="case" name="Case" status="active" dataMode="remote" entityCounts={{ notes: 0, tasks: 0, iocs: 0, events: 0, whiteboards: 0, chats: 0 }} onOpen={open} onSync={sync} />);
    expect(view.container.querySelector('button button, button [role="button"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sync locally' }));
    expect(sync).toHaveBeenCalledExactlyOnceWith('case');
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Case' }));
    expect(open).toHaveBeenCalledExactlyOnceWith('case');
  });
});
