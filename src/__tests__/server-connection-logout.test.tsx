import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ServerConnection } from '../components/Settings/ServerConnection';
import { REMOTE_LOGOUT_FAILED } from '../lib/session-logout';

const mocks = vi.hoisted(() => ({ logout: vi.fn(), setServerUrl: vi.fn(), addToast: vi.fn() }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({
  user: { id: 'fixture', email: 'fixture@example.invalid', displayName: 'Fixture', role: 'analyst' },
  connected: true, serverUrl: 'https://team.example', logout: mocks.logout, setServerUrl: mocks.setServerUrl,
}) }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: mocks.addToast }) }));
vi.mock('../components/Settings/ServerProfiles', () => ({ ServerProfiles: () => null }));

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });
afterEach(cleanup);

describe('server disconnect feedback', () => {
  it('completes the local transition immediately and reports an unconfirmed remote logout without a success toast', async () => {
    let rejectLogout: (error: Error) => void = () => { throw new Error('Logout not started'); };
    mocks.logout.mockImplementation(() => new Promise<void>((_resolve, reject) => { rejectLogout = reject; }));
    const update = vi.fn();
    render(<ServerConnection settings={{ serverUrl: 'https://team.example' }} onUpdateSettings={update} />);
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect & Logout' }));
    expect(mocks.setServerUrl).toHaveBeenCalledWith(null);
    expect(update).toHaveBeenCalledWith({ serverUrl: undefined, serverDisplayName: undefined });
    expect(mocks.addToast).not.toHaveBeenCalled();
    await act(async () => { rejectLogout(new Error(REMOTE_LOGOUT_FAILED)); });
    expect(mocks.addToast).toHaveBeenCalledExactlyOnceWith('warning', REMOTE_LOGOUT_FAILED, 12_000);
  });

  it('shows the normal disconnect receipt only after remote revocation succeeds', async () => {
    let confirm: () => void = () => { throw new Error('Logout not started'); };
    mocks.logout.mockImplementation(() => new Promise<void>(resolve => { confirm = resolve; }));
    render(<ServerConnection settings={{ serverUrl: 'https://team.example' }} onUpdateSettings={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect & Logout' }));
    expect(mocks.addToast).not.toHaveBeenCalled();
    await act(async () => { confirm(); });
    expect(mocks.addToast).toHaveBeenCalledExactlyOnceWith('info', 'Disconnected from server');
  });
});
