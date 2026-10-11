import { awaitIntegrationResult } from './integration-cancellation';

export const MAX_INTEGRATION_RESPONSE_BYTES = 5 * 1024 * 1024;

/** Read only bounded bytes, retaining caller/deadline cancellation through EOF. */
export async function readIntegrationResponse(response: Response, signal: AbortSignal, maxBytes = MAX_INTEGRATION_RESPONSE_BYTES): Promise<string> {
  signal.throwIfAborted();
  if (!response.body) return '';
  const reader = response.body.getReader();
  let completed = false;
  try {
    const length = Number(response.headers.get('content-length'));
    if (length > maxBytes) throw new Error('Integration response exceeds the supported size limit');
    const decoder = new TextDecoder();
    let bytes = 0;
    let text = '';
    while (true) {
      const chunk = await awaitIntegrationResult(reader.read(), signal);
      signal.throwIfAborted();
      if (chunk.done) {
        completed = true;
        return text + decoder.decode();
      }
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw new Error('Integration response exceeds the supported size limit');
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    if (!completed) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
