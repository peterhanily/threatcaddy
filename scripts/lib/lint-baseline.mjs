import { relative, sep } from 'node:path';

/** Baseline allowances are counts for one file and rule, never global limits. */
export function checkLintBaseline(results, baseline, root) {
  if (baseline?.version !== 1 || !baseline.warnings || typeof baseline.warnings !== 'object' || Array.isArray(baseline.warnings)) {
    throw new Error('Invalid lint warning baseline');
  }
  for (const [file, rules] of Object.entries(baseline.warnings)) {
    if (!file || file.startsWith('/') || file.includes('\\') || file.includes(':') || file.split('/').includes('..')
      || !rules || typeof rules !== 'object' || Array.isArray(rules)
      || Object.values(rules).some(value => !Number.isSafeInteger(value) || value < 0)) {
      throw new Error('Lint baseline must contain portable relative paths and nonnegative rule counts');
    }
  }
  const current = {};
  let errors = 0;
  let warnings = 0;
  for (const result of results) {
    const file = relative(root, result.filePath).split(sep).join('/');
    for (const message of result.messages) {
      if (message.severity === 2) { errors++; continue; }
      if (message.severity !== 1) continue;
      warnings++;
      const rule = message.ruleId || 'unused-eslint-disable';
      current[file] ||= {};
      current[file][rule] = (current[file][rule] || 0) + 1;
    }
  }
  const regressions = [];
  for (const file of Object.keys(current).sort()) {
    for (const rule of Object.keys(current[file]).sort()) {
      const allowed = baseline.warnings[file]?.[rule] || 0;
      if (current[file][rule] > allowed) regressions.push({ file, rule, allowed, actual: current[file][rule] });
    }
  }
  return { errors, warnings, regressions, ok: errors === 0 && regressions.length === 0 };
}
