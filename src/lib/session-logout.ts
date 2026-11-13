import { withAuthRefreshLock } from './auth-storage';
import { assertConfiguredConnection } from './connection-policy';

export const REMOTE_LOGOUT_FAILED = 'Signed out locally, but the server did not confirm session revocation. The previous server session may still be active. Contact your server administrator to revoke it.';

/** Independent of ordinary API cancellation: local sign-out tears those requests
 * down immediately, while this bounded request must still revoke the old family. */
export async function revokeRemoteSessions(serverUrl: string, refreshTokens: string[]): Promise<void> {
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
  const revoke = async () => {
    assertConfiguredConnection(serverUrl);
    for (const refreshToken of new Set(refreshTokens)) {
      controller.signal.throwIfAborted();
      const response = await fetch(`${serverUrl}/api/auth/logout`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }), signal: controller.signal,
        credentials: 'omit', redirect: 'error',
      });
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => {});
        controller.signal.throwIfAborted();
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
