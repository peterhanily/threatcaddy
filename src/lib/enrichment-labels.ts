// Experimental: derive compact colored labels from IOC enrichment data

export interface EnrichmentLabel {
  text: string;
  color: string;
  tooltip?: string;
  priority: number;
  category: 'risk' | 'provider' | 'context';
}

type Enrichment = Record<string, Array<Record<string, unknown>>> | undefined;

function num(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  return String(v);
}

/** Parse a value that may be an array, a comma-separated string, or a single item into an array. */
function toArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') return v.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}

function latest(enrichment: Enrichment, provider: string): Record<string, unknown> | undefined {
  const snaps = enrichment?.[provider];
  return snaps && snaps.length > 0 ? snaps[0] : undefined;
}

export function computeEnrichmentLabels(enrichment: Enrichment): EnrichmentLabel[] {
  if (!enrichment || Object.keys(enrichment).length === 0) return [];

  const labels: EnrichmentLabel[] = [];

  // --- Provider-specific labels ---

  // VirusTotal
  const vt = latest(enrichment, 'virusTotal');
  let vtMalicious: number | undefined;
  let vtTotal: number | undefined;
  if (vt) {
    vtMalicious = num(vt.malicious);
    vtTotal = num(vt.total);
    if (vtMalicious !== undefined && vtTotal !== undefined) {
      const color = vtMalicious > 5 ? '#ef4444' : vtMalicious > 0 ? '#f59e0b' : '#22c55e';
      labels.push({
        text: `VT: ${vtMalicious}/${vtTotal}`,
        color,
        tooltip: `VirusTotal: ${vtMalicious} of ${vtTotal} engines flagged malicious`,
        priority: 10,
        category: 'provider',
      });
    }
  }

  // AbuseIPDB
  const abuse = latest(enrichment, 'abuseIPDB');
  let abuseScore: number | undefined;
  if (abuse) {
    abuseScore = num(abuse.abuseConfidenceScore);
    if (abuseScore !== undefined) {
      const color = abuseScore >= 75 ? '#ef4444' : abuseScore >= 25 ? '#f59e0b' : '#22c55e';
      labels.push({
        text: `Abuse: ${abuseScore}%`,
        color,
        tooltip: `AbuseIPDB confidence score: ${abuseScore}%`,
        priority: 11,
        category: 'provider',
      });
    }
  }

  // GreyNoise
  const gn = latest(enrichment, 'greyNoise');
  let gnClassification: string | undefined;
  let gnRiot: boolean | undefined;
  if (gn) {
    gnClassification = str(gn.classification)?.toLowerCase();
    gnRiot = gn.riot === true || gn.riot === 'true';
    if (gnClassification) {
      const color = gnClassification === 'malicious' ? '#ef4444'
        : gnClassification === 'benign' ? '#22c55e'
        : '#6b7280';
      labels.push({
        text: `GN: ${gnClassification}`,
        color,
        tooltip: `GreyNoise classification: ${gnClassification}`,
        priority: 12,
        category: 'provider',
      });
    }
    // Actor name
    const actor = str(gn.actor);
    if (actor) {
      labels.push({
        text: actor,
        color: '#6b7280',
        tooltip: `GreyNoise actor: ${actor}`,
        priority: 30,
        category: 'context',
      });
    }
  }

  // URLhaus / URLhaus Domain
  for (const provider of ['urlhaus', 'urlhausDomain'] as const) {
    const uh = latest(enrichment, provider);
    if (uh) {
      const threatType = str(uh.threatType) || str(uh.threat_type);
      const urlCount = num(uh.urlCount) ?? num(uh.url_count);
      if (threatType) {
        labels.push({
          text: threatType,
          color: '#ef4444',
          tooltip: `URLhaus threat type: ${threatType}`,
          priority: 13,
          category: 'provider',
        });
      } else if (urlCount !== undefined && urlCount > 0) {
        labels.push({
          text: `URLs: ${urlCount}`,
          color: '#ef4444',
          tooltip: `URLhaus: ${urlCount} malicious URLs`,
          priority: 13,
          category: 'provider',
        });
      }
    }
  }

  // ThreatFox
  const tf = latest(enrichment, 'threatFox');
  const tfMatch = tf && (str(tf.status) === 'ok' || str(tf.query_status) === 'ok');
  if (tfMatch) {
    labels.push({
      text: 'ThreatFox Match',
      color: '#ef4444',
      tooltip: 'Found in ThreatFox IOC database',
      priority: 14,
      category: 'provider',
    });
  }

  // MalwareBazaar
  const mb = latest(enrichment, 'malwareBazaar');
  const mbMatch = mb && (str(mb.status) === 'ok' || str(mb.query_status) === 'ok');
  if (mbMatch) {
    labels.push({
      text: 'MB: Known Malware',
      color: '#ef4444',
      tooltip: 'Found in MalwareBazaar database',
      priority: 14,
      category: 'provider',
    });
  }

  // Shodan / ShodanInternetDB
  for (const provider of ['shodan', 'shodanInternetDB'] as const) {
    const sh = latest(enrichment, provider);
    if (sh) {
      const ports = toArray(sh.ports);
      const vulns = toArray(sh.vulns);
      if (ports.length > 0) {
        labels.push({
          text: `Ports: ${ports.length}`,
          color: '#22c55e',
          tooltip: `Shodan: ${ports.length} open ports (${ports.slice(0, 5).join(', ')}${ports.length > 5 ? '...' : ''})`,
          priority: 15,
          category: 'provider',
        });
      }
      if (vulns.length > 0) {
        labels.push({
          text: `Vulns: ${vulns.length}`,
          color: '#ef4444',
          tooltip: `Shodan: ${vulns.length} vulnerabilities (${vulns.slice(0, 3).join(', ')}${vulns.length > 3 ? '...' : ''})`,
          priority: 16,
          category: 'provider',
        });
      }
    }
  }

  // --- Country codes (deduplicated across all providers) ---
  const countries = new Set<string>();
  for (const snaps of Object.values(enrichment)) {
    if (snaps && snaps.length > 0) {
      const snap = snaps[0];
      const cc = str(snap.country) || str(snap.countryCode) || str(snap.country_code);
      if (cc && cc.length === 2) {
        countries.add(cc.toUpperCase());
      }
    }
  }
  for (const cc of countries) {
    labels.push({
      text: cc,
      color: '#6366f1',
      tooltip: `Country: ${cc}`,
      priority: 25,
      category: 'context',
    });
  }

  // --- Aggregate risk label ---
  const isHighRisk =
    (vtMalicious !== undefined && vtMalicious > 5) ||
    (abuseScore !== undefined && abuseScore >= 75) ||
    gnClassification === 'malicious' ||
    tfMatch ||
    mbMatch;

  const gnNoise = gn && (gn.noise === true || gn.noise === 'true');
  const isSuspicious =
    !isHighRisk && (
      (vtMalicious !== undefined && vtMalicious > 0) ||
      (abuseScore !== undefined && abuseScore >= 25) ||
      (gnClassification === 'unknown' && gnNoise)
    );

  const isBenign =
    !isHighRisk && !isSuspicious &&
    gnClassification === 'benign' && gnRiot &&
    (vtMalicious === undefined || vtMalicious === 0);

  if (isHighRisk) {
    labels.push({ text: 'High Risk', color: '#ef4444', tooltip: 'Multiple indicators suggest high risk', priority: 1, category: 'risk' });
  } else if (isSuspicious) {
    labels.push({ text: 'Suspicious', color: '#f59e0b', tooltip: 'Some indicators suggest suspicious activity', priority: 1, category: 'risk' });
  } else if (isBenign) {
    labels.push({ text: 'Benign', color: '#22c55e', tooltip: 'Indicators suggest benign activity', priority: 1, category: 'risk' });
  } else {
    labels.push({ text: 'Unknown', color: '#6b7280', tooltip: 'Enrichment data present but no clear risk signal', priority: 1, category: 'risk' });
  }

  labels.sort((a, b) => a.priority - b.priority);
  return labels;
}
