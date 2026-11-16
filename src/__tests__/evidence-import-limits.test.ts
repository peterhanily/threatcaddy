import { afterEach, describe, expect, it, vi } from 'vitest';
import { deflate, deflateRaw, Inflate } from 'pako';
import { buildEvidenceItemDrafts } from '../lib/evidence-import';
import { EVIDENCE_LIMITS } from '../lib/evidence-import-limits';

const encode = (text: string) => new TextEncoder().encode(text);
const documentXml = encode('<w:document><w:p><w:r><w:t>Synthetic bounded evidence.</w:t></w:r></w:p></w:document>');
type Entry = { name: string; data: Uint8Array; declared?: number; compressed?: Uint8Array };
function zip(entries: Entry[]): Uint8Array<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encode(entry.name);
    const compressed = entry.compressed ?? deflateRaw(entry.data);
    const local = new Uint8Array(30); const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, 8, true);
    lv.setUint32(18, compressed.length, true); lv.setUint32(22, entry.declared ?? entry.data.length, true); lv.setUint16(26, name.length, true);
    chunks.push(local, name, compressed);
    const header = new Uint8Array(46); const cv = new DataView(header.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, 8, true);
    cv.setUint32(20, compressed.length, true); cv.setUint32(24, entry.declared ?? entry.data.length, true);
    cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true);
    central.push(header, name); offset += local.length + name.length + compressed.length;
  }
  const end = new Uint8Array(22); const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
  ev.setUint32(12, central.reduce((sum, chunk) => sum + chunk.length, 0), true); ev.setUint32(16, offset, true);
  return concat([...chunks, ...central, end]);
}
function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
const u32be = (value: number) => { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value); return bytes; };
const box = (type: string, ...parts: Uint8Array[]) => { const body = concat(parts); return concat([u32be(8 + body.length), encode(type), body]); };
/** A minimal HEIF header: ftyp, then meta > iprp > ipco with one ispe property per size. */
const heif = (brand: string, ...sizes: Array<[number, number]>) => concat([
  box('ftyp', encode(brand), u32be(0), encode('mif1'), encode('miaf')),
  box('meta', u32be(0), box('iprp', box('ipco', ...sizes.map(([width, height]) => box('ispe', u32be(0), u32be(width), u32be(height)))))),
]);
const avif = (...sizes: Array<[number, number]>) => heif('avif', ...sizes);
const docx = (entries: Entry[]) => new File([zip(entries)], 'synthetic.docx');
const pdf = (bytes: Uint8Array) => new File([encode('%PDF-1.4\n1 0 obj\n<< /Filter /FlateDecode >>\nstream\n'), bytes as Uint8Array<ArrayBuffer>, encode('\nendstream\nendobj')], 'synthetic.pdf');
/** Counts the bytes every pako inflater produces, including output the parser discards. */
function meterInflatedBytes(): { bytes: number } {
  const meter = { bytes: 0 };
  const push = Inflate.prototype.push;
  vi.spyOn(Inflate.prototype, 'push').mockImplementation(function (this: Inflate, ...args: Parameters<Inflate['push']>) {
    const onData = this.onData;
    this.onData = (chunk) => { meter.bytes += chunk.byteLength; onData.call(this, chunk); };
    return push.apply(this, args);
  });
  return meter;
}

