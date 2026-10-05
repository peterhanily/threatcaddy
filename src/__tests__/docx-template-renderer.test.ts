import { describe, expect, it } from 'vitest';
import { buildTemplateBackedDocxBytes, extractDocxTemplateProfile } from '../lib/docx-template-renderer';

describe('docx template renderer', () => {
  it('replaces the main document body while preserving section furniture', () => {
    const template = buildStoredZip([
      {
        path: '[Content_Types].xml',
        content: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
      },
      {
        path: 'word/document.xml',
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p><w:r><w:t>Old template content</w:t></w:r></w:p>
    <w:tbl><w:tblPr><w:tblStyle w:val="BaselineTable"/><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tr><w:tc><w:p><w:r><w:t>Old table</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    <w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>
  </w:body>
</w:document>`,
      },
      {
        path: 'word/header1.xml',
        content: '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Confidential - Restricted</w:t></w:r></w:p></w:hdr>',
      },
    ]);
    const rendered = buildTemplateBackedDocxBytes(template, [
      '# Seedworm Intrusion Activity',
      '',
      'Analyst-ready executive summary.',
      '',
      '## Selected Indicators',
      '',
      '| Type | Value |',
      '| --- | --- |',
      '| domain | timetrakr.cloud |',
    ].join('\n'));
    const documentXml = readZipText(rendered, 'word/document.xml');
    const headerXml = readZipText(rendered, 'word/header1.xml');

    expect(documentXml).toContain('Seedworm Intrusion Activity');
    expect(documentXml).toContain('Analyst-ready executive summary.');
    expect(documentXml).toContain('Selected Indicators');
    expect(documentXml).toContain('timetrakr.cloud');
    expect(documentXml).toContain('BaselineTable');
    expect(documentXml).toContain('rIdHeader');
    expect(documentXml).not.toContain('Old template content');
    expect(headerXml).toContain('Confidential - Restricted');
  });

  it.each([1, 2])('uses Intel Note role anchors and superscript markers with %i source(s)', (sourceCount) => {
    const template = buildStoredZip([
      {
        path: '[Content_Types].xml',
        content: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
      },
      {
        path: 'word/document.xml',
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p><w:r><w:t>Classification: TLP Amber</w:t></w:r></w:p>
    <w:p><w:r><w:t>Date: 21 May 2026</w:t></w:r></w:p>
    <w:p><w:r><w:t>Executive Summary</w:t></w:r></w:p>
    <w:p><w:r><w:t>OLD TRIFLECK EXECUTIVE TEXT</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Recent Activity</w:t></w:r></w:p>
    <w:p><w:r><w:t>OLD RECENT ACTIVITY</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Timeline of Significant Events</w:t></w:r></w:p>
    <w:p><w:r><w:t>Table 1: Timeline of Significant Events</w:t></w:r></w:p>
    <w:tbl><w:tblPr><w:tblStyle w:val="IntelTimeline"/><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tr><w:tc><w:p><w:r><w:t>Old event</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    <w:p><w:pPr><w:pStyle w:val="Heading1-Firstheading"/></w:pPr><w:r><w:t>Digital Identifiers</w:t></w:r></w:p>
    <w:p><w:r><w:t>Table 3: Actionable Digital Identifiers</w:t></w:r></w:p>
    <w:tbl><w:tblPr><w:tblStyle w:val="IntelIocs"/><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tr><w:tc><w:p><w:r><w:t>Old IOC</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Recommendations</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="ListBullet"/></w:pPr><w:r><w:t>OLD RECOMMENDATION</w:t></w:r></w:p>
    <w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/></w:sectPr>
  </w:body>
</w:document>`,
      },
      {
        path: 'word/footnotes.xml',
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>
  <w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>
  <w:footnote w:id="1"><w:p><w:r><w:t>OLD SOURCE FOOTNOTE</w:t></w:r></w:p></w:footnote>
</w:footnotes>`,
      },
    ]);
    const profile = extractDocxTemplateProfile(template);

    expect(profile.anchors.executiveSummary).toBe(true);
    expect(profile.anchors.digitalIdentifiers).toBe(true);
    expect(profile.tableCount).toBe(2);
    expect(profile.tableStyles).toContain('IntelIocs');

    const rendered = buildTemplateBackedDocxBytes(template, [
      '# Seedworm Intrusion Activity Targeting South Korean Electronics Sector',
      '',
      '**Classification:** TLP:AMBER',
      '**Date:** 25 May 2026',
      '',
      '## Executive Summary',
      '',
      'Vendor reporting described a February 2026 intrusion affecting a major South Korean electronics manufacturer.',
      '',
      '## Recent Activity',
      '',
      'Official source seed count: 16. Enriched seed count: 16.',
      '',
      '## Timeline of Significant Events',
      '',
      '| Date | Event | Source | Conf. |',
      '| --- | --- | --- | --- |',
      '| 2026-02 | Intrusion window reported | Symantec | medium |',
      '',
      '## Actionable Digital Identifiers',
      '',
      '| Type | Value | Description | Confidence |',
      '| --- | --- | --- | --- |',
      '| domain | timetrakr.cloud | Domain used for PowerShell payload retrieval. | medium |',
      '',
      '## Recommendations',
      '',
      '- Hunt exact promoted hashes and domains.',
      '',
      '## Sources',
      '',
      '- Symantec Threat Hunter Team / Security.com. See: https://www.security.com/threat-intelligence/iran-seedworm-electronics',
      sourceCount === 2 ? '- Second source: fictional analyst verification fixture.' : '',
    ].join('\n'), 'intel-note');
    const documentXml = readZipText(rendered, 'word/document.xml');
    const footnotesXml = readZipText(rendered, 'word/footnotes.xml');

    expect(documentXml).toContain('Date: 25 May 2026');
    expect(documentXml).toContain('Vendor reporting described a February 2026 intrusion');
    expect(documentXml).toContain('Official source seed count: 16');
    expect(documentXml).toContain('timetrakr.cloud - Domain used for PowerShell payload retrieval.');
    expect(documentXml).toContain('not live validated');
    expect(documentXml).toContain('<w:gridCol w:w="1000"/>');
    expect(documentXml).toContain('<w:gridCol w:w="1600"/>');
    expect(documentXml).toContain('<w:gridCol w:w="4760"/>');
    expect(documentXml).toContain('<w:gridCol w:w="2000"/>');
    expect(documentXml).toContain('w:ascii="Aptos"');
    expect(documentXml).toContain('<w:sz w:val="21"/>');
    expect(documentXml).toContain('<w:sz w:val="19"/>');
    expect(documentXml).not.toContain('<w:sz w:val="14"/>');
    expect(documentXml).not.toContain('w:fill="F2F2F2"');
    expect(documentXml).toContain('<w:footnoteReference w:id="1"/>');
    if (sourceCount === 2) expect(documentXml).toContain('<w:footnoteReference w:id="2"/>');
    expect(documentXml).not.toContain('w:val="subscript"');
    const parsedDocument = new DOMParser().parseFromString(documentXml, 'application/xml');
    expect(parsedDocument.querySelector('parsererror')).toBeNull();
    const references = parsedDocument.getElementsByTagName('w:footnoteReference');
    expect(references).toHaveLength(sourceCount);
    for (const reference of references) {
      expect(reference.parentElement?.getElementsByTagName('w:vertAlign')[0]?.getAttribute('w:val')).toBe('superscript');
    }
    const separators = [...parsedDocument.getElementsByTagName('w:t')].filter(text => text.textContent === ',');
    expect(separators).toHaveLength(sourceCount - 1);
    for (const separator of separators) {
      expect(separator.parentElement?.getElementsByTagName('w:vertAlign')[0]?.getAttribute('w:val')).toBe('superscript');
    }
    expect(documentXml).toContain('IntelTimeline');
    expect(documentXml).toContain('IntelIocs');
    expect(documentXml).toContain('rIdHeader');
    expect(documentXml).not.toContain('OLD TRIFLECK EXECUTIVE TEXT');
    expect(documentXml).not.toContain('OLD RECENT ACTIVITY');
    expect(documentXml).not.toContain('Old IOC');
    expect(footnotesXml).toContain('Symantec Threat Hunter Team / Security.com');
    expect(footnotesXml).toContain('See: https://www.security.com/threat-intelligence/iran-seedworm-electronics');
    expect(footnotesXml).toContain('<w:vertAlign w:val="superscript"/>');
    expect(footnotesXml).not.toContain('w:val="subscript"');
    const parsedFootnotes = new DOMParser().parseFromString(footnotesXml, 'application/xml');
    expect(parsedFootnotes.querySelector('parsererror')).toBeNull();
    const footnoteNumbers = parsedFootnotes.getElementsByTagName('w:footnoteRef');
    expect(footnoteNumbers).toHaveLength(sourceCount);
    for (const reference of footnoteNumbers) {
      expect(reference.parentElement?.getElementsByTagName('w:vertAlign')[0]?.getAttribute('w:val')).toBe('superscript');
    }
    const sourceTexts = parsedFootnotes.getElementsByTagName('w:t');
    expect(sourceTexts).toHaveLength(sourceCount);
    for (const text of sourceTexts) expect(text.parentElement?.getElementsByTagName('w:vertAlign')).toHaveLength(0);
    expect(footnotesXml).toContain('<w:sz w:val="13"/>');
    expect(footnotesXml).not.toContain('OLD SOURCE FOOTNOTE');
  });
});

function buildStoredZip(files: Array<{ path: string; content: string }>): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.path);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, 0, true);
    local.set(name, 30);
    localParts.push(local, data);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centralParts.push(central);

    offset += local.length + data.length;
  }

  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  return concat([...localParts, ...centralParts, end]);
}

function readZipText(bytes: Uint8Array, path: string): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) !== 0x06054b50) continue;
    const total = view.getUint16(offset + 10, true);
    let centralOffset = view.getUint32(offset + 16, true);
    for (let index = 0; index < total; index += 1) {
      const nameLength = view.getUint16(centralOffset + 28, true);
      const extraLength = view.getUint16(centralOffset + 30, true);
      const commentLength = view.getUint16(centralOffset + 32, true);
      const localOffset = view.getUint32(centralOffset + 42, true);
      const name = new TextDecoder().decode(bytes.slice(centralOffset + 46, centralOffset + 46 + nameLength));
      if (name === path) {
        const localNameLength = view.getUint16(localOffset + 26, true);
        const localExtraLength = view.getUint16(localOffset + 28, true);
        const dataLength = view.getUint32(localOffset + 18, true);
        const dataStart = localOffset + 30 + localNameLength + localExtraLength;
        return new TextDecoder().decode(bytes.slice(dataStart, dataStart + dataLength));
      }
      centralOffset += 46 + nameLength + extraLength + commentLength;
    }
  }
  throw new Error(`Missing ${path}`);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const CRC32_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  return value >>> 0;
});

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
