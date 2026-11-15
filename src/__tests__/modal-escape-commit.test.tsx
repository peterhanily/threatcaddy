import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { Modal } from '../components/Common/Modal';
afterEach(cleanup);

const observed: { focus?: Element | null; handled?: boolean } = {};

// A lazily opened dialog can paint, and receive a key press, before React runs
// its passive effects. This later sibling acts during the same commit's layout
// phase, after the dialog's own layout effects and before any passive effect.
function KeyPressInOpeningCommit() {
  useLayoutEffect(() => {
    observed.focus = document.activeElement;
    observed.handled = !document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  }, []);
  return null;
}

describe('modal keyboard readiness', () => {
  it('has focus and accepts Escape within the commit that opens it', () => {
    const onClose = vi.fn();
    render(<>
      <Modal open onClose={onClose} title="Lazily opened dialog"><input aria-label="Dialog field" /></Modal>
      <KeyPressInOpeningCommit />
    </>);
    expect(observed.handled).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
    expect(observed.focus).toBe(screen.getByRole('button', { name: 'Close' }));
  });
});
