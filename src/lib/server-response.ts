import { cancellableRequest } from './request-cancellation';

const active = new Set<AbortController>();
export function cancelServerRequests(): void {
  for (const request of active) request.abort(new Error('Server connection changed; request cancelled'));
}

/** Keep the deadline and connection fence alive through body consumption, not
 * just response headers. A stalled or unbounded response cannot retain a stale
 * account callback indefinitely. Caller cancellation always reaches the reader. */
export async function fetchServerResponse(url: string, init: RequestInit,
  options: { current: () => boolean; maxBytes: number; timeoutMs: number }): Promise<Response> {
  const request = cancellableRequest(init.signal ?? undefined);
  active.add(request.controller);
  const timer = setTimeout(() => request.controller.abort(new Error('Server response deadline exceeded')), options.timeoutMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let response: Response | undefined;
  let completed = false;
  let onAbort: (() => void) | undefined;
  const cleanup = () => {
    if (completed) return;
    completed = true; clearTimeout(timer); active.delete(request.controller);
    if (onAbort) request.signal.removeEventListener('abort', onAbort);
    request.dispose();
  };
  const assertCurrent = () => {
    request.signal.throwIfAborted();
    if (!options.current()) throw new Error('Server connection changed; request cancelled');
  };
  try {
    assertCurrent();
    response = await fetch(url, { ...init, signal: request.signal });
    assertCurrent();
    if (!response.body) { cleanup(); return response; }
    const length = response.headers.get('Content-Length');
    if (length && Number(length) > options.maxBytes) {
      void response.body.cancel().catch(() => {});
      throw new Error('Server response exceeds the supported size limit');
    }
    reader = response.body.getReader();
    let bytes = 0;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        onAbort = () => {
          if (completed) return;
          controller.error(request.signal.reason ?? new DOMException('Aborted', 'AbortError'));
          void reader?.cancel().catch(() => {});
          cleanup();
        };
        request.signal.addEventListener('abort', onAbort, { once: true });
      },
      async pull(controller) {
        try {
          assertCurrent();
          const chunk = await reader!.read();
          if (completed) return;
          assertCurrent();
          if (chunk.done) { controller.close(); reader!.releaseLock(); cleanup(); return; }
          bytes += chunk.value.byteLength;
          if (bytes > options.maxBytes) throw new Error('Server response exceeds the supported size limit');
          controller.enqueue(chunk.value);
        } catch (cause) {
          if (!completed) controller.error(cause);
          void reader?.cancel().catch(() => {});
          cleanup();
        }
      },
      async cancel(reason) { cleanup(); await reader?.cancel(reason); },
    });
    return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (cause) {
    request.controller.abort(cause);
    if (reader) void reader.cancel().catch(() => {});
    else void response?.body?.cancel().catch(() => {});
    cleanup(); throw cause;
  }
}
