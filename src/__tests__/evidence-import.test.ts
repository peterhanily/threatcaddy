import { describe, expect, it } from 'vitest';
import {
  buildEvidenceItemDrafts,
  evidenceFileKeyFromFile,
  evidenceFileKeyFromItem,
  findDuplicateEvidenceItemIds,
  MAX_EVIDENCE_IMPORT_FILES,
} from '../lib/evidence-import';
import { extractEvidenceTableIOCCandidates } from '../lib/evidence-ioc-candidates';
import type { EvidenceItem } from '../types';

function makeEvidenceItem(overrides: Partial<EvidenceItem> & { id: string }): EvidenceItem {
  const { id, ...rest } = overrides;
  return {
    id,
    title: 'evidence.txt',
    folderId: 'folder-1',
    fileName: 'evidence.txt',
    fileType: 'text',
    size: 12,
    lastModified: 1000,
    content: '# Evidence\n\nbody',
    extractionStatus: 'extracted',
    importedAt: 100,
    chunkIndex: 1,
    chunkCount: 1,
    tags: ['evidence'],
    trashed: false,
    archived: false,
    createdAt: 100,
    updatedAt: 100,
    ...rest,
  };
}

describe('evidence import helpers', () => {
  it('exposes a small-batch import cap', () => {
    expect(MAX_EVIDENCE_IMPORT_FILES).toBe(20);
  });

  it('builds comparable file keys for selected files and stored items', () => {
    const file = new File(['x'], 'Evidence.TXT', { type: 'text/plain', lastModified: 1234 });

    expect(evidenceFileKeyFromFile(file)).toBe('evidence.txt|1|1234');
    expect(evidenceFileKeyFromItem({
      folderId: 'folder-1',
      fileName: 'Evidence.TXT',
      size: 1,
      lastModified: 1234,
    })).toBe('folder-1|evidence.txt|1|1234');
  });

  it('finds exact duplicate evidence chunks without collapsing multipart siblings', () => {
    const duplicateOriginal = makeEvidenceItem({ id: 'original', importedAt: 100, createdAt: 100 });
    const duplicateLater = makeEvidenceItem({ id: 'later', importedAt: 200, createdAt: 200 });
    const secondChunk = makeEvidenceItem({
      id: 'chunk-2',
      content: '# Evidence\n\nbody part 2',
      chunkIndex: 2,
      chunkCount: 2,
      importedAt: 200,
      createdAt: 200,
    });

    expect(findDuplicateEvidenceItemIds([duplicateOriginal, duplicateLater, secondChunk], 'folder-1')).toEqual(['later']);
  });

  it('keeps the richer duplicate when linked IOCs differ', () => {
    const linked = makeEvidenceItem({ id: 'linked', linkedIOCIds: ['ioc-1'], importedAt: 200, createdAt: 200 });
    const plain = makeEvidenceItem({ id: 'plain', importedAt: 100, createdAt: 100 });

    expect(findDuplicateEvidenceItemIds([plain, linked], 'folder-1')).toEqual(['plain']);
  });

  it('keeps enriched image duplicates over plainer copies', () => {
    const enriched = makeEvidenceItem({
      id: 'enriched',
      imageAnalysis: 'Screenshot shows credential prompt.',
      imageOcrText: 'Enter password',
      imageData: 'data:image/png;base64,abc',
      importedAt: 200,
      createdAt: 200,
    });
    const plain = makeEvidenceItem({ id: 'plain', importedAt: 100, createdAt: 100 });

    expect(findDuplicateEvidenceItemIds([plain, enriched], 'folder-1')).toEqual(['plain']);
  });

  it('extracts readable text from PDF text objects', async () => {
    const file = new File([
      makePdfWithStream('BT\n/F1 12 Tf\n(Confidential report for Weaponized Clipboard) Tj\nET'),
    ], 'report.pdf', { type: 'application/pdf', lastModified: 1234 });

    const drafts = await buildEvidenceItemDrafts(file, { importedAt: 100 });

    expect(drafts).toHaveLength(1);
    expect(drafts[0].extractionStatus).toBe('partial');
    expect(drafts[0].content).toContain('Confidential report for Weaponized Clipboard');
  });

  it('rejects garbled PDF text streams instead of importing junk', async () => {
    const garbage = [
      'BT',
      '/F1 12 Tf',
      '(pppppppppppppppppppppppppppppppppppppppppppppppppppppppp) Tj',
      '(ÿþÿþúúúúýýýýþþþþ) Tj',
      'ET',
    ].join('\n');
    const file = new File([makePdfWithStream(garbage)], 'encoded.pdf', { type: 'application/pdf', lastModified: 1234 });

    const drafts = await buildEvidenceItemDrafts(file, { importedAt: 100 });

    expect(drafts).toHaveLength(1);
    expect(drafts[0].extractionStatus).toBe('metadata-only');
    expect(drafts[0].content).toContain('PDF text streams were detected but rejected');
    expect(drafts[0].content).not.toContain('pppppppppppppppppppppppp');
  });

  it('warns when DOCX evidence contains tables, charts, or embedded media', async () => {
    const zip = makeStoredZip({
      'word/document.xml': [
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
        '<w:body>',
        '<w:p><w:r><w:t>Executive Summary</w:t></w:r></w:p>',
        '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Actor</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
        '<w:p><w:r><w:drawing /></w:r></w:p>',
        '</w:body>',
        '</w:document>',
      ].join(''),
      'word/charts/chart1.xml': '<c:chartSpace />',
      'word/media/image1.png': 'not-a-real-image',
    });
    const file = new File([zip.buffer as ArrayBuffer], 'report.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      lastModified: 1234,
    });

    const drafts = await buildEvidenceItemDrafts(file, { importedAt: 100 });

    expect(drafts).toHaveLength(1);
    expect(drafts[0].extractionStatus).toBe('extracted');
    expect(drafts[0].content).toContain('Executive Summary');
    expect(drafts[0].content).toContain('DOCX extraction captures paragraph text');
    expect(drafts[0].content).toContain('1 embedded table');
    expect(drafts[0].content).toContain('1 embedded chart');
    expect(drafts[0].content).toContain('1 embedded media object');
  });

  it('extracts IOC candidates with row context from evidence tables', () => {
    const content = [
      '# Evidence: indicators.csv',
      '',
      '## Extracted Text',
      '',
      '## Sheet 1',
      '',
      'IP\tDescription\tNotes',
      '203.0.113.44\tC2 server\tObserved in beacon table',
      'evil.example.com\tPayload domain\tNeeds validation',
    ].join('\n');

    const candidates = extractEvidenceTableIOCCandidates(content);

    expect(candidates.map((candidate) => `${candidate.type}:${candidate.value}`)).toEqual([
      'ipv4:203.0.113.44',
      'domain:evil.example.com',
    ]);
    expect(candidates[0].notes).toContain('Description: C2 server');
    expect(candidates[0].notes).toContain('Notes: Observed in beacon table');
  });

  it('builds table IOC candidates quickly when a row holds a long undelimited blob', () => {
    const blob = Array.from({ length: 100_000 }, (_, i) => '0123456789abcdef'[(i * 7) % 16]).join('');
    const content = [
      '# Evidence: blobs.csv',
      '',
      '## Extracted Text',
      '',
      'IP\tPayload',
      `203.0.113.44\t${blob}`,
    ].join('\n');
    const started = performance.now();
    const candidates = extractEvidenceTableIOCCandidates(content);
    // The Evidence view runs this on the main thread for the selected item.
    expect(performance.now() - started).toBeLessThan(1_500);
    expect(candidates.map((candidate) => `${candidate.type}:${candidate.value}`)).toEqual(['ipv4:203.0.113.44']);
  });
});

