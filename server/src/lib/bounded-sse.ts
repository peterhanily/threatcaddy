import { withAbort } from './bounded-http.js';

export interface JsonSSEEvent { type: string; [key: string]: unknown }
interface SSEContext {
  signal: AbortSignal;
  send(event: JsonSSEEvent): Promise<void>;
}
interface SSEOptions {
  deadlineMs?: number;
  writeDeadlineMs?: number;
  maxEventBytes?: number;
  maxOutputBytes?: number;
  onError?: (error: unknown) => void;
}

/** Await real backpressure without swallowing write failures. A cancelled or
 * stalled consumer stops the producer; terminal events are emitted at most once.
 * Cancellation is a transport outcome, never a claim that a tool was rolled back.
 */
export function createBoundedSSE(requestSignal: AbortSignal,
  run: (context: SSEContext) => Promise<void>, options: SSEOptions = {}): Response {
  const deadlineMs = options.deadlineMs ?? 120_000;
  const writeDeadlineMs = options.writeDeadlineMs ?? 10_000;
  const maxEventBytes = options.maxEventBytes ?? 256 * 1024;
  const maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024;
  if ([deadlineMs, writeDeadlineMs, maxEventBytes, maxOutputBytes]
    .some(value => !Number.isSafeInteger(value) || value < 1)) throw new Error('Invalid stream limits');

  const cancellation = new AbortController();
  const signal = cancellation.signal;
  const transform = new TransformStream<Uint8Array, Uint8Array>();
  const writer = transform.writable.getWriter();
  const reader = transform.readable.getReader();
  const encoder = new TextEncoder();
  let consumerCancelled = false;
  let terminal = false;
  let outputBytes = 0;
  const stop = (reason: unknown) => {
    if (signal.aborted) return;
    cancellation.abort(reason);
    // Cancelling the reader also rejects any pending backpressured writer.write.
    void reader.cancel(reason).catch(() => {});
  };
  const abortRequest = () => stop(requestSignal.reason);
  requestSignal.addEventListener('abort', abortRequest, { once: true });
  if (requestSignal.aborted) abortRequest();
  const deadline = setTimeout(() => stop(new Error('Admin AI request deadline exceeded')), deadlineMs);
  deadline.unref?.();

  const send = async (event: JsonSSEEvent): Promise<void> => {
    signal.throwIfAborted();
    if (terminal) throw new Error('The event stream has already completed');
    const bytes = encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
    if (bytes.byteLength > maxEventBytes || outputBytes + bytes.byteLength > maxOutputBytes) {
      throw new Error('Admin AI output limit exceeded');
    }
    outputBytes += bytes.byteLength;
    terminal = ['done', 'error', 'confirmation_required'].includes(event.type);
    const stalled = setTimeout(() => stop(new Error('Admin AI response consumer stalled')), writeDeadlineMs);
    stalled.unref?.();
    try {
      await withAbort(writer.write(bytes), signal);
      signal.throwIfAborted();
    } finally { clearTimeout(stalled); }
  };

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (consumerCancelled) return;
        if (result.done) controller.close();
        else controller.enqueue(result.value);
      } catch (error) { if (!consumerCancelled) controller.error(error); }
    },
    cancel(reason) {
      consumerCancelled = true;
      stop(reason ?? new Error('Admin AI client disconnected'));
    },
  }, { highWaterMark: 0 });

  void (async () => {
    try {
      signal.throwIfAborted();
      await withAbort(Promise.resolve().then(() => {
        signal.throwIfAborted();
        return run({ signal, send });
      }), signal);
      if (!terminal) await send({ type: 'done', stopReason: 'stop' });
    } catch (error) {
      if (!signal.aborted) {
        try { options.onError?.(error); } catch { /* Diagnostics must not prevent cleanup. */ }
        if (!terminal) {
          try { await send({ type: 'error', error: 'Admin AI request failed' }); }
          catch (writeError) { stop(writeError); }
        }
      }
    } finally {
      try { if (!signal.aborted) await withAbort(writer.close(), signal); }
      catch (error) { stop(error); }
      clearTimeout(deadline);
      requestSignal.removeEventListener('abort', abortRequest);
      writer.releaseLock();
    }
  })();

  return new Response(body, { headers: {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Accel-Buffering': 'no',
  } });
}
