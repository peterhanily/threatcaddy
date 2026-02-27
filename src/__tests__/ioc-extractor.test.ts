/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect } from 'vitest';
import { extractIOCs, defang, mergeIOCAnalysis, extractYaraRules, extractSigmaRules } from '../lib/ioc-extractor';
import type { IOCAnalysis, IOCEntry } from '../types';

// ── defang ──────────────────────────────────────────────────────────

describe('defang', () => {
  it('converts hxxp to http', () => {
    expect(defang('hxxp://evil.com')).toBe('http://evil.com');
    expect(defang('hxxps://evil.com')).toBe('https://evil.com');
  });

  it('converts [.] to .', () => {
    expect(defang('evil[.]com')).toBe('evil.com');
  });

  it('converts [@] to @', () => {
    expect(defang('user[@]evil.com')).toBe('user@evil.com');
  });

  it('converts (dot) to .', () => {
    expect(defang('evil(dot)com')).toBe('evil.com');
  });

  it('converts [:] to :', () => {
    expect(defang('http[:]//evil.com')).toBe('http://evil.com');
  });

  it('converts [/] to /', () => {
    expect(defang('http://evil.com[/]path')).toBe('http://evil.com/path');
  });

  it('is case-insensitive for hxxp', () => {
    expect(defang('HXXPS://evil.com')).toBe('HttPS://evil.com');
    expect(defang('HxXp://evil.com')).toBe('Http://evil.com');
  });

  it('is case-insensitive for (dot)', () => {
    expect(defang('evil(DOT)com')).toBe('evil.com');
    expect(defang('evil(Dot)com')).toBe('evil.com');
  });

  it('handles multiple defang patterns in same string', () => {
    expect(defang('hxxps://evil[.]com[/]path')).toBe('https://evil.com/path');
  });

  it('passes through clean text unchanged', () => {
    expect(defang('https://example.com')).toBe('https://example.com');
    expect(defang('just some text')).toBe('just some text');
  });
});

// ── extractIOCs ─────────────────────────────────────────────────────