function makePdfWithStream(stream: string): string {
  return [
    '%PDF-1.4',
    '1 0 obj',
    `<< /Length ${stream.length} >>`,
    'stream',
    stream,
    'endstream',
    'endobj',
    '%%EOF',
  ].join('\n');
}

function makeStoredZip(entries: Record<string, string>): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const centralDirectory: Uint8Array[] = [];
  let offset = 0;

  for (const [name, value] of Object.entries(entries)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(value);
    const localHeader = new Uint8Array(30);
    writeU32(localHeader, 0, 0x04034b50);
    writeU16(localHeader, 4, 20);
    writeU16(localHeader, 8, 0);
    writeU32(localHeader, 18, data.length);
    writeU32(localHeader, 22, data.length);
    writeU16(localHeader, 26, nameBytes.length);

    chunks.push(localHeader, nameBytes, data);

    const centralHeader = new Uint8Array(46);
    writeU32(centralHeader, 0, 0x02014b50);
    writeU16(centralHeader, 4, 20);
    writeU16(centralHeader, 6, 20);
    writeU16(centralHeader, 10, 0);
    writeU32(centralHeader, 20, data.length);
    writeU32(centralHeader, 24, data.length);
    writeU16(centralHeader, 28, nameBytes.length);
    writeU32(centralHeader, 42, offset);
    centralDirectory.push(centralHeader, nameBytes);

    offset += localHeader.length + nameBytes.length + data.length;
  }

  const centralOffset = offset;
  const centralSize = centralDirectory.reduce((sum, chunk) => sum + chunk.length, 0);
  const eocd = new Uint8Array(22);
  writeU32(eocd, 0, 0x06054b50);
  writeU16(eocd, 8, Object.keys(entries).length);
  writeU16(eocd, 10, Object.keys(entries).length);
  writeU32(eocd, 12, centralSize);
  writeU32(eocd, 16, centralOffset);

  return concatBytes([...chunks, ...centralDirectory, eocd]);
}

function writeU16(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
}

function writeU32(bytes: Uint8Array, offset: number, value: number) {
  writeU16(bytes, offset, value & 0xffff);
  writeU16(bytes, offset + 2, (value >> 16) & 0xffff);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
