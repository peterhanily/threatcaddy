import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StandaloneIOC } from '../types';
import { IOCDeduplicator } from '../components/Analysis/IOCDeduplicator';

const ioc = (id: string, value: string, confidence: StandaloneIOC['confidence']): StandaloneIOC => ({
  id, value, confidence, type: 'domain', tags: [id], createdAt: 1, updatedAt: 1, trashed: false, archived: false,
});
afterEach(cleanup);

describe('release hardening: current IOC merge keeper', () => {
  it.each(['deleted', 'value changed'])('selects a valid remaining keeper after the chosen IOC is %s', change => {
    const chosen = ioc('chosen', 'SAME.example', 'low');
    const remaining = [ioc('medium', 'same.example', 'medium'), ioc('high', 'same.example.', 'high')];
    const onUpdate = vi.fn(); const onDelete = vi.fn();
    const props = { open: true, onClose: vi.fn(), onUpdate, onDelete };
    const view = render(<IOCDeduplicator {...props} iocs={[chosen, ...remaining]} />);
    const chosenRow = screen.getByText('SAME.example').parentElement;
    if (!chosenRow) throw new Error('Missing IOC choice row');
    fireEvent.click(within(chosenRow).getByRole('button'));
    const current = change === 'deleted' ? remaining : [{ ...chosen, value: 'different.example' }, ...remaining];
    view.rerender(<IOCDeduplicator {...props} iocs={current} />);
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    expect(onUpdate).toHaveBeenCalledWith('high', expect.objectContaining({ tags: ['high', 'medium'] }));
    expect(onDelete).toHaveBeenCalledExactlyOnceWith('medium');
    expect(onUpdate).not.toHaveBeenCalledWith('chosen', expect.anything());
  });
});
