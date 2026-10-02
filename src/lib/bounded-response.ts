/** Bound the bytes as they are read, not after allocating an unbounded body. */
export async function readBoundedText(response: Response, maxBytes = 2_000_000): Promise<string> {
  const length = response.headers.get('content-length');
  if (length && Number(length) > maxBytes) { await response.body?.cancel(); throw new Error('Response exceeded the size limit.'); }
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let text = '', bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error('Response exceeded the size limit.');
      text += decoder.decode(value, { stream: true });
    }
  } finally { await reader.cancel().catch(() => {}); }
}
