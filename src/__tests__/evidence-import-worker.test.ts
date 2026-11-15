import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EvidenceFileSource } from '../lib/evidence-import';

const source = (name: string, bytes: Uint8Array): EvidenceFileSource => ({ name, type: '', size: bytes.byteLength, lastModified: 1, bytes });

describe('evidence import worker protocol', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('parses transferred bytes and reports failures as codes, not only English text', async () => {
    const posted = vi.spyOn(self, 'postMessage').mockImplementation(() => {});
    await import('../workers/evidence-import.worker');
    const handle = self.onmessage as unknown as (event: { data: unknown }) => Promise<void>;

    await handle({ data: { source: source('notes.txt', new TextEncoder().encode('Transferred evidence text')), options: { importedAt: 1 } } });
    expect(posted).toHaveBeenLastCalledWith({ ok: true, drafts: [expect.objectContaining({ fileName: 'notes.txt', content: expect.stringContaining('Transferred evidence text') })] });

    vi.stubGlobal('createImageBitmap', vi.fn());
    const header = new Uint8Array(33);
    header.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
    new DataView(header.buffer).setUint32(16, 10_000); new DataView(header.buffer).setUint32(20, 10_000);
    await handle({ data: { source: source('bomb.png', header), options: {} } });
    expect(posted).toHaveBeenLastCalledWith({ ok: false, code: 'imagePixels', error: expect.stringContaining('32 million pixels') });
  });
});
