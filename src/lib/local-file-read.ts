/** Local files are bounded by their caller before reading. Cancel/timeout reads
 * so a locked or replaced workspace cannot receive a late plaintext result. */
export function awaitLocalFile<T>(operation: Promise<T>, signal: AbortSignal, timeoutMs = 30_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    };
    const abort = () => { cleanup(); reject(new DOMException('Local file read cancelled', 'AbortError')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Local file read timed out')); }, timeoutMs);
    operation.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

export function readLocalFile(file: Blob, mode: 'text' | 'dataURL', signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reader.onload = reader.onerror = reader.onabort = null;
      const result = reader.result;
      if (reader.readyState === FileReader.LOADING) reader.abort();
      if (error) reject(error);
      else if (typeof result !== 'string') reject(new Error('The local file could not be read'));
      else resolve(result);
    };
    const abort = () => finish(new DOMException('Local file read cancelled', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('Local file read timed out')), 30_000);
    reader.onload = () => finish();
    reader.onerror = () => finish(new Error('The local file could not be read'));
    reader.onabort = abort;
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    try {
      if (mode === 'text') reader.readAsText(file);
      else reader.readAsDataURL(file);
    } catch (error) { finish(error); }
  });
}