describe('extractIOCs', () => {
  // -- IPv4 --
  it('extracts IPv4 addresses', () => {
    const result = extractIOCs('The attacker IP was 192.168.1.100 and 10.0.0.1');
    const ipv4s = result.filter((i) => i.type === 'ipv4');
    expect(ipv4s).toHaveLength(2);
    expect(ipv4s.map((i) => i.value)).toContain('192.168.1.100');
    expect(ipv4s.map((i) => i.value)).toContain('10.0.0.1');
  });

  it('skips loopback and broadcast IPs', () => {
    const result = extractIOCs('127.0.0.1 and 0.0.0.0 and 255.255.255.255');
    const ipv4s = result.filter((i) => i.type === 'ipv4');
    expect(ipv4s).toHaveLength(0);
  });

  // -- IPv6 --
  it('extracts IPv6 addresses', () => {
    const result = extractIOCs('Found connection to 2001:0db8:85a3:0000:0000:8a2e:0370:7334');
    const ipv6s = result.filter((i) => i.type === 'ipv6');
    expect(ipv6s).toHaveLength(1);
  });

  // -- Domains --
  it('extracts domains', () => {
    const result = extractIOCs('The C2 server was at malware.evil.com and phishing.xyz');
    const domains = result.filter((i) => i.type === 'domain');
    expect(domains.map((i) => i.value)).toContain('malware.evil.com');
  });

  // -- URLs --
  it('extracts URLs', () => {
    const result = extractIOCs('Downloaded from https://evil.com/payload.exe and http://bad.org/shell');
    const urls = result.filter((i) => i.type === 'url');
    expect(urls).toHaveLength(2);
  });

  it('extracts defanged URLs', () => {
    const result = extractIOCs('C2 at hxxps://evil[.]com/callback');
    const urls = result.filter((i) => i.type === 'url');
    expect(urls).toHaveLength(1);
    expect(urls[0].value).toBe('https://evil.com/callback');
  });

  it('strips trailing punctuation from URLs', () => {
    const result = extractIOCs('Visit https://evil.com/path. Also https://bad.com/page,');
    const urls = result.filter((i) => i.type === 'url');
    expect(urls[0].value).toBe('https://evil.com/path');
    expect(urls[1].value).toBe('https://bad.com/page');
  });

  // -- Emails --
  it('extracts emails', () => {
    const result = extractIOCs('Spear phishing from attacker@evil.com');
    const emails = result.filter((i) => i.type === 'email');
    expect(emails).toHaveLength(1);
    expect(emails[0].value).toBe('attacker@evil.com');
  });

  // -- Hashes --
  it('extracts MD5 hashes', () => {
    const result = extractIOCs('MD5: d41d8cd98f00b204e9800998ecf8427e');
    const md5s = result.filter((i) => i.type === 'md5');
    expect(md5s).toHaveLength(1);
    expect(md5s[0].value).toBe('d41d8cd98f00b204e9800998ecf8427e');
  });

  it('extracts SHA-1 hashes', () => {
    const result = extractIOCs('SHA1: da39a3ee5e6b4b0d3255bfef95601890afd80709');
    const sha1s = result.filter((i) => i.type === 'sha1');
    expect(sha1s).toHaveLength(1);
  });

  it('extracts SHA-256 hashes', () => {
    const result = extractIOCs('SHA256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    const sha256s = result.filter((i) => i.type === 'sha256');
    expect(sha256s).toHaveLength(1);
  });

  it('skips uniform hex strings (false positives)', () => {
    const result = extractIOCs('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    const hashes = result.filter((i) => ['md5', 'sha1', 'sha256'].includes(i.type));
    expect(hashes).toHaveLength(0);
  });

  it('avoids extracting MD5 from SHA-256 substring', () => {
    // A sha256 hash contains a 32-char prefix that looks like an MD5
    const sha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const result = extractIOCs(`Hash: ${sha256}`);
    const sha256s = result.filter((i) => i.type === 'sha256');
    const md5s = result.filter((i) => i.type === 'md5');
    expect(sha256s).toHaveLength(1);
    expect(md5s).toHaveLength(0);
  });

  it('avoids extracting SHA-1 from SHA-256 substring', () => {
    const sha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const result = extractIOCs(`Hash: ${sha256}`);
    const sha1s = result.filter((i) => i.type === 'sha1');
    expect(sha1s).toHaveLength(0);
  });

  // -- CVEs --
  it('extracts CVEs', () => {
    const result = extractIOCs('Vulnerability CVE-2024-12345 was exploited');
    const cves = result.filter((i) => i.type === 'cve');
    expect(cves).toHaveLength(1);
    expect(cves[0].value.toUpperCase()).toBe('CVE-2024-12345');
  });

  it('extracts CVEs case-insensitively', () => {
    const result = extractIOCs('cve-2024-99999');
    const cves = result.filter((i) => i.type === 'cve');
    expect(cves).toHaveLength(1);
  });

  // -- MITRE ATT&CK --
  it('extracts MITRE ATT&CK technique IDs', () => {
    const result = extractIOCs('Used techniques T1059 and T1059.001');
    const mitre = result.filter((i) => i.type === 'mitre-attack');
    expect(mitre).toHaveLength(2);
    expect(mitre.map((i) => i.value)).toContain('T1059');
    expect(mitre.map((i) => i.value)).toContain('T1059.001');
  });

  it('extracts MITRE subtactic IDs (S-prefixed)', () => {
    const result = extractIOCs('Software S0154 was used');
    const mitre = result.filter((i) => i.type === 'mitre-attack');
    expect(mitre).toHaveLength(1);
    expect(mitre[0].value).toBe('S0154');
  });

  // -- YARA/SIGMA --
  it('extracts YARA rule full body', () => {
    const input = 'rule APT_Backdoor_Win32 { meta: author = "analyst" strings: $a = "malware" condition: $a }';
    const result = extractIOCs(input);
    const yara = result.filter((i) => i.type === 'yara-rule');
    expect(yara).toHaveLength(1);
    expect(yara[0].value).toContain('rule APT_Backdoor_Win32');
    expect(yara[0].value).toContain('condition: $a');
    expect(yara[0].value).toContain('}');
  });

  it('extracts SIGMA rules', () => {
    const input = `title: Suspicious PowerShell
logsource:
  product: windows
detection:
  selection:
    CommandLine|contains: '-enc'
  condition: selection`;
    const result = extractIOCs(input);
    const sigma = result.filter((i) => i.type === 'sigma-rule');
    expect(sigma).toHaveLength(1);
    expect(sigma[0].value).toContain('title: Suspicious PowerShell');
    expect(sigma[0].value).toContain('detection:');
  });

  // -- File paths --
  it('extracts file paths', () => {
    const result = extractIOCs('Dropped to /tmp/payload.bin and C:\\Windows\\Temp\\malware.exe');
    const paths = result.filter((i) => i.type === 'file-path');
    expect(paths).toHaveLength(2);
  });

  it('extracts Unix file paths with known prefixes', () => {
    const result = extractIOCs('Found at /etc/passwd and /var/log/syslog');
    const paths = result.filter((i) => i.type === 'file-path');
    expect(paths).toHaveLength(2);
  });

  // -- Deduplication --
  it('deduplicates identical values', () => {
    const result = extractIOCs('IP 192.168.1.1 was seen and also 192.168.1.1 again');
    const ipv4s = result.filter((i) => i.type === 'ipv4');
    expect(ipv4s).toHaveLength(1);
  });

  it('deduplicates domains found in URLs', () => {
    const result = extractIOCs('Found at https://evil.com/path and also evil.com mentioned');
    const domains = result.filter((i) => i.type === 'domain');
    const urls = result.filter((i) => i.type === 'url');
    expect(urls).toHaveLength(1);
    // evil.com domain should be deduped since it's part of the URL
    expect(domains.every((d) => d.value.toLowerCase() !== 'evil.com')).toBe(true);
  });

  it('deduplicates domains found in email addresses', () => {
    const result = extractIOCs('Contact user@evil.com and evil.com is the domain');
    const domains = result.filter((i) => i.type === 'domain');
    const emails = result.filter((i) => i.type === 'email');
    expect(emails).toHaveLength(1);
    expect(domains.every((d) => d.value.toLowerCase() !== 'evil.com')).toBe(true);
  });

  it('deduplicates case-insensitively', () => {
    const result = extractIOCs('Found Evil.Com and evil.com');
    const domains = result.filter((i) => i.type === 'domain');
    expect(domains).toHaveLength(1);
  });

  // -- IOC entry fields --
  it('sets default medium confidence', () => {
    const result = extractIOCs('IP: 10.20.30.40');
    expect(result[0].confidence).toBe('medium');
  });

  it('sets dismissed to false by default', () => {
    const result = extractIOCs('IP: 10.20.30.40');
    expect(result[0].dismissed).toBe(false);
  });

  it('generates unique ids for each IOC', () => {
    const result = extractIOCs('10.20.30.40 and 10.20.30.41');
    expect(result[0].id).toBeTruthy();
    expect(result[1].id).toBeTruthy();
    expect(result[0].id).not.toBe(result[1].id);
  });

  it('sets firstSeen timestamp', () => {
    const before = Date.now();
    const result = extractIOCs('10.20.30.40');
    const after = Date.now();
    expect(result[0].firstSeen).toBeGreaterThanOrEqual(before);
    expect(result[0].firstSeen).toBeLessThanOrEqual(after);
  });

  // -- Edge cases --
  it('returns empty array for empty input', () => {
    expect(extractIOCs('')).toEqual([]);
  });

  it('returns empty array for text with no IOCs', () => {
    expect(extractIOCs('This is just normal text with nothing interesting')).toEqual([]);
  });

  it('extracts multiple IOC types from mixed text', () => {
    const text = 'Attacker at 192.168.1.1 used https://evil.com/c2 CVE-2024-1234 hash d41d8cd98f00b204e9800998ecf8427e';
    const result = extractIOCs(text);
    const types = new Set(result.map((i) => i.type));
    expect(types.has('ipv4')).toBe(true);
    expect(types.has('url')).toBe(true);
    expect(types.has('cve')).toBe(true);
    expect(types.has('md5')).toBe(true);
  });
});

// ── mergeIOCAnalysis ────────────────────────────────────────────────

describe('mergeIOCAnalysis', () => {
  it('creates new analysis when no existing', () => {
    const fresh: IOCEntry[] = [
      { id: '1', type: 'ipv4', value: '10.0.0.1', confidence: 'medium', firstSeen: 1000, dismissed: false },
    ];
    const result = mergeIOCAnalysis(undefined, fresh);
    expect(result.iocs).toHaveLength(1);
    expect(result.extractedAt).toBeGreaterThan(0);
  });

  it('preserves analyst notes on re-analysis', () => {
    const existing: IOCAnalysis = {
      extractedAt: 1000,
      iocs: [
        { id: 'old-1', type: 'ipv4', value: '10.0.0.1', confidence: 'high', analystNotes: 'Known C2', attribution: 'APT29', firstSeen: 500, dismissed: false },
      ],
      analysisSummary: 'Initial analysis',
    };
    const fresh: IOCEntry[] = [
      { id: 'new-1', type: 'ipv4', value: '10.0.0.1', confidence: 'medium', firstSeen: 2000, dismissed: false },
      { id: 'new-2', type: 'domain', value: 'evil.com', confidence: 'medium', firstSeen: 2000, dismissed: false },
    ];

    const result = mergeIOCAnalysis(existing, fresh);
    expect(result.iocs).toHaveLength(2);

    const merged10 = result.iocs.find((i) => i.value === '10.0.0.1')!;
    expect(merged10.id).toBe('old-1'); // Preserves original ID
    expect(merged10.confidence).toBe('high'); // Preserves confidence
    expect(merged10.analystNotes).toBe('Known C2'); // Preserves notes
    expect(merged10.attribution).toBe('APT29'); // Preserves attribution
    expect(merged10.firstSeen).toBe(500); // Preserves original firstSeen

    expect(result.analysisSummary).toBe('Initial analysis'); // Preserves summary
  });

  it('resets dismissed state on re-analysis so IOCs are restored', () => {
    const existing: IOCAnalysis = {
      extractedAt: 1000,
      iocs: [
        { id: 'old-1', type: 'ipv4', value: '10.0.0.1', confidence: 'medium', firstSeen: 500, dismissed: true },
      ],
    };
    const fresh: IOCEntry[] = [
      { id: 'new-1', type: 'ipv4', value: '10.0.0.1', confidence: 'medium', firstSeen: 2000, dismissed: false },
    ];

    const result = mergeIOCAnalysis(existing, fresh);
    expect(result.iocs[0].dismissed).toBe(false);
  });

  it('preserves lastPushedAt on re-analysis', () => {
    const existing: IOCAnalysis = {
      extractedAt: 1000,
      iocs: [
        { id: 'old-1', type: 'ipv4', value: '10.0.0.1', confidence: 'medium', firstSeen: 500, dismissed: false },
      ],
      lastPushedAt: 1500,
    };
    const fresh: IOCEntry[] = [
      { id: 'new-1', type: 'ipv4', value: '10.0.0.1', confidence: 'medium', firstSeen: 2000, dismissed: false },
    ];

    const result = mergeIOCAnalysis(existing, fresh);
    expect(result.lastPushedAt).toBe(1500);
  });

  it('drops IOCs no longer present in fresh extraction', () => {
    const existing: IOCAnalysis = {
      extractedAt: 1000,
      iocs: [
        { id: 'old-1', type: 'ipv4', value: '10.0.0.1', confidence: 'high', firstSeen: 500, dismissed: false },
        { id: 'old-2', type: 'domain', value: 'gone.com', confidence: 'medium', firstSeen: 500, dismissed: false },
      ],
    };
    const fresh: IOCEntry[] = [
      { id: 'new-1', type: 'ipv4', value: '10.0.0.1', confidence: 'medium', firstSeen: 2000, dismissed: false },
    ];

    const result = mergeIOCAnalysis(existing, fresh);
    expect(result.iocs).toHaveLength(1);
    expect(result.iocs[0].value).toBe('10.0.0.1');
  });

  it('matches existing IOCs case-insensitively', () => {
    const existing: IOCAnalysis = {
      extractedAt: 1000,
      iocs: [
        { id: 'old-1', type: 'domain', value: 'Evil.Com', confidence: 'high', analystNotes: 'C2', firstSeen: 500, dismissed: false },
      ],
    };
    const fresh: IOCEntry[] = [
      { id: 'new-1', type: 'domain', value: 'evil.com', confidence: 'medium', firstSeen: 2000, dismissed: false },
    ];

    const result = mergeIOCAnalysis(existing, fresh);
    expect(result.iocs[0].id).toBe('old-1');
    expect(result.iocs[0].analystNotes).toBe('C2');
  });

  it('adds new IOCs with fresh entries', () => {
    const existing: IOCAnalysis = {
      extractedAt: 1000,
      iocs: [
        { id: 'old-1', type: 'ipv4', value: '10.0.0.1', confidence: 'high', firstSeen: 500, dismissed: false },
      ],
    };
    const fresh: IOCEntry[] = [
      { id: 'new-1', type: 'ipv4', value: '10.0.0.1', confidence: 'medium', firstSeen: 2000, dismissed: false },
      { id: 'new-2', type: 'domain', value: 'new.com', confidence: 'medium', firstSeen: 2000, dismissed: false },
    ];

    const result = mergeIOCAnalysis(existing, fresh);
    const newIOC = result.iocs.find((i) => i.value === 'new.com')!;
    expect(newIOC.id).toBe('new-2');
    expect(newIOC.confidence).toBe('medium');
  });

  it('updates extractedAt timestamp', () => {
    const existing: IOCAnalysis = {
      extractedAt: 1000,
      iocs: [],
    };
    const before = Date.now();
    const result = mergeIOCAnalysis(existing, []);
    expect(result.extractedAt).toBeGreaterThanOrEqual(before);
  });
});

// ── extractYaraRules ────────────────────────────────────────────────

describe('extractYaraRules', () => {
  it('extracts full YARA rule body', () => {
    const input = 'rule TestRule { meta: author = "test" strings: $a = "evil" condition: $a }';
    const rules = extractYaraRules(input);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toContain('rule TestRule');
    expect(rules[0]).toContain('condition: $a');
  });

  it('handles nested braces in strings', () => {
    const input = 'rule Nested { strings: $a = "test{inner}" condition: $a }';
    const rules = extractYaraRules(input);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toContain('rule Nested');
  });

  it('extracts multiple YARA rules', () => {
    const input = 'rule One { condition: true } some text rule Two { condition: false }';
    const rules = extractYaraRules(input);
    expect(rules).toHaveLength(2);
    expect(rules[0]).toContain('rule One');
    expect(rules[1]).toContain('rule Two');
  });

  it('gracefully skips unbalanced braces', () => {
    const input = 'rule Broken { meta: author = "test" strings: $a = "evil"';
    const rules = extractYaraRules(input);
    expect(rules).toHaveLength(0);
  });

  it('handles escaped quotes inside strings', () => {
    const input = 'rule EscQuote { strings: $a = "has \\"escaped\\" quotes" condition: $a }';
    const rules = extractYaraRules(input);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toContain('rule EscQuote');
  });

  it('handles rule with tags (colon after name)', () => {
    const input = 'rule TaggedRule : apt backdoor { condition: true }';
    const rules = extractYaraRules(input);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toContain('rule TaggedRule');
  });

  it('returns empty for empty input', () => {
    expect(extractYaraRules('')).toEqual([]);
  });

  it('returns empty for text with no rules', () => {
    expect(extractYaraRules('just some text without any rules')).toEqual([]);
  });
});

// ── extractSigmaRules ───────────────────────────────────────────────

describe('extractSigmaRules', () => {
  it('extracts basic SIGMA rule', () => {
    const input = `title: Test Rule
logsource:
  product: windows
detection:
  selection:
    EventID: 1
  condition: selection`;
    const rules = extractSigmaRules(input);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toContain('title: Test Rule');
    expect(rules[0]).toContain('detection:');
    expect(rules[0]).toContain('logsource:');
  });

  it('rejects YAML without detection block', () => {
    const input = `title: Not A Sigma Rule
logsource:
  product: windows
description: This has no detection block`;
    const rules = extractSigmaRules(input);
    expect(rules).toHaveLength(0);
  });

  it('stops at blank line boundary', () => {
    const input = `title: Rule One
logsource:
  product: windows
detection:
  condition: selection

title: Not A Rule
description: separate block`;
    const rules = extractSigmaRules(input);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toContain('Rule One');
    expect(rules[0]).not.toContain('Not A Rule');
  });

  it('stops at YAML document separator (---)', () => {
    const input = `title: Rule One
logsource:
  product: windows
detection:
  condition: selection
---
title: Separate Doc
description: different doc`;
    const rules = extractSigmaRules(input);
    expect(rules).toHaveLength(1);
    expect(rules[0]).not.toContain('Separate Doc');
  });

  it('accepts rule with condition instead of logsource', () => {
    const input = `title: Condition Only Rule
detection:
  selection:
    EventID: 1
  condition: selection`;
    const rules = extractSigmaRules(input);
    expect(rules).toHaveLength(1);
  });

  it('extracts multiple sigma rules separated by blank lines', () => {
    const input = `title: Rule A
logsource:
  product: windows
detection:
  condition: selection

title: Rule B
logsource:
  product: linux
detection:
  condition: selection`;
    const rules = extractSigmaRules(input);
    expect(rules).toHaveLength(2);
    expect(rules[0]).toContain('Rule A');
    expect(rules[1]).toContain('Rule B');
  });

  it('returns empty for empty input', () => {
    expect(extractSigmaRules('')).toEqual([]);
  });

  it('returns empty for text with no title: lines', () => {
    expect(extractSigmaRules('just some text')).toEqual([]);
  });
});
