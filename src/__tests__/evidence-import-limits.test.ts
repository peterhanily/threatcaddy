import { afterEach, describe, expect, it, vi } from 'vitest';
import { deflate, deflateRaw } from 'pako';
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
const docx = (entries: Entry[]) => new File([zip(entries)], 'synthetic.docx');
const pdf = (bytes: Uint8Array) => new File([encode('%PDF-1.4\n1 0 obj\n<< /Filter /FlateDecode >>\nstream\n'), bytes as Uint8Array<ArrayBuffer>, encode('\nendstream\nendobj')], 'synthetic.pdf');

describe('untrusted evidence resource boundaries', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('preserves bounded image previews when workers cannot decode image dimensions', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    vi.stubGlobal('Image', undefined);
    const image = new File([new Uint8Array([137, 80, 78, 71])], 'synthetic.png', { type: 'image/png' });
    const [draft] = await buildEvidenceItemDrafts(image);
    expect(draft.fileType).toBe('image');
    expect(draft.imageData).toBe('iVBORw==');
    expect(draft.extractionWarning).toContain('Image dimensions could not be read');
  });

  it('closes decoded image resources and rejects pixel dimensions beyond the supported bound', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 8192, height: 8192, close }));
    await expect(buildEvidenceItemDrafts(new File(['synthetic'], 'large.png', { type: 'image/png' }))).rejects.toThrow('32 million pixels');
    expect(close).toHaveBeenCalledOnce();
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
    await expect(buildEvidenceItemDrafts(docx([{ name: 'word/document.xml', data: documentXml, declared: oversized.length }]))).rejects.toThrow('declared content');
    await expect(buildEvidenceItemDrafts(docx([{ name: 'word/document.xml', data: oversized, declared: 1 }]))).rejects.toThrow('decoded part exceeds 8 MiB');
  });

  it('enforces an aggregate decoded budget across individually permitted selected parts', async () => {
    const part = new Uint8Array(7 * 1024 * 1024);
    const compressed = deflateRaw(part);
    const entries = Array.from({ length: 5 }, (_, index) => ({ name: `word/header${index + 1}.xml`, data: part, compressed }));
    await expect(buildEvidenceItemDrafts(docx(entries))).rejects.toThrow('decoded byte limit');
  });

  it('rejects oversized central-directory entry counts before walking them', async () => {
    const bytes = zip([]);
    const view = new DataView(bytes.buffer);
    view.setUint16(8, EVIDENCE_LIMITS.entries + 1, true); view.setUint16(10, EVIDENCE_LIMITS.entries + 1, true);
    await expect(buildEvidenceItemDrafts(new File([bytes], 'entries.docx'))).rejects.toThrow('2048 entries');
  });

  it('rejects corrupt selected ZIP entries instead of returning a successful empty draft', async () => {
    await expect(buildEvidenceItemDrafts(docx([{ name: 'word/document.xml', data: documentXml, compressed: encode('invalid deflate') }]))).rejects.toThrow('DOCX archive is invalid');
    await expect(buildEvidenceItemDrafts(docx([{ name: 'word/document.xml', data: documentXml, declared: 1 }]))).rejects.toThrow('DOCX archive is invalid');
  });

  it.each([deflateRaw, deflate])('retains normal compressed PDF text and bounds actual output', async compress => {
    const normal = encode('BT\n/F1 12 Tf\n(Synthetic report with useful investigation details.) Tj\nET');
    const [draft] = await buildEvidenceItemDrafts(pdf(compress(normal)));
    expect(draft.content).toContain('Synthetic report with useful investigation details.');
    await expect(buildEvidenceItemDrafts(pdf(compress(new Uint8Array(EVIDENCE_LIMITS.entryBytes + 1))))).rejects.toThrow('8 MiB');
  });

  it('bounds PDF stream count independently of file size', async () => {
    const file = new File(['%PDF-1.4\n' + '<<>>\nstream\nx\nendstream\n'.repeat(EVIDENCE_LIMITS.entries + 1)], 'many.pdf');
    await expect(buildEvidenceItemDrafts(file)).rejects.toThrow('too many PDF streams');
  });

  it('rejects sparse XLSX amplification while preserving ordinary cell extraction', async () => {
    const file = (cells: string) => new File([zip([{ name: 'xl/worksheets/sheet1.xml', data: encode(`<worksheet><row>${cells}</row></worksheet>`) }])], 'sheet.xlsx');
    const [normal] = await buildEvidenceItemDrafts(file('<c r="A1" t="inlineStr"><is><t>Normal cell</t></is></c>'));
    expect(normal.content).toContain('Normal cell');
    await expect(buildEvidenceItemDrafts(file('<c r="ZZZZZZ1" t="inlineStr"><is><t>Sparse</t></is></c>'))).rejects.toThrow('spreadsheet dimensions');
    const rows = '<row><c r="XFD1" t="inlineStr"><is><t>Wide</t></is></c></row>'.repeat(16);
    await expect(buildEvidenceItemDrafts(new File([zip([{ name: 'xl/worksheets/sheet1.xml', data: encode(`<worksheet>${rows}</worksheet>`) }])], 'wide.xlsx'))).rejects.toThrow('spreadsheet dimensions');
  });
});
