import http, { type RequestOptions } from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

export async function withAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}

export async function readBoundedBytes(body: ReadableStream<Uint8Array> | null, maximum: number, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  signal.throwIfAborted();
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const aborted = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener('abort', aborted, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new Error(`HTTP body exceeds ${maximum} bytes`);
      chunks.push(value);
    }
    return new Uint8Array(Buffer.concat(chunks));
  } catch (error) {
    void reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    signal.removeEventListener('abort', aborted);
    reader.releaseLock();
  }
}

export async function readProviderJSON(response: Response, signal: AbortSignal, provider: string): Promise<unknown> {
  const text = new TextDecoder().decode(await readBoundedBytes(response.body, 2 * 1024 * 1024, signal));
  if (!response.ok) throw new Error(`${provider} API error ${response.status}: ${text.slice(0, 2000)}`);
  return JSON.parse(text);
}

/** Preserve the original HTTP Host and TLS identity while connecting only to an
 * already validated address. Returns only after the bounded body is consumed,
 * so deadline/cancellation also cover slow response bodies and decompression. */
export async function requestPinned(
  url: URL,
  resolved: { address: string; family: number },
  init: RequestInit,
  options: { signal: AbortSignal; maximum?: number; request?: typeof http.request },
): Promise<Response> {
  options.signal.throwIfAborted();
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('A plain HTTP(S) origin is required');
  const request = new Request(url, { ...init, signal: options.signal });
  const body = await readBoundedBytes(request.body, 2 * 1024 * 1024, options.signal);
  const headers = new Headers(request.headers);
  headers.set('host', url.host);
  headers.set('accept-encoding', 'gzip, deflate, br');
  headers.delete('connection');
  headers.delete('transfer-encoding');
  headers.delete('content-length');
  if (body.length) headers.set('content-length', String(body.length));
  const transport = options.request ?? (url.protocol === 'https:' ? https.request : http.request);
  const requestOptions: RequestOptions = {
    method: request.method, headers: Object.fromEntries(headers), signal: options.signal,
    agent: false,
    lookup: (_hostname, lookupOptions, callback) => {
      if (lookupOptions.all) callback(null, [resolved]);
      else callback(null, resolved.address, resolved.family);
    },
  };
  return new Promise((resolve, reject) => {
    const outgoing = transport(url, requestOptions, incoming => {
      void (async () => {
        const status = incoming.statusCode ?? 502;
        if (status >= 300 && status < 400) throw new Error('External redirects are not permitted');
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) {
          if (value !== undefined) responseHeaders.set(key, Array.isArray(value) ? value.join(', ') : value);
        }
        const encoding = responseHeaders.get('content-encoding')?.toLowerCase();
        const decoder = encoding === 'gzip' ? createGunzip() : encoding === 'deflate' ? createInflate()
          : encoding === 'br' ? createBrotliDecompress() : undefined;
        if (encoding && encoding !== 'identity' && !decoder) throw new Error(`Unsupported HTTP content encoding: ${encoding}`);
        const stream = decoder ? incoming.pipe(decoder) : incoming;
        if (decoder) incoming.on('error', error => decoder.destroy(error));
        const bytes = await readBoundedBytes(Readable.toWeb(stream) as ReadableStream<Uint8Array>, options.maximum ?? 5 * 1024 * 1024, options.signal);
        responseHeaders.delete('content-encoding');
        responseHeaders.delete('content-length');
        resolve(new Response(request.method === 'HEAD' || [204, 205, 304].includes(status) ? null : bytes,
          { status, statusText: incoming.statusMessage, headers: responseHeaders }));
      })().catch(error => { incoming.destroy(); outgoing.destroy(); reject(error); });
    });
    outgoing.on('error', reject);
    outgoing.end(body.length ? body : undefined);
  });
}
