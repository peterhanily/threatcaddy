import { describe, expect, it } from 'vitest';
import { deflate, deflateRaw } from 'pako';
import { buildEvidenceItemDrafts } from '../lib/evidence-import';
import { EVIDENCE_LIMITS } from '../lib/evidence-import-limits';

// Ordinary documents, shaped the way Office, LibreOffice and PDF producers write
// them, must import. Bomb shapes are covered in evidence-import-limits.test.ts.
const encode = (text: string) => new TextEncoder().encode(text);
type Part = { name: string; data: Uint8Array; stored?: boolean };

function officeZip(parts: Part[]): Uint8Array<ArrayBuffer> {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const part of parts) {
    const name = encode(part.name);
    const body = part.stored ? part.data : deflateRaw(part.data);
    const method = part.stored ? 0 : 8;
    const header = new Uint8Array(30); const lv = new DataView(header.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(8, method, true);
    lv.setUint32(18, body.length, true); lv.setUint32(22, part.data.length, true); lv.setUint16(26, name.length, true);
    local.push(header, name, body);
    const entry = new Uint8Array(46); const cv = new DataView(entry.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(10, method, true);
    cv.setUint32(20, body.length, true); cv.setUint32(24, part.data.length, true);
    cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true);
    central.push(entry, name);
    offset += header.length + name.length + body.length;
  }
  const end = new Uint8Array(22); const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, parts.length, true); ev.setUint16(10, parts.length, true);
  ev.setUint32(12, central.reduce((sum, chunk) => sum + chunk.length, 0), true); ev.setUint32(16, offset, true);
  return concat([...local, ...central, end]);
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

function sharedStrings(values: string[]): Part {
  return { name: 'xl/sharedStrings.xml', data: encode(`<sst count="${values.length}">${values.map(value => `<si><t>${value}</t></si>`).join('')}</sst>`) };
}

