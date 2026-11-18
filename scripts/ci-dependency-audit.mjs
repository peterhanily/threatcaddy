// Decide one CI dependency audit from the unchanged `--audit-level=high --json` output.
// A failing audit passes only when every high or critical advisory is a reviewed exception
// in dependency-audit-exceptions.json and all of its conditions still hold. npm has no
// per-advisory ignore; pnpm's own ignores drop the advisory before any condition is checked.
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PROJECTS = ['root', 'server', 'extension'];
const SEVERITIES = new Set(['info', 'low', 'moderate', 'high', 'critical']);
const BLOCKING = new Set(['high', 'critical']);
const GHSA = /^GHSA(?:-[0-9a-z]{4}){3}$/;
const FIELDS = ['id', 'package', 'severity', 'vulnerableVersions', 'projects', 'reviewed', 'reason', 'endsWhen', 'reviewedProductionPaths'];
const MAX_VISITS = 100_000;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.length > 0;
function check(condition, message) {
  if (!condition) throw new Error(`Dependency audit rejected: ${message}`);
}

export function validateExceptions(document) {
  check(object(document) && Object.keys(document).join() === 'exceptions' && Array.isArray(document.exceptions),
    'the exception list must be {"exceptions": [...]}');
  const ids = new Set();
  for (const entry of document.exceptions) {
    check(object(entry) && Object.keys(entry).every(key => FIELDS.includes(key)), 'an exception has unknown fields');
    check(GHSA.test(entry.id) && !ids.has(entry.id), `exceptions need distinct GHSA ids: ${entry.id}`);
    ids.add(entry.id);
    check(['package', 'vulnerableVersions', 'reason', 'endsWhen'].every(key => nonempty(entry[key])),
      `${entry.id} needs a package, vulnerableVersions, reason and endsWhen`);
    check(BLOCKING.has(entry.severity), `${entry.id} must record the reviewed severity (high or critical)`);
    const date = new Date(`${entry.reviewed}T00:00:00Z`);
    check(/^\d{4}-\d{2}-\d{2}$/.test(entry.reviewed) && !Number.isNaN(date.getTime()) && date.toISOString().startsWith(entry.reviewed),
      `${entry.id} needs a review date (YYYY-MM-DD)`);
    check(Array.isArray(entry.projects) && entry.projects.length > 0 && new Set(entry.projects).size === entry.projects.length
      && entry.projects.every(project => PROJECTS.includes(project)), `${entry.id} must list distinct projects from ${PROJECTS.join(', ')}`);
    // npm's lockfile marks development-only locations; reviewed production paths exist only for pnpm.
    check(entry.reviewedProductionPaths === undefined || (object(entry.reviewedProductionPaths)
      && Object.entries(entry.reviewedProductionPaths).every(([project, paths]) => project === 'root' && entry.projects.includes(project)
        && Array.isArray(paths) && paths.length > 0 && paths.every(path => nonempty(path) && path.endsWith(`>${entry.package}`)))),
    `${entry.id}: reviewed production paths are root pnpm paths ending at ${entry.package}`);
  }
  return document.exceptions;
}

// Reads the importers and snapshots of a pnpm v9 lockfile, the only parts reachability needs.
// The audit job installs nothing, so no YAML library is available; unknown syntax fails.
export function parsePnpmLock(text) {
  check(/^lockfileVersion: '9\.0'$/m.test(text), 'pnpm-lock.yaml is not lockfile version 9.0');
  const scalar = raw => {
    if (raw.startsWith("'")) {
      check(raw.length > 1 && raw.endsWith("'"), `unsupported YAML in pnpm-lock.yaml: ${raw}`);
      return raw.slice(1, -1).replaceAll("''", "'");
    }
    check(/^[\w.~^/]/.test(raw) && !raw.includes(' #'), `unsupported YAML in pnpm-lock.yaml: ${raw}`);
    return raw;
  };
  const lock = { importers: {}, snapshots: {} };
  let section, entry, group, alias;
  for (const line of text.split(/\r?\n/)) {
    const body = line.trimStart();
    const indent = line.length - body.length;
    if (body === '') continue;
    if (indent === 0) {
      section = body.endsWith(':') ? body.slice(0, -1) : undefined;
      continue;
    }
    if (section !== 'importers' && section !== 'snapshots') continue;
    if (indent === 2) {
      const key = /^(.+?):( \{\})?$/.exec(body);
      check(key, `unsupported YAML in pnpm-lock.yaml: ${body}`);
      entry = lock[section][scalar(key[1])] = {};
      group = undefined;
    } else if (indent === 4) {
      const kind = body.slice(0, -1);
      const kinds = section === 'importers' ? ['dependencies', 'devDependencies', 'optionalDependencies'] : ['dependencies', 'optionalDependencies'];
      group = body.endsWith(':') && kinds.includes(kind) ? (entry[kind] = {}) : undefined;
    } else if (group && section === 'snapshots') {
      const split = body.startsWith("'") ? body.indexOf("': ") + 1 : body.indexOf(': ');
      check(indent === 6 && split > 0, `unsupported YAML in pnpm-lock.yaml: ${body}`);
      group[scalar(body.slice(0, split))] = scalar(body.slice(split + 2));
    } else if (group && indent === 6) {
      check(body.endsWith(':'), `unsupported YAML in pnpm-lock.yaml: ${body}`);
      alias = scalar(body.slice(0, -1));
    } else if (group && indent === 8 && body.startsWith('version: ')) {
      group[alias] = scalar(body.slice('version: '.length));
    }
  }
  return lock;
}

