/**
 * Safe expression evaluator for the integration platform (server-side).
 * NO eval(), NO new Function(). Pure string parsing and object traversal.
 *
 * Mirrors client-side src/lib/integration-expression.ts
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEMPLATE_RE = /\{\{([^}]+)\}\}/g;

/**
 * Walk a dot-separated path into an object, supporting numeric array indices.
 * Returns `undefined` when the path cannot be resolved.
 */
function walkPath(obj: unknown, path: string): unknown {
  const segments = path.trim().split('.');
  let current: unknown = obj;
  for (const seg of segments) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

/** Coerce a resolved value to a display string. */
function valueToString(val: unknown): string {
  if (val === undefined || val === null) return '';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

// ---------------------------------------------------------------------------
// 1. resolveVariables
// ---------------------------------------------------------------------------

/**
 * Replace `{{path.to.value}}` tokens in a template string with values from
 * `context`. Objects / arrays are JSON-stringified; unresolvable paths become
 * empty strings.
 */
export function resolveVariables(
  template: string,
  context: Record<string, unknown>,
): string {
  return template.replace(TEMPLATE_RE, (_, path: string) => {
    const val = walkPath(context, path);
    return valueToString(val);
  });
}

// ---------------------------------------------------------------------------
// 2. evaluateCondition
// ---------------------------------------------------------------------------

type Operator =
  | '=='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | 'exists'
  | 'not-exists'
  | 'contains'
  | 'startsWith'
  | 'endsWith';

const OPERATORS: Operator[] = [
  '!=',
  '==',
  '>=',
  '<=',
  '>',
  '<',
  'not-exists',
  'exists',
  'contains',
  'startsWith',
  'endsWith',
];

/**
 * Split an expression around the first recognised operator.
 * Returns `[left, operator, right]` or `null` if no operator found.
 */
function splitOperator(
  expr: string,
): [string, Operator, string] | null {
  const trimmed = expr.trim();
  for (const op of OPERATORS) {
    // For word-based operators, ensure they are surrounded by whitespace so we
    // don't match partial words (e.g. "existsNot").
    if (/^[a-z]/.test(op)) {
      const re = new RegExp(`\\s+${op}(?:\\s+|$)`);
      const match = re.exec(trimmed);
      if (match) {
        const idx = match.index;
        const left = trimmed.slice(0, idx).trim();
        const right = trimmed.slice(idx + match[0].length).trim();
        return [left, op, right];
      }
    } else {
      // Symbol operators like ==, !=, >=, etc.
      const idx = trimmed.indexOf(` ${op} `);
      if (idx !== -1) {
        const left = trimmed.slice(0, idx).trim();
        const right = trimmed.slice(idx + op.length + 2).trim();
        return [left, op, right];
      }
    }
  }
  return null;
}

/**
 * Evaluate a single comparison expression (no `and`/`or`).
 */
function evaluateSingle(
  expr: string,
  context: Record<string, unknown>,
): boolean {
  // Resolve all {{...}} tokens first so the expression contains plain values.
  const resolved = resolveVariables(expr, context);

  const parts = splitOperator(resolved);
  if (!parts) {
    // No operator found — treat non-empty resolved string as truthy.
    return resolved.trim().length > 0;
  }

  const [left, op, right] = parts;

  switch (op) {
    case 'exists':
      return left !== '';
    case 'not-exists':
      return left === '';
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    case '>':
      return Number(left) > Number(right);
    case '>=':
      return Number(left) >= Number(right);
    case '<':
      return Number(left) < Number(right);
    case '<=':
      return Number(left) <= Number(right);
    case 'contains':
      return left.includes(right);
    case 'startsWith':
      return left.startsWith(right);
    case 'endsWith':
      return left.endsWith(right);
    default:
      return false;
  }
}

/**
 * Split a compound expression on ` and ` / ` or ` combinators.
 * Returns an array of `{ expr, combinator }` entries evaluated left-to-right
 * (no precedence — matches spec).
 */
function splitCombinators(
  expression: string,
): { expr: string; combinator: 'and' | 'or' | null }[] {
  const results: { expr: string; combinator: 'and' | 'or' | null }[] = [];
  let remaining = expression;

  for (;;) {
    // Find the first ` and ` or ` or ` (must be surrounded by spaces).
    const andIdx = remaining.indexOf(' and ');
    const orIdx = remaining.indexOf(' or ');

    let chosen: 'and' | 'or' | null = null;
    let idx = -1;
    if (andIdx !== -1 && (orIdx === -1 || andIdx < orIdx)) {
      chosen = 'and';
      idx = andIdx;
    } else if (orIdx !== -1) {
      chosen = 'or';
      idx = orIdx;
    }

    if (chosen === null || idx === -1) {
      results.push({ expr: remaining.trim(), combinator: null });
      break;
    }

    const left = remaining.slice(0, idx).trim();
    const skipLen = chosen === 'and' ? 5 : 4; // ' and ' or ' or '
    remaining = remaining.slice(idx + skipLen);
    results.push({ expr: left, combinator: chosen });
  }

  return results;
}

/**
 * Evaluate a comparison expression. Supports `and` / `or` combinators
 * evaluated strictly left-to-right (no operator precedence).
 *
 * Examples:
 * - `{{path}} == value`
 * - `{{a}} > 5 and {{b}} contains hello`
 */
export function evaluateCondition(
  expression: string,
  context: Record<string, unknown>,
): boolean {
  const parts = splitCombinators(expression);
  let result = evaluateSingle(parts[0].expr, context);

  for (let i = 0; i < parts.length - 1; i++) {
    const nextResult = evaluateSingle(parts[i + 1].expr, context);
    if (parts[i].combinator === 'and') {
      result = result && nextResult;
    } else {
      result = result || nextResult;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// 3. resolveDeep
// ---------------------------------------------------------------------------

/**
 * Recursively walk an object/array and resolve all `{{...}}` tokens found in
 * string values. Non-string leaves are returned as-is.
 */
export function resolveDeep(
  obj: unknown,
  context: Record<string, unknown>,
): unknown {
  if (typeof obj === 'string') {
    return resolveVariables(obj, context);
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => resolveDeep(item, context));
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      result[key] = resolveDeep(val, context);
    }
    return result;
  }
  // Primitives (number, boolean, null, undefined) pass through.
  return obj;
}
