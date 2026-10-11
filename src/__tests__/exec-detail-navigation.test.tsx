import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExecDetailNav } from '../components/ExecMode/ExecDetailNav';

describe('honest Exec detail positions', () => {
  it.each([
    [-1, 0], [-1, 3], [0, 0], [0, -1], [3, 3], [4, 3],
    [NaN, 3], [0, Infinity], [0.5, 3], [0, 2.5], [0, Number.MAX_SAFE_INTEGER + 1],
  ])('omits navigation for invalid index %s and count %s', (currentIndex, totalCount) => {
    const onPrev = vi.fn(); const onNext = vi.fn();
    const view = render(<ExecDetailNav currentIndex={currentIndex} totalCount={totalCount} onPrev={onPrev} onNext={onNext} />);
    expect(view.container).toBeEmptyDOMElement();
    expect(onPrev).not.toHaveBeenCalled(); expect(onNext).not.toHaveBeenCalled();
  });

  it('retains a valid one-item position with both controls disabled', () => {
    render(<ExecDetailNav currentIndex={0} totalCount={1} onPrev={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByText('1 of 1')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Prev' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('preserves valid previous/next behavior and boundary disabling', () => {
    const onPrev = vi.fn(); const onNext = vi.fn();
    const view = render(<ExecDetailNav currentIndex={0} totalCount={3} onPrev={onPrev} onNext={onNext} />);
    fireEvent.click(screen.getByRole('button', { name: 'Prev' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onPrev).not.toHaveBeenCalled(); expect(onNext).toHaveBeenCalledTimes(1);
    view.rerender(<ExecDetailNav currentIndex={1} totalCount={3} onPrev={onPrev} onNext={onNext} />);
    expect(screen.getByText('2 of 3')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Prev' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onPrev).toHaveBeenCalledTimes(1); expect(onNext).toHaveBeenCalledTimes(2);
    view.rerender(<ExecDetailNav currentIndex={2} totalCount={3} onPrev={onPrev} onNext={onNext} />);
    expect(screen.getByRole('button', { name: 'Prev' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });
});