describe('untrusted evidence resource boundaries', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it.each([
    ['a truncated PNG', new File([new Uint8Array([137, 80, 78, 71])], 'synthetic.png', { type: 'image/png' })],
    ['an image type without a header reader', new File([encode('II*\0synthetic scan')], 'scan.tiff', { type: 'image/tiff' })],
    ['a HEIF image that is not AVIF', new File([heif('heic', [800, 600])], 'photo.heic', { type: 'image/heic' })],
  ])('neither decodes nor stores %s whose size the header does not give', async (_name, image) => {
    // Without a size the pixel bound cannot be checked before decoding, nor for later viewers.
    const decode = vi.fn();
    vi.stubGlobal('createImageBitmap', decode);
    const [draft] = await buildEvidenceItemDrafts(image);
    expect(draft.fileType).toBe('image');
    expect(decode).not.toHaveBeenCalled();
    expect(draft.imageData).toBeUndefined();
    expect(draft.extractionWarning).toContain('Image dimensions could not be read');
  });

  it('reads an AVIF size from its largest ispe property and never decodes one over the pixel bound', async () => {
    const decode = vi.fn();
    vi.stubGlobal('createImageBitmap', decode);
    const [draft] = await buildEvidenceItemDrafts(new File([avif([512, 512], [10_000, 10_000])], 'huge.avif', { type: 'image/avif' }));
    expect(decode).not.toHaveBeenCalled();
    expect([draft.imageWidth, draft.imageHeight]).toEqual([10_000, 10_000]);
    expect(draft.imageData).toBeUndefined();
    expect(draft.extractionWarning).toContain('larger than 32 million pixels');
  });

  it('imports a full-page screenshot over the pixel bound as metadata only, without decoding it', async () => {
    const decode = vi.fn();
    vi.stubGlobal('createImageBitmap', decode);
    // A retina full-page capture of a long page: 2880 x 16384, about 47 megapixels.
    const header = new Uint8Array(33);
    header.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
    new DataView(header.buffer).setUint32(16, 2880); new DataView(header.buffer).setUint32(20, 16_384);
    const [draft] = await buildEvidenceItemDrafts(new File([header], 'full-page.png', { type: 'image/png' }));
    expect(decode).not.toHaveBeenCalled();
    expect(draft.extractionStatus).toBe('metadata-only');
    expect([draft.imageWidth, draft.imageHeight, draft.imagePixelCount]).toEqual([2880, 16_384, 2880 * 16_384]);
    expect(draft.imageData).toBeUndefined();
    expect(draft.extractionWarning).toContain('larger than 32 million pixels');
  });

  it.each([
    ['png', [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 3, 32, 0, 0, 2, 88, 8, 2, 0, 0, 0]],
    ['gif', [71, 73, 70, 56, 57, 97, 32, 3, 88, 2, 0, 0, 0]],
    ['bmp', [66, 77, 0, 0, 0, 0, 0, 0, 0, 0, 54, 0, 0, 0, 40, 0, 0, 0, 32, 3, 0, 0, 168, 253, 255, 255, 1, 0, 24, 0]],
    ['webp', [...encode('RIFF'), 0, 0, 0, 0, ...encode('WEBPVP8X'), 10, 0, 0, 0, 0, 0, 0, 0, 31, 3, 0, 87, 2, 0]],
    ['webp', [...encode('RIFF'), 0, 0, 0, 0, ...encode('WEBPVP8L'), 0, 0, 0, 0, 0x2f, 0x1f, 0xc3, 0x95, 0x00, 0, 0, 0, 0, 0]],
    ['webp', [...encode('RIFF'), 0, 0, 0, 0, ...encode('WEBPVP8 '), 0, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a, 32, 3, 88, 2]],
    ['jpg', [0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc2, 0, 11, 8, 2, 88, 3, 32, 1, 1, 17, 0]],
    ['avif', [...avif([800, 600])]],
  ])('reads %s dimensions from the header when the worker cannot decode the image', async (extension, bytes) => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('NotReadableError')));
    vi.stubGlobal('Image', undefined);
    const [draft] = await buildEvidenceItemDrafts(new File([new Uint8Array(bytes)], `shot.${extension}`));
    expect([draft.imageWidth, draft.imageHeight]).toEqual([800, 600]);
    // The bounded preview is kept, as WebKit workers on file:// cannot decode.
    expect(draft.imageData).toBeDefined();
  });

  it('closes decoded image resources and stores no preview beyond the pixel bound', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 8192, height: 8192, close }));
    // The header is within the bound; the decoded size is what counts.
    const header = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 3, 32, 0, 0, 2, 88, 8, 2, 0, 0, 0]);
    const [draft] = await buildEvidenceItemDrafts(new File([header], 'large.png', { type: 'image/png' }));
    expect(close).toHaveBeenCalledOnce();
    expect([draft.imageWidth, draft.imageHeight]).toEqual([8192, 8192]);
    expect(draft.imageData).toBeUndefined();
    expect(draft.extractionWarning).toContain('larger than 32 million pixels');
  });
  it('rejects raw oversized input before reading it', async () => {
    const text = vi.fn();
    const file = { name: 'huge.txt', size: EVIDENCE_LIMITS.inputBytes + 1, text } as unknown as File;
    await expect(buildEvidenceItemDrafts(file)).rejects.toThrow('25 MiB');
    expect(text).not.toHaveBeenCalled();
  });

  it('does not inflate unused 16 MiB media and still reports the embedded object', async () => {
    const file = docx([{ name: 'word/document.xml', data: documentXml },
      { name: 'word/media/padding.bin', data: new Uint8Array(16 * 1024 * 1024) }]);
    expect(file.size).toBeLessThan(20_000);
    const [draft] = await buildEvidenceItemDrafts(file);
    expect(draft.content).toContain('Synthetic bounded evidence.');
    expect(draft.extractionWarning).toContain('1 embedded media object');
    // Even invalid compressed bytes in an irrelevant part must not reach inflate.
    const [skipped] = await buildEvidenceItemDrafts(docx([{ name: 'word/document.xml', data: documentXml },
      { name: 'word/media/invalid.bin', data: new Uint8Array(), compressed: encode('not deflate'), declared: 16 * 1024 * 1024 }]));
    expect(skipped.content).toContain('Synthetic bounded evidence.');
  });

  it('rejects a declared oversized selected part and an actual oversized part with a lying header', async () => {
    const oversized = new Uint8Array(EVIDENCE_LIMITS.entryBytes + 1);
    await expect(buildEvidenceItemDrafts(docx([{ name: 'word/document.xml', data: documentXml, declared: oversized.length }]))).rejects.toThrow('does not match its declared size');
    await expect(buildEvidenceItemDrafts(docx([{ name: 'word/document.xml', data: oversized, declared: 1 }]))).rejects.toThrow('does not match its declared size');
  });

  it('enforces an aggregate decoded budget across individually permitted selected parts', async () => {
    // Each part is 7 MiB with its marker at the end; the fifth would pass 32 MiB.
    const part = (index: number) => encode(`${' '.repeat(7 * 1024 * 1024 - 64)}<w:p><w:t>Header ${index} end</w:t></w:p>`);
    const entries = Array.from({ length: 5 }, (_, index) => ({ name: `word/header${index + 1}.xml`, data: part(index + 1) }));
    const [draft] = await buildEvidenceItemDrafts(docx([{ name: 'word/document.xml', data: documentXml }, ...entries]));
    expect(draft.extractionStatus).toBe('partial');
    for (const index of [1, 2, 3, 4]) expect(draft.content).toContain(`Header ${index} end`);
    expect(draft.content).not.toContain('Header 5 end');
    expect(draft.extractionWarning).toContain('exceeded the decoding limit');
  });

  it('rejects oversized central-directory entry counts before walking them', async () => {
    const bytes = zip([]);
    const view = new DataView(bytes.buffer);
    view.setUint16(8, EVIDENCE_LIMITS.entries + 1, true); view.setUint16(10, EVIDENCE_LIMITS.entries + 1, true);
    await expect(buildEvidenceItemDrafts(new File([bytes], 'entries.docx'))).rejects.toThrow('2048 entries');
  });

  it('keeps the metadata of corrupt selected ZIP entries and rejects size mismatches', async () => {
    // Unreadable archives import as metadata-only, as they did before the budgets.
    const [corrupt] = await buildEvidenceItemDrafts(docx([{ name: 'word/document.xml', data: documentXml, compressed: encode('invalid deflate') }]));
    expect(corrupt.extractionStatus).toBe('metadata-only');
    expect(corrupt.extractionWarning).toContain('not a readable DOCX archive');
    await expect(buildEvidenceItemDrafts(docx([{ name: 'word/document.xml', data: documentXml, declared: 1 }]))).rejects.toThrow('does not match its declared size');
  });

  it.each([deflateRaw, deflate])('retains normal compressed PDF text and bounds actual output', async compress => {
    const normal = encode('BT\n/F1 12 Tf\n(Synthetic report with useful investigation details.) Tj\nET');
    const [draft] = await buildEvidenceItemDrafts(pdf(compress(normal)));
    expect(draft.content).toContain('Synthetic report with useful investigation details.');
    // Output past the per-stream budget is never produced; the file stays importable.
    const [bounded] = await buildEvidenceItemDrafts(pdf(compress(new Uint8Array(EVIDENCE_LIMITS.entryBytes + 1))));
    expect(bounded.extractionStatus).toBe('metadata-only');
    expect(bounded.extractionWarning).toContain('stopped at the decoding limit');
  });

  it.each([
    ['a DOCX part', '<w:document><w:body><w:p><w:r><w:t>Kept before the cut.</w:t></w:r></w:p>',
      (data: Uint8Array) => docx([{ name: 'word/document.xml', data }])],
    ['a PDF stream', 'BT\n/F1 12 Tf\n(Kept before the cut.) Tj\nET\n', (data: Uint8Array) => pdf(deflate(data))],
  ])('stops inflating %s inside the inflater at the part limit', async (_name, prefix, build) => {
    // A ratio bomb with an honest declared size: 32 MiB of padding deflates to about 32 KB.
    const data = new Uint8Array(4 * EVIDENCE_LIMITS.entryBytes).fill(0x20);
    data.set(encode(prefix));
    const file = build(data);
    expect(file.size).toBeLessThan(100_000);
    const meter = meterInflatedBytes();
    const [draft] = await buildEvidenceItemDrafts(file);
    expect(draft.extractionStatus).toBe('partial');
    expect(draft.content).toContain('Kept before the cut.');
    expect(draft.extractionWarning).toContain('decoding limit');
    // Inflating to the end and discarding the rest would produce all 32 MiB.
    expect(meter.bytes).toBeGreaterThanOrEqual(EVIDENCE_LIMITS.entryBytes);
    expect(meter.bytes).toBeLessThanOrEqual(EVIDENCE_LIMITS.entryBytes + 64 * 1024);
  });

  it('bounds PDF stream count independently of file size', async () => {
    const file = new File(['%PDF-1.4\n' + '<<>>\nstream\nx\nendstream\n'.repeat(EVIDENCE_LIMITS.entries + 1)], 'many.pdf');
    const [draft] = await buildEvidenceItemDrafts(file);
    expect(draft.extractionWarning).toContain('stopped at the decoding limit');
  });

  it('rejects sparse XLSX amplification while preserving ordinary cell extraction', async () => {
    const file = (cells: string) => new File([zip([{ name: 'xl/worksheets/sheet1.xml', data: encode(`<worksheet><row>${cells}</row></worksheet>`) }])], 'sheet.xlsx');
    const [normal] = await buildEvidenceItemDrafts(file('<c r="A1" t="inlineStr"><is><t>Normal cell</t></is></c>'));
    expect(normal.content).toContain('Normal cell');
    await expect(buildEvidenceItemDrafts(file('<c r="ZZZZZZ1" t="inlineStr"><is><t>Sparse</t></is></c>'))).rejects.toThrow('spreadsheet dimensions');
    // Legal but wide rows stop at the cell budget instead of expanding further.
    const rows = '<row><c r="XFD1" t="inlineStr"><is><t>Wide</t></is></c></row>'.repeat(16);
    const [wide] = await buildEvidenceItemDrafts(new File([zip([{ name: 'xl/worksheets/sheet1.xml', data: encode(`<worksheet>${rows}</worksheet>`) }])], 'wide.xlsx'));
    expect(wide.extractionStatus).toBe('partial');
    expect(wide.content.match(/Wide/g)).toHaveLength(Math.floor(EVIDENCE_LIMITS.spreadsheetCells / EVIDENCE_LIMITS.spreadsheetColumns));
  });
});
