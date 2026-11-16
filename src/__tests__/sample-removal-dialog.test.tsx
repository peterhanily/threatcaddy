import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SampleRemovalDialog, type SampleRemovalRequest } from '../components/Common/SampleRemovalDialog';

const request = (userItems: number): SampleRemovalRequest => ({ kind: 'realistic', name: 'Mailbox Compromise — Synthetic Exercise', userItems });

describe('sample removal confirmation', () => {
  it('removes nothing when cancelled', () => {
    const onRemove = vi.fn();
    const onClose = vi.fn();
    render(<SampleRemovalDialog request={request(0)} onClose={onClose} onRemove={onRemove} />);
    const dialog = screen.getByRole('dialog', { name: 'Remove sample investigation?' });
    expect(dialog).toHaveTextContent('Everything in "Mailbox Compromise — Synthetic Exercise", including any changes you made, will be permanently deleted.');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onRemove).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('removes the case only after an explicit confirmation', () => {
    const onRemove = vi.fn();
    render(<SampleRemovalDialog request={request(0)} onClose={vi.fn()} onRemove={onRemove} />);
    expect(screen.queryByRole('button', { name: 'Keep my items' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove sample' }));
    expect(onRemove).toHaveBeenCalledExactlyOnceWith(request(0), false);
  });

  it('names the items the user added and offers to keep them', () => {
    const onRemove = vi.fn();
    const { unmount } = render(<SampleRemovalDialog request={request(3)} onClose={vi.fn()} onRemove={onRemove} />);
    // Changed demo records are counted and kept too, so the copy must not say they are lost either way.
    expect(screen.getByRole('dialog')).toHaveTextContent('contains items you added or changed (3 in total)');
    expect(screen.getByRole('dialog')).not.toHaveTextContent('including any changes you made');
    fireEvent.click(screen.getByRole('button', { name: 'Keep my items' }));
    expect(onRemove).toHaveBeenCalledExactlyOnceWith(request(3), true);
    unmount();
    onRemove.mockClear();
    render(<SampleRemovalDialog request={request(3)} onClose={vi.fn()} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete everything' }));
    expect(onRemove).toHaveBeenCalledExactlyOnceWith(request(3), false);
  });

  it('renders nothing without a request', () => {
    render(<SampleRemovalDialog request={null} onClose={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