function workbook(sheetXml: string, strings: string[] = []): File {
  return new File([officeZip([
    { name: 'xl/workbook.xml', data: encode('<workbook><sheets><sheet name="Hosts" sheetId="1" r:id="rId1"/></sheets></workbook>') },
    { name: 'xl/_rels/workbook.xml.rels', data: encode('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>') },
    { name: 'xl/worksheets/sheet1.xml', data: encode(`<worksheet><sheetData>${sheetXml}</sheetData></worksheet>`) },
    { name: 'xl/styles.xml', data: encode('<styleSheet/>') },
    sharedStrings(strings),
  ])], 'hosts.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

const extractedText = (content: string) => content.split('## Extracted Text\n\n')[1] ?? '';

describe('text normalisation', () => {
  it('trims padded line ends and stays linear on long whitespace runs', async () => {
    const [padded] = await buildEvidenceItemDrafts(new File(['alpha \t \nbeta\t\r\ngamma   delta'], 'padded.log'));
    expect(extractedText(padded.content)).toBe('alpha\nbeta\ngamma  delta');
    const run = new File([`start${'\t'.repeat(200_000)}end\n${' '.repeat(200_000)}x`], 'columns.log');
    const started = performance.now();
    const [draft] = await buildEvidenceItemDrafts(run);
    // The quadratic pattern needed many seconds here; the linear one needs milliseconds.
    expect(performance.now() - started).toBeLessThan(1_500);
    expect(extractedText(draft.content)).toBe('start  end\n  x');
  });
});

// PDF objects laid out the way Skia (Chrome print-to-PDF) writes them.
type PdfObject = { dict: string; data: Uint8Array };
function pdf(objects: PdfObject[]): File {
  const parts: Uint8Array[] = [encode('%PDF-1.7\n%\xb5\xb5\n')];
  objects.forEach((object, index) => {
    parts.push(encode(`${index + 1} 0 obj\n<<${object.dict}\n/Length ${object.data.length}>> stream\n`), object.data, encode('\nendstream\nendobj\n'));
  });
  parts.push(encode('trailer\n<</Root 1 0 R>>\n%%EOF'));
  return new File([concat(parts)], 'report.pdf', { type: 'application/pdf' });
}
const content = (text: string): PdfObject => ({ dict: '/Filter /FlateDecode', data: deflate(encode(text)) });
const summary = content('BT /F1 12 Tf 72 712 Td (Incident summary for host dc01.corp.example) Tj ET');
// Pixel data that would read as a text object if it were ever decoded. The
// marker ends in whitespace: NUL is not a token boundary for the parser.
const pixels = (size: number) => {
  const bytes = new Uint8Array(size);
  bytes.set(encode('BT (decoded image pixels) Tj ET\n'));
  return deflate(bytes);
};
const retina = pixels(2880 * 1800 * 3);
const fullHd = pixels(1920 * 1080 * 3);
const skiaImage = (data: Uint8Array, width: number, height: number): PdfObject => ({
  dict: `/Type /XObject\n/Subtype /Image\n/Width ${width}\n/Height ${height}\n/ColorSpace [/ICCBased 2 0 R]\n/BitsPerComponent 8\n/Filter /FlateDecode`,
  data,
});
const iccProfile: PdfObject = { dict: '/N 3\n/Filter /FlateDecode', data: deflate(new Uint8Array(3144)) };
const fontProgram: PdfObject = { dict: '/Length1 12224\n/Filter /FlateDecode', data: deflate(encode('BT (font program bytes) Tj ET'.padEnd(12224, ' '))) };

describe('PDF reports with screenshots and many pages', () => {
  it('imports a print-to-PDF report holding one lossless retina screenshot without decoding the image', async () => {
    const [draft] = await buildEvidenceItemDrafts(pdf([summary, iccProfile, skiaImage(retina, 2880, 1800), fontProgram]));
    expect(draft.extractionStatus).toBe('partial');
    expect(draft.content).toContain('Incident summary for host dc01.corp.example');
    expect(draft.content).not.toContain('decoded image pixels');
    expect(draft.content).not.toContain('font program bytes');
    expect(draft.extractionWarning).not.toContain('stopped at the decoding limit');
  });

  it('finds the image dictionary when a nested /DecodeParms dictionary precedes the stream', async () => {
    const image = { dict: '/Type /XObject /Subtype /Image /Width 2880 /Height 1800 /ColorSpace /DeviceRGB /BitsPerComponent 8 /DecodeParms << /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns 2880 >> /Filter /FlateDecode', data: retina };
    const [draft] = await buildEvidenceItemDrafts(pdf([image, summary]));
    expect(draft.content).toContain('Incident summary for host dc01.corp.example');
    expect(draft.content).not.toContain('decoded image pixels');
    expect(draft.extractionWarning).not.toContain('stopped at the decoding limit');
  });

  it('imports reports whose screenshots together decode past the document budget', async () => {
    const images = Array.from({ length: 6 }, () => skiaImage(fullHd, 1920, 1080));
    const [draft] = await buildEvidenceItemDrafts(pdf([summary, ...images]));
    expect(draft.extractionStatus).toBe('partial');
    expect(draft.content).toContain('Incident summary for host dc01.corp.example');
    expect(draft.content).not.toContain('decoded image pixels');
    expect(draft.extractionWarning).not.toContain('stopped at the decoding limit');
  });

  it('skips large JPEG and other image-codec streams without charging the budget', async () => {
    const jpeg = { dict: '/Type /XObject /Subtype /Image /Width 3000 /Height 3000 /Filter /DCTDecode', data: new Uint8Array(9 * 1024 * 1024).fill(0xff) };
    const unlabelled = { dict: '/Filter [/FlateDecode /DCTDecode]', data: deflate(encode('BT (unlabelled codec) Tj ET')) };
    const [draft] = await buildEvidenceItemDrafts(pdf([jpeg, unlabelled, summary]));
    expect(draft.extractionStatus).toBe('partial');
    expect(draft.content).toContain('Incident summary for host dc01.corp.example');
    expect(draft.content).not.toContain('unlabelled codec');
    expect(draft.extractionWarning).not.toContain('stopped at the decoding limit');
  });

  it('returns the pages read so far, with a warning, when the stream count runs out', async () => {
    const pages = Array.from({ length: EVIDENCE_LIMITS.entries + 52 }, (_, index) =>
      ({ dict: '', data: encode(`BT (Page ${index + 1} lists host${index + 1}.corp.example for review) Tj ET`) }));
    const [draft] = await buildEvidenceItemDrafts(pdf(pages));
    expect(draft.extractionStatus).toBe('partial');
    expect(draft.content).toContain('Page 1 lists host1.corp.example');
    expect(draft.content).toContain(`Page ${EVIDENCE_LIMITS.entries} lists`);
    expect(draft.content).not.toContain(`Page ${EVIDENCE_LIMITS.entries + 1} lists`);
    expect(draft.extractionWarning).toContain('stopped at the decoding limit');
  });

  it('stops decoding inside an oversized content stream and keeps the text before the cut', async () => {
    const text = `BT (Opening paragraph of the report) Tj ET${' '.repeat(EVIDENCE_LIMITS.entryBytes)}BT (Text past the part limit) Tj ET`;
    const [draft] = await buildEvidenceItemDrafts(pdf([content(text)]));
    expect(draft.extractionStatus).toBe('partial');
    expect(draft.content).toContain('Opening paragraph of the report');
    expect(draft.content).not.toContain('Text past the part limit');
    expect(draft.extractionWarning).toContain('stopped at the decoding limit');
  });

  it('stops at the document budget and skips later streams', async () => {
    const large = deflate(encode(`BT (Early drawing commands) Tj ET${' '.repeat(Math.floor(EVIDENCE_LIMITS.entryBytes * 0.9))}`));
    const streams = Array.from({ length: 5 }, () => ({ dict: '/Filter /FlateDecode', data: large }));
    const [draft] = await buildEvidenceItemDrafts(pdf([...streams, content('BT (Late appendix marker) Tj ET')]));
    expect(draft.content).toContain('Early drawing commands');
    expect(draft.content).not.toContain('Late appendix marker');
    expect(draft.extractionWarning).toContain('stopped at the decoding limit');
  });
});

describe('large and unreadable Office files', () => {
  it('imports the first rows of a 30,000-row workbook as partial instead of failing', async () => {
    const rows = Array.from({ length: 30_000 }, (_, r) =>
      `<row r="${r + 1}">${Array.from({ length: 10 }, (_, c) => `<c r="${String.fromCharCode(65 + c)}${r + 1}"><v>${r * 10 + c}</v></c>`).join('')}</row>`).join('');
    const [draft] = await buildEvidenceItemDrafts(workbook(rows));
    expect(draft.extractionStatus).toBe('partial');
    expect(draft.content).toContain('0\t1\t2\t3\t4\t5\t6\t7\t8\t9');
    expect(draft.extractionWarning).toContain('was not read');
  });

  it('counts self-closing cells toward the cell budget', async () => {
    const empty = Array.from({ length: 10 }, (_, c) => `<c r="${String.fromCharCode(65 + c)}1" s="1"/>`).join('');
    const rows = `<row r="1"><c r="A1" t="inlineStr"><is><t>HEAD</t></is></c></row>${`<row>${empty}</row>`.repeat(EVIDENCE_LIMITS.spreadsheetCells / 10)}<row><c r="A2" t="inlineStr"><is><t>TAIL</t></is></c></row>`;
    const [draft] = await buildEvidenceItemDrafts(workbook(rows));
    expect(draft.extractionStatus).toBe('partial');
    expect(draft.content).toContain('HEAD');
    expect(draft.content).not.toContain('TAIL');
  });

  it.each([
    // Encrypted OOXML is an OLE compound file, not a ZIP archive.
    ['password-protected.docx', () => concat([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), new Uint8Array(4096)])],
    ['truncated-download.xlsx', () => officeZip([{ name: 'xl/worksheets/sheet1.xml', data: encode('<worksheet><sheetData><row><c><v>1</v></c></row></sheetData></worksheet>') }]).slice(0, 60)],
    ['damaged.docx', () => {
      const zip = officeZip([{ name: 'word/document.xml', data: encode('<w:p><w:t>damaged</w:t></w:p>') }]);
      zip.set([0xff, 0xff, 0xff, 0xff], 30 + 'word/document.xml'.length);
      return zip;
    }],
  ])('imports %s as metadata-only instead of failing the batch', async (name, bytes) => {
    const [draft] = await buildEvidenceItemDrafts(new File([bytes()], name));
    expect(draft.extractionStatus).toBe('metadata-only');
    expect(draft.extractionWarning).toContain('not a readable');
    expect(draft.fileName).toBe(name);
  });

  it('reads an archive with bytes after its end record', async () => {
    const zip = officeZip([{ name: 'word/document.xml', data: encode('<w:document><w:p><w:r><w:t>Appended bytes are ignored.</w:t></w:r></w:p></w:document>') }]);
    const [draft] = await buildEvidenceItemDrafts(new File([concat([zip, new Uint8Array(512)])], 'trailing.docx'));
    expect(draft.extractionStatus).toBe('extracted');
    expect(draft.content).toContain('Appended bytes are ignored.');
  });

  it('imports an archive with ZIP64 size markers as metadata-only', async () => {
    const zip = officeZip([{ name: 'word/document.xml', data: encode('<w:p><w:t>zip64</w:t></w:p>') }]);
    const centralStart = zip.length - 22 - 46 - 'word/document.xml'.length;
    new DataView(zip.buffer).setUint32(centralStart + 20, 0xffffffff, true);
    new DataView(zip.buffer).setUint32(centralStart + 24, 0xffffffff, true);
    const [draft] = await buildEvidenceItemDrafts(new File([zip], 'zip64.docx'));
    expect(draft.extractionStatus).toBe('metadata-only');
    expect(draft.extractionWarning).toContain('not a readable');
  });
});

describe('XLSX cells written by spreadsheet producers', () => {
  it('keeps columns and shared-string values when styled empty cells are self-closing', async () => {
    const strings = ['Hostname', 'Owner', 'IP address', 'alice', '10.1.2.3', 'dc01.corp.example', 'row'];
    const rows = [
      '<row r="1" spans="1:3"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>',
      '<row r="2" spans="1:3"><c r="A2" s="3"/><c r="B2" t="s"><v>3</v></c><c r="C2" t="s"><v>4</v></c></row>',
      '<row r="3" spans="1:3"><c r="A3" t="s"><v>5</v></c><c r="B3" s="3" /><c r="C3" t="inlineStr"><is><t>10.1.2.3</t></is></c></row>',
      '<row r="4" spans="1:3"><c r="A4"><v>42</v></c><c r="B4" t="s"><v>3</v></c><c r="C4" s="3"/></row>',
      '<row r="5" spans="1:3" s="2" customFormat="1"/>',
      '<row r="6" spans="1:3"><c r="A6" t="inlineStr"><is><t>after</t></is></c><c r="B6" t="s"><v>6</v></c></row>',
    ].join('');
    const [draft] = await buildEvidenceItemDrafts(workbook(rows, strings));
    expect(draft.extractionStatus).toBe('extracted');
    expect(extractedText(draft.content)).toBe([
      '## Hosts',
      '',
      'Hostname\tOwner\tIP address',
      '\talice\t10.1.2.3',
      'dc01.corp.example\t\t10.1.2.3',
      '42\talice',
      'after\trow',
    ].join('\n'));
  });
});
