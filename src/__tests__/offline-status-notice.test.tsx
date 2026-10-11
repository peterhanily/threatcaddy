import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { OfflineStatusNotice } from '../components/Common/OfflineStatusNotice';
import type { observeOfflineStatus } from '../lib/offline-status';

const mocks = vi.hoisted(() => ({ observe: vi.fn(), stop: vi.fn() }));
vi.mock('../lib/offline-status', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/offline-status')>(), observeOfflineStatus: mocks.observe,
}));
beforeEach(() => { mocks.observe.mockImplementation(() => mocks.stop); mocks.observe.mockClear(); mocks.stop.mockClear(); });
afterEach(() => vi.unstubAllGlobals());

describe('offline installation notice', () => {
  it('shows a named keyboard-native disclosure and translates all observed states', () => {
    render(<OfflineStatusNotice />);
    expect(screen.getByRole('status')).toHaveTextContent('Checking offline support');
    const summary = screen.getByText('Checking offline support').closest('summary');
    expect(summary).not.toBeNull(); if (!summary) throw new Error('Missing status summary');
    fireEvent.click(summary);
    expect(screen.getByText(/A large first download/)).toBeInTheDocument();
    const options = mocks.observe.mock.calls[0]?.[0] as Parameters<typeof observeOfflineStatus>[0];
    act(() => options.onChange('installed'));
    expect(screen.getByRole('status')).toHaveTextContent('Offline support installed');
    expect(screen.getByText(/not a check of cached files or the latest version/)).toBeInTheDocument();
    expect(screen.getByText(/This is not a backup/)).toBeInTheDocument();
    act(() => options.onChange('unavailable'));
    expect(screen.getByRole('status')).toHaveTextContent('Offline availability not confirmed');
    expect(screen.getByText(/still downloading, or unable to finish/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reload|update|install/i })).not.toBeInTheDocument();
  });

  it('disposes observation on unmount', () => {
    const view = render(<OfflineStatusNotice />); view.unmount();
    expect(mocks.stop).toHaveBeenCalledTimes(1);
  });

  it('does not mislabel standalone HTML as a hosted PWA installation', () => {
    vi.stubGlobal('__STANDALONE__', true);
    render(<OfflineStatusNotice />);
    expect(screen.queryByTestId('offline-status')).not.toBeInTheDocument();
    expect(mocks.observe).not.toHaveBeenCalled();
  });
});
