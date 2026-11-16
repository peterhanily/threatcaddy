// Validate the complete Trivy report for the same image that acceptance tested.
// Registry/download/scanner failures are fatal in the workflow before this runs.
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const TRIVY_VERSION = '0.76.2';
const severities = new Set(['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.length > 0;
const DATABASE_MAX_AGE_MS = 48 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 60 * 1000;
function requireEvidence(condition, message) {
  if (!condition) throw new Error(`Image audit rejected: ${message}`);
}

export function auditServerImage(report, { imageId, revision, dependencies, diagnostics = '', database, now = Date.now() }) {
  requireEvidence(/^sha256:[a-f0-9]{64}$/.test(imageId), 'invalid expected image identity');
  // Trivy rebuilds its database every few hours; a stale copy scans against old advisories.
  const databaseUpdatedAt = nonempty(database?.UpdatedAt) ? Date.parse(database.UpdatedAt) : NaN;
  requireEvidence(Number.isFinite(databaseUpdatedAt) && databaseUpdatedAt <= now + CLOCK_SKEW_MS
    && now - databaseUpdatedAt <= DATABASE_MAX_AGE_MS, 'vulnerability database is missing, invalid or older than 48 hours');
  requireEvidence(/^[a-f0-9]{40}$/.test(revision), 'invalid expected source revision');
  requireEvidence(Array.isArray(dependencies) && dependencies.length > 0 && dependencies.every(nonempty), 'missing application dependency inventory');
  requireEvidence(object(report) && report.SchemaVersion === 2 && report.Trivy?.Version === TRIVY_VERSION, 'unexpected scanner or report schema');
  requireEvidence(report.ArtifactType === 'container_image', 'not a container-image scan');
  requireEvidence(report.Metadata?.ImageID === imageId, 'report does not identify the tested image');
  requireEvidence(report.Metadata?.ImageConfig?.config?.Labels?.['org.opencontainers.image.revision'] === revision, 'image revision does not match verified source');
  requireEvidence(report.Metadata?.ImageConfig?.os === 'linux', 'image operating system was not identified as Linux');
  const os = report.Metadata?.OS;
  requireEvidence(os?.Family === 'alpine' && /^\d+\.\d+(?:\.\d+)?$/.test(os.Name), 'Alpine operating-system identification is missing');
  requireEvidence(!os.EOSL, 'operating system is past scanner-supported lifetime');
  requireEvidence(Array.isArray(report.Results) && report.Results.length > 0, 'no package analysis results');
  requireEvidence(!report.Error && !report.Errors, 'scanner reported incomplete analysis');
  // The pinned scanner emits one informational severity-selection warning. Any
  // other warning/error must be investigated rather than silently accepted.
  for (const line of diagnostics.split('\n')) {
    requireEvidence(!/\b(?:ERROR|FATAL)\b/.test(line), 'scanner diagnostics contain an error');
    if (/\bWARN\b/.test(line)) requireEvidence(
      /\bWARN\s+Using severities from other vendors for some vulnerabilities\. Read https:\/\/trivy\.dev\/docs\/v0\.76\/guide\/scanner\/vulnerability#severity-selection for details\.$/.test(line),
      'scanner diagnostics contain an unreviewed warning',
    );
  }
  let osPackages = 0;
  const applicationPackages = new Set();
  const counts = Object.fromEntries([...severities].map(severity => [severity, 0]));
  let unknownFixed = 0;
  for (const result of report.Results) {
    requireEvidence(object(result) && nonempty(result.Target) && nonempty(result.Class) && nonempty(result.Type), 'malformed package result');
    requireEvidence(!result.Error && !result.Errors, 'package analysis reported an error');
    requireEvidence(result.ExperimentalModifiedFindings === undefined || (Array.isArray(result.ExperimentalModifiedFindings) && result.ExperimentalModifiedFindings.length === 0), 'suppressed or modified findings are not permitted');
    if (result.Packages !== undefined) requireEvidence(Array.isArray(result.Packages) && result.Packages.every(pkg => object(pkg) && nonempty(pkg.Name) && nonempty(pkg.Version)), 'malformed package inventory');
    if (result.Class === 'os-pkgs' && result.Type === 'alpine') osPackages += result.Packages?.length ?? 0;
    if (result.Class === 'lang-pkgs' && result.Type === 'node-pkg') {
      for (const pkg of result.Packages ?? []) {
        if (pkg.FilePath?.replace(/^\//, '') === `app/node_modules/${pkg.Name}/package.json`) applicationPackages.add(pkg.Name);
      }
    }
    requireEvidence(result.Vulnerabilities === undefined || Array.isArray(result.Vulnerabilities), 'malformed vulnerability list');
    for (const vulnerability of result.Vulnerabilities ?? []) {
      requireEvidence(object(vulnerability) && nonempty(vulnerability.VulnerabilityID)
        && nonempty(vulnerability.PkgName) && nonempty(vulnerability.InstalledVersion)
        && severities.has(vulnerability.Severity), 'malformed or unclassified vulnerability');
      counts[vulnerability.Severity]++;
      // Not yet scored, but a fixed package exists: update rather than publish.
      if (vulnerability.Severity === 'UNKNOWN' && nonempty(vulnerability.FixedVersion)) unknownFixed++;
    }
  }
  requireEvidence(osPackages > 0, 'operating-system package analysis is empty');
  const missing = dependencies.filter(name => !applicationPackages.has(name));
  requireEvidence(missing.length === 0, `application package analysis is incomplete: ${missing.join(', ')}`);
  requireEvidence(counts.HIGH + counts.CRITICAL === 0, `${counts.HIGH} HIGH and ${counts.CRITICAL} CRITICAL vulnerabilities remain`);
  requireEvidence(unknownFixed === 0, `${unknownFixed} UNKNOWN-severity vulnerabilities with an available fix remain`);
  return { imageId, revision, scanner: TRIVY_VERSION, databaseUpdatedAt: new Date(databaseUpdatedAt).toISOString(),
    os: `${os.Family} ${os.Name}`, osPackages, applicationPackages: applicationPackages.size, vulnerabilities: counts };
}

// Compare real paths: a symlinked checkout must not turn the CLI into a silent no-op.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const [reportPath, imageIdPath, revision, diagnosticsPath, manifestPath, databasePath] = process.argv.slice(2);
    if (process.argv.length !== 8) throw new Error('Usage: node scripts/ci-audit-server-image.mjs REPORT IMAGE_ID REVISION DIAGNOSTICS MANIFEST DATABASE_METADATA');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const result = auditServerImage(JSON.parse(readFileSync(reportPath, 'utf8')), {
      imageId: readFileSync(imageIdPath, 'utf8').trim(), revision,
      dependencies: Object.keys(manifest.dependencies ?? {}), diagnostics: readFileSync(diagnosticsPath, 'utf8'),
      database: JSON.parse(readFileSync(databasePath, 'utf8')),
    });
    console.log(JSON.stringify({ passed: true, ...result }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({ passed: false, error: error.message }, null, 2));
    process.exitCode = 1;
  }
}
