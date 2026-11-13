import { withAuthRefreshLock } from './auth-storage';
import { assertConfiguredConnection } from './connection-policy';

export const REMOTE_LOGOUT_FAILED = 'Signed out locally, but the server did not confirm session revocation. The previous server session may still be active. Contact your server administrator to revoke it.';

export interface LogoutCredential {
  refreshToken: string;
  accessToken: string | null;
}

/** Independent of ordinary API cancellation: local sign-out tears those requests
 * down immediately, while this bounded request must still revoke the old family. */
export async function revokeRemoteSessions(serverUrl: string, credentials: readonly LogoutCredential[]): Promise<void> {
  const unique = new Map<string, LogoutCredential>();
  for (const credential of credentials) {
    const previous = unique.get(credential.refreshToken);
    // Keep each access token paired with the refresh credential captured with
    // it. A duplicate refresh-only snapshot must not discard its paired bearer.
    if (!previous || (!previous.accessToken && credential.accessToken)) unique.set(credential.refreshToken, { ...credential });
  }
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      void reader?.cancel().catch(() => {});
      reject(new Error(REMOTE_LOGOUT_FAILED));
    }, 15_000);
  });
  const request = async ({ refreshToken }: LogoutCredential, accessToken?: string): Promise<Response> => {
    controller.signal.throwIfAborted();
    const response = await fetch(`${serverUrl}/api/auth/logout`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      body: JSON.stringify({ refreshToken }), signal: controller.signal,
      credentials: 'omit', redirect: 'error',
    });
    if (controller.signal.aborted) {
      void response.body?.cancel().catch(() => {});
      controller.signal.throwIfAborted();
    }
    return response;
  };
  const revoke = async () => {
    assertConfiguredConnection(serverUrl);
    const acknowledgedBearers = new Set<string>();
    for (const credential of unique.values()) {
      // New servers revoke retained refresh lineage without needing live access.
      let response = await request(credential);
      let bearerFallback = false;
      if (response.status === 401 && credential.accessToken) {
        void response.body?.cancel().catch(() => {});
        // Older servers require a bearer. Reuse only this credential's paired
        // access token, without refreshing or restarting the overall deadline.
        if (acknowledgedBearers.has(credential.accessToken)) continue;
        response = await request(credential, credential.accessToken);
        bearerFallback = true;
      }
      if (!response.ok || !response.body || Number(response.headers.get('Content-Length')) > 16_384) {
        void response.body?.cancel().catch(() => {});
        throw new Error(REMOTE_LOGOUT_FAILED);
      }
      reader = response.body.getReader();
      let body = '', bytes = 0;
      const decoder = new TextDecoder();
      for (;;) {
        controller.signal.throwIfAborted();
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 16_384) throw new Error(REMOTE_LOGOUT_FAILED);
        body += decoder.decode(chunk.value, { stream: true });
      }
      reader.releaseLock(); reader = undefined;
      if (JSON.parse(body + decoder.decode())?.ok !== true) throw new Error(REMOTE_LOGOUT_FAILED);
      if (bearerFallback && credential.accessToken) acknowledgedBearers.add(credential.accessToken);
    }
  };
  try {
    // Refresh fails closed without Web Locks; revocation itself is safe without
    // them because the server serializes it against rotation using retained lineage.
    await Promise.race([navigator.locks ? withAuthRefreshLock(revoke, controller.signal) : revoke(), deadline]);
  } catch {
    // Never surface a remote body, token or transport diagnostic to UI/logs.
    throw new Error(REMOTE_LOGOUT_FAILED);
  } finally {
    clearTimeout(timer);
    controller.abort();
    void reader?.cancel().catch(() => {});
  }
}
