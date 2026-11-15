import { describe, expect, it } from 'vitest';
import { deflateRaw } from 'pako';
import { buildEvidenceItemDrafts } from '../lib/evidence-import';

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
