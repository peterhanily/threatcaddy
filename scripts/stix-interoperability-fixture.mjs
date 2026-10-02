// Pipe to stix2_validator 3.2.0 --version 2.1 --disable 270.
// Uses only harmless reserved example indicators; never reads a workspace DB.
import { createServer } from 'vite';
const server = await createServer({ logLevel: 'silent', server: { middlewareMode: true } });
try {
  const { formatIOCsSTIX } = await server.ssrLoadModule('/src/lib/stix-export.ts');
  const samples = [
    ['ipv4', '192.0.2.1'], ['ipv6', '2001:db8::1'], ['domain', 'example.test'],
    ['url', 'https://example.test/sample'], ['email', 'analyst@example.test'],
    ['md5', 'a'.repeat(32)], ['sha1', 'b'.repeat(40)], ['sha256', 'c'.repeat(64)],
    ['file-path', "C:\\Users\\Analyst's files\\sample.txt"], ['mitre-attack', 'T1566.001'],
    ['cve', 'CVE-2025-12345'], ['yara-rule', 'rule sample { condition: true }'],
    ['sigma-rule', 'title: Example\nlogsource:\n  category: process_creation\ndetection:\n  selection:\n    Image: example\n  condition: selection'],
  ];
  const levels = ['TLP:CLEAR', 'TLP:GREEN', 'TLP:AMBER', 'TLP:AMBER+STRICT', 'TLP:RED'];
  process.stdout.write(formatIOCsSTIX([{ clipTitle: 'Harmless interoperability fixture', iocs: samples.map(([type, value], i) => ({
    id: String(i), type, value, confidence: 'high', firstSeen: 1700000000000, dismissed: false,
    analystNotes: 'Harmless test fixture', clsLevel: levels[i % levels.length],
  })) }]));
} finally {
  await server.close();
}
