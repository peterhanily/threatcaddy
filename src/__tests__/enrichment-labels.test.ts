import { describe, it, expect } from 'vitest';
import { computeEnrichmentLabels, type EnrichmentLabel } from '../lib/enrichment-labels';

function labelTexts(labels: EnrichmentLabel[]): string[] {
  return labels.map(l => l.text);
}

describe('computeEnrichmentLabels', () => {
  it('returns empty array for undefined enrichment', () => {
    expect(computeEnrichmentLabels(undefined)).toEqual([]);
  });

  it('returns empty array for empty enrichment object', () => {
    expect(computeEnrichmentLabels({})).toEqual([]);
  });

  it('produces High Risk + VT label for high VT malicious count', () => {
    const labels = computeEnrichmentLabels({
      virusTotal: [{ malicious: 12, total: 70, ts: Date.now() }],
    });
    const texts = labelTexts(labels);
    expect(texts).toContain('High Risk');
    expect(texts).toContain('VT: 12/70');
    const vtLabel = labels.find(l => l.text === 'VT: 12/70')!;
    expect(vtLabel.color).toBe('#ef4444');
  });

  it('produces green VT label with no aggregate risk for zero malicious', () => {
    const labels = computeEnrichmentLabels({
      virusTotal: [{ malicious: 0, total: 70, ts: Date.now() }],
    });
    const texts = labelTexts(labels);
    expect(texts).toContain('VT: 0/70');
    expect(texts).not.toContain('High Risk');
    expect(texts).not.toContain('Suspicious');
    const vtLabel = labels.find(l => l.text === 'VT: 0/70')!;
    expect(vtLabel.color).toBe('#22c55e');
    expect(texts).toContain('Unknown');
  });

  it('produces High Risk + Abuse label for AbuseIPDB ≥75', () => {
    const labels = computeEnrichmentLabels({
      abuseIPDB: [{ abuseConfidenceScore: 85, ts: Date.now() }],
    });
    const texts = labelTexts(labels);
    expect(texts).toContain('High Risk');
    expect(texts).toContain('Abuse: 85%');
    const abuseLabel = labels.find(l => l.text === 'Abuse: 85%')!;
    expect(abuseLabel.color).toBe('#ef4444');
  });

  it('produces Suspicious for AbuseIPDB ≥25 but <75', () => {
    const labels = computeEnrichmentLabels({
      abuseIPDB: [{ abuseConfidenceScore: 40, ts: Date.now() }],
    });
    const texts = labelTexts(labels);
    expect(texts).toContain('Suspicious');
    expect(texts).not.toContain('High Risk');
  });

  it('produces High Risk + GN label for malicious classification', () => {
    const labels = computeEnrichmentLabels({
      greyNoise: [{ classification: 'malicious', ts: Date.now() }],
    });
    const texts = labelTexts(labels);
    expect(texts).toContain('High Risk');
    expect(texts).toContain('GN: malicious');
  });

  it('produces Benign label for GN benign+riot', () => {
    const labels = computeEnrichmentLabels({
      greyNoise: [{ classification: 'benign', riot: true, ts: Date.now() }],
    });
    const texts = labelTexts(labels);
    expect(texts).toContain('Benign');
    expect(texts).toContain('GN: benign');
    const benignLabel = labels.find(l => l.text === 'Benign')!;
    expect(benignLabel.color).toBe('#22c55e');
  });

  it('produces Suspicious for GN unknown with noise', () => {
    const labels = computeEnrichmentLabels({
      greyNoise: [{ classification: 'unknown', noise: true, ts: Date.now() }],
    });
    const texts = labelTexts(labels);
    expect(texts).toContain('Suspicious');
  });

  it('produces port and vuln count labels from Shodan', () => {
    const labels = computeEnrichmentLabels({
      shodanInternetDB: [{ ports: [80, 443, 8080], vulns: 'CVE-2021-1234,CVE-2022-5678', ts: Date.now() }],
    });
    const texts = labelTexts(labels);
    expect(texts).toContain('Ports: 3');
    expect(texts).toContain('Vulns: 2');
    const vulnLabel = labels.find(l => l.text === 'Vulns: 2')!;
    expect(vulnLabel.color).toBe('#ef4444');
  });

  it('handles comma-separated ports string', () => {
    const labels = computeEnrichmentLabels({
      shodan: [{ ports: '22,80,443', ts: Date.now() }],
    });
    expect(labelTexts(labels)).toContain('Ports: 3');
  });

  it('produces ThreatFox Match label', () => {
    const labels = computeEnrichmentLabels({
      threatFox: [{ status: 'ok', ts: Date.now() }],
    });
    const texts = labelTexts(labels);
    expect(texts).toContain('High Risk');
    expect(texts).toContain('ThreatFox Match');
  });

  it('produces MB: Known Malware label', () => {
    const labels = computeEnrichmentLabels({
      malwareBazaar: [{ query_status: 'ok', ts: Date.now() }],
    });
    const texts = labelTexts(labels);
    expect(texts).toContain('High Risk');
    expect(texts).toContain('MB: Known Malware');
  });

  it('deduplicates country codes across providers', () => {
    const labels = computeEnrichmentLabels({
      abuseIPDB: [{ abuseConfidenceScore: 10, country: 'RU', ts: Date.now() }],
      greyNoise: [{ classification: 'unknown', country_code: 'RU', ts: Date.now() }],
      virusTotal: [{ malicious: 0, total: 70, country: 'US', ts: Date.now() }],
    });
    const countryLabels = labels.filter(l => l.category === 'context' && l.color === '#6366f1');
    const countryTexts = countryLabels.map(l => l.text);
    expect(countryTexts).toContain('RU');
    expect(countryTexts).toContain('US');
    // RU should appear only once despite being in two providers
    expect(countryTexts.filter(t => t === 'RU')).toHaveLength(1);
  });

  it('sorts labels by priority', () => {
    const labels = computeEnrichmentLabels({
      virusTotal: [{ malicious: 12, total: 70, ts: Date.now() }],
      abuseIPDB: [{ abuseConfidenceScore: 90, country: 'CN', ts: Date.now() }],
    });
    // Aggregate (priority 1) should come first
    expect(labels[0].text).toBe('High Risk');
    // Country (priority 25) should come after providers
    const cnIdx = labels.findIndex(l => l.text === 'CN');
    const vtIdx = labels.findIndex(l => l.text.startsWith('VT:'));
    expect(cnIdx).toBeGreaterThan(vtIdx);
  });

  it('produces single aggregate High Risk with multiple signals', () => {
    const labels = computeEnrichmentLabels({
      virusTotal: [{ malicious: 20, total: 70, ts: Date.now() }],
      abuseIPDB: [{ abuseConfidenceScore: 95, ts: Date.now() }],
      greyNoise: [{ classification: 'malicious', ts: Date.now() }],
      threatFox: [{ status: 'ok', ts: Date.now() }],
    });
    const riskLabels = labels.filter(l => l.category === 'risk');
    expect(riskLabels).toHaveLength(1);
    expect(riskLabels[0].text).toBe('High Risk');
  });

  it('includes GreyNoise actor name', () => {
    const labels = computeEnrichmentLabels({
      greyNoise: [{ classification: 'benign', riot: true, actor: 'Cloudflare', ts: Date.now() }],
    });
    expect(labelTexts(labels)).toContain('Cloudflare');
  });

  it('handles URLhaus threat type', () => {
    const labels = computeEnrichmentLabels({
      urlhaus: [{ threatType: 'malware_download', ts: Date.now() }],
    });
    expect(labelTexts(labels)).toContain('malware_download');
  });

  it('handles URLhaus url count', () => {
    const labels = computeEnrichmentLabels({
      urlhausDomain: [{ urlCount: 5, ts: Date.now() }],
    });
    expect(labelTexts(labels)).toContain('URLs: 5');
  });
});
