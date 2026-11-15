import { deflateRawSync } from 'node:zlib';
import { expect, type Page } from '@playwright/test';
import { createInvestigation } from './fixtures';
import { readRows } from './client-lifecycle-fixtures';

/** A real one-part ZIP with CRC and directory records, including a deliberately
 * understated decoded size for the adversarial decompression regression. */
export function evidenceDocx(content = 'Synthetic bounded evidence.', oversize = false): Buffer {
  const name = Buffer.from('word/document.xml');
  const data = Buffer.from(`<w:document><w:p><w:r><w:t>${oversize ? 'x'.repeat(8 * 1024 * 1024 + 1) : content}</w:t></w:r></w:p></w:document>`);
  const compressed = deflateRawSync(data);
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(oversize ? 1 : data.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(oversize ? 1 : data.length, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + compressed.length, 16);
  return Buffer.concat([local, name, compressed, central, name, end]);
}

export async function openEvidenceCase(page: Page) {
  await createInvestigation(page, 'Synthetic evidence worker case');
  await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: 'Evidence', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Evidence', exact: true })).toBeVisible();
}

export async function importOrdinaryDocx(page: Page) {
  await page.locator('#main-content input[type="file"]').setInputFiles({
    name: 'synthetic.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: evidenceDocx(),
  });
  await expect.poll(async () => (await readRows(page, ['evidenceItems'])).evidenceItems.length).toBe(1);
  const imported = (await readRows(page, ['evidenceItems'])).evidenceItems[0];
  expect(imported).toMatchObject({ fileName: 'synthetic.docx', extractionStatus: 'extracted' });
  expect(imported.content).toEqual(expect.stringContaining('## Extracted Text\n\nSynthetic bounded evidence.'));
}