// Every chain, in pnpm's audit path notation, from an importer's dependencies or
// optionalDependencies to the package. Development dependencies are not walked.
export function productionPaths(lock, name) {
  const keyOf = (alias, version) => (version.split('(')[0].includes('@') ? version : `${alias}@${version}`);
  const nameOf = key => key.replace(/\(.*$/, '').replace(/(.)@[^@]*$/, '$1');
  const paths = new Set();
  let visits = 0;
  const walk = (key, trail, seen) => {
    check(++visits <= MAX_VISITS, `more than ${MAX_VISITS} production paths to check in pnpm-lock.yaml`);
    const snapshot = lock.snapshots[key];
    check(snapshot, `pnpm-lock.yaml has no snapshot for ${key}`);
    const here = [...trail, nameOf(key)];
    if (nameOf(key) === name) {
      paths.add(here.join('>'));
      return;
    }
    for (const [alias, version] of [...Object.entries(snapshot.dependencies ?? {}), ...Object.entries(snapshot.optionalDependencies ?? {})]) {
      const next = keyOf(alias, version);
      if (!seen.has(next)) walk(next, here, new Set([...seen, next]));
    }
  };
  for (const [id, importer] of Object.entries(lock.importers)) {
    for (const [alias, version] of [...Object.entries(importer.dependencies ?? {}), ...Object.entries(importer.optionalDependencies ?? {})]) {
      const key = keyOf(alias, version);
      walk(key, [id], new Set([key]));
    }
  }
  return [...paths].sort();
}

function pnpmAdvisories(report) {
  check(object(report.advisories) && object(report.metadata?.vulnerabilities), 'not a pnpm audit report');
  const advisories = Object.values(report.advisories).map(advisory => {
    check(object(advisory) && nonempty(advisory.module_name) && SEVERITIES.has(advisory.severity)
      && nonempty(advisory.vulnerable_versions) && nonempty(advisory.patched_versions) && Array.isArray(advisory.findings)
      && advisory.findings.length > 0 && advisory.findings.every(finding => object(finding) && nonempty(finding.version)
        && Array.isArray(finding.paths) && finding.paths.length > 0 && finding.paths.every(nonempty)), 'malformed pnpm advisory');
    return { id: GHSA.test(advisory.github_advisory_id) ? advisory.github_advisory_id : undefined, package: advisory.module_name,
      severity: advisory.severity, range: advisory.vulnerable_versions, fixed: advisory.patched_versions !== '<0.0.0',
      findingPaths: advisory.findings.reduce((sum, finding) => sum + finding.paths.length, 0) };
  });
  return advisories.filter(advisory => BLOCKING.has(advisory.severity));
}

function npmAdvisories(report) {
  check(report.auditReportVersion === 2 && object(report.vulnerabilities) && object(report.metadata?.vulnerabilities), 'not an npm audit report (version 2)');
  const advisories = [];
  for (const [name, entry] of Object.entries(report.vulnerabilities)) {
    check(object(entry) && entry.name === name && SEVERITIES.has(entry.severity) && nonempty(entry.range)
      && Array.isArray(entry.via) && Array.isArray(entry.nodes) && entry.nodes.every(nonempty), `malformed npm vulnerability ${name}`);
    for (const via of entry.via) {
      if (typeof via === 'string') {
        check(object(report.vulnerabilities[via]), `${name} depends on unlisted vulnerability ${via}`);
        continue;
      }
      check(object(via) && via.name === name && nonempty(via.url) && SEVERITIES.has(via.severity) && nonempty(via.range), `malformed npm advisory for ${name}`);
      if (!BLOCKING.has(via.severity)) continue;
      const id = /\/(GHSA(?:-[0-9a-z]{4}){3})$/.exec(via.url)?.[1];
      // npm reports "*" only when every published version is vulnerable; other advisories
      // on the same package would also shape that range.
      const fixed = entry.range !== '*' || !entry.via.every(other => object(other) && other.url === via.url);
      advisories.push({ id, package: name, severity: via.severity, range: via.range, fixed, nodes: entry.nodes });
    }
  }
  return advisories;
}

export function evaluateAudit({ project, report, status, exceptions, lockfile }) {
  check(PROJECTS.includes(project), `unknown project ${project}`);
  const entries = validateExceptions(exceptions).filter(entry => entry.projects.includes(project));
  check(['0', '1'].includes(String(status)), `unexpected audit exit status ${status}`);
  check(object(report), 'the audit did not produce a JSON report');
  check(report.error === undefined, `the audit reported an error: ${JSON.stringify(report).slice(0, 500)}`);
  const advisories = project === 'root' ? pnpmAdvisories(report) : npmAdvisories(report);
  const { high, critical } = report.metadata.vulnerabilities;
  // pnpm's ignore settings drop advisories but keep their counts, and the registry counts each
  // finding path (observed 18 November 2026), so the root counts must match exactly.
  const counted = severity => advisories.filter(advisory => advisory.severity === severity).reduce((sum, advisory) => sum + advisory.findingPaths, 0);
  check(Number.isInteger(high) && Number.isInteger(critical) && (project === 'root'
    ? high === counted('high') && critical === counted('critical')
    : (high + critical > 0) === (advisories.length > 0)),
    'the audit summary and its list of high or critical advisories disagree');
  check((String(status) === '1') === (advisories.length > 0), `the audit exited ${status} but lists ${advisories.length} high or critical advisories`);

  const problems = [];
  const used = new Set();
  for (const advisory of advisories) {
    const entry = entries.find(candidate => candidate.id === advisory.id && candidate.package === advisory.package);
    if (!entry) {
      problems.push(`${advisory.id ?? 'an advisory without a GHSA id'} (${advisory.package}, ${advisory.severity}) is not a reviewed exception for ${project}`);
      continue;
    }
    used.add(entry);
    if (advisory.severity !== entry.severity || advisory.range !== entry.vulnerableVersions) {
      problems.push(`${entry.id} changed since its review (now ${advisory.severity}, ${advisory.range}); review it again`);
    }
    if (advisory.fixed) problems.push(`${entry.id}: a fixed ${entry.package} exists or cannot be ruled out; update instead`);
    if (project === 'root') {
      const reviewed = entry.reviewedProductionPaths?.root ?? [];
      const paths = productionPaths(parsePnpmLock(lockfile), entry.package);
      for (const path of paths.filter(path => !reviewed.includes(path))) problems.push(`${entry.id} reaches production through ${path}`);
      for (const path of reviewed.filter(path => !paths.includes(path))) problems.push(`${entry.id}: the reviewed production path ${path} no longer exists; remove it`);
    } else {
      const lock = JSON.parse(lockfile);
      check(object(lock?.packages), `${project}/package-lock.json has no packages`);
      if (advisory.nodes.length === 0) problems.push(`${entry.id} reports no installed location to check`);
      for (const node of advisory.nodes.filter(node => lock.packages[node]?.dev !== true)) {
        problems.push(`${entry.id} reaches production through ${project}/${node}`);
      }
    }
  }
  for (const entry of entries.filter(entry => !used.has(entry))) problems.push(`${entry.id} is no longer reported for ${project}; remove its exception`);
  if (problems.length > 0) throw new Error(problems.map(problem => `Dependency audit rejected: ${problem}`).join('\n'));
  return advisories.map(({ id, package: name, severity }) => ({ id, package: name, severity }));
}

// Compare real paths: a symlinked checkout must not turn the CLI into a silent no-op.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    if (process.argv.length !== 5) throw new Error('Usage: node scripts/ci-dependency-audit.mjs PROJECT REPORT AUDIT_EXIT_STATUS');
    const [project, reportPath, status] = process.argv.slice(2);
    check(PROJECTS.includes(project), `unknown project ${project}`);
    const text = path => readFileSync(path, 'utf8');
    let report;
    try { report = JSON.parse(text(reportPath)); } catch (error) { check(false, `${reportPath} is not readable JSON (${error.message})`); }
    const lockfile = text(new URL(project === 'root' ? '../pnpm-lock.yaml' : `../${project}/package-lock.json`, import.meta.url));
    const exceptions = JSON.parse(text(new URL('./dependency-audit-exceptions.json', import.meta.url)));
    for (const { id, package: name, severity } of evaluateAudit({ project, report, status, exceptions, lockfile })) {
      console.log(`::warning title=Reviewed dependency audit exception::${id} (${name}, ${severity}) is excepted for ${project}; see scripts/dependency-audit-exceptions.json`);
    }
    console.log(`Dependency audit (${project}): no unreviewed high or critical advisory.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
