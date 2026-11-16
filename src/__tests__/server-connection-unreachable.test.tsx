import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { ServerConnection } from '../components/Settings/ServerConnection';
import { authStorageKey } from '../lib/auth-storage';
import { REMOTE_LOGOUT_FAILED } from '../lib/session-logout';

const mocks = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: mocks.addToast }) }));
vi.mock('../components/Settings/ServerProfiles', () => ({ ServerProfiles: () => null }));

const auth = {
  serverUrl: 'https://team.example', accessToken: 'access-fixture', refreshToken: 'refresh-fixture',
  user: { id: 'fixture', email: 'fixture@example.invalid', displayName: 'Fixture', role: 'analyst' },
};
function LoseConnection() {
  const { setReachable } = useAuth();
  return <button onClick={() => setReachable(false)}>Fixture: lose connection</button>;
}

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); localStorage.setItem(authStorageKey, JSON.stringify(auth)); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

describe('server connection while the server is unreachable', () => {
  it('keeps the signed-in card with Disconnect, and clears local credentials even when revocation fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Synthetic network failure')));
    render(<AuthProvider><LoseConnection /><ServerConnection settings={{ serverUrl: auth.serverUrl }} onUpdateSettings={vi.fn()} /></AuthProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Fixture: lose connection' }));
    expect(screen.getByText('Server unreachable. You are still signed in.')).toBeInTheDocument();
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Disconnect & Logout' })); });
    expect(localStorage.getItem(authStorageKey)).toBeNull();
    await vi.waitFor(() => expect(mocks.addToast).toHaveBeenCalledWith('warning', REMOTE_LOGOUT_FAILED, 12_000));
    cleanup();
    expect(renderHook(useAuth, { wrapper: AuthProvider }).result.current.user).toBeNull();
  });

  it('keeps Quick Reconnect usable while the revocation request to a hanging server is still pending', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    render(<AuthProvider><LoseConnection /><ServerConnection settings={{ serverUrl: auth.serverUrl }} onUpdateSettings={vi.fn()} /></AuthProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Fixture: lose connection' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Disconnect & Logout' })); });
    expect(localStorage.getItem(authStorageKey)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Connecting...' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'fictional password' } });
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeEnabled();
  });
});
