/** Bound JSON traversal before schema cloning or service preparation. */
export const SYNC_DATA_LIMITS = Object.freeze({ fields: 200, fieldName: 128, arrayItems: 5000, depth: 8, nodes: 100_000 });

export function syncDataWithinBudget(changes: readonly unknown[]): boolean {
  let remaining = SYNC_DATA_LIMITS.nodes;
  const visit = (value: unknown, depth: number): boolean => {
    if (--remaining < 0 || depth > SYNC_DATA_LIMITS.depth) return false;
    if (value === null || typeof value !== 'object') return true;
    if (Array.isArray(value)) {
      if (value.length > SYNC_DATA_LIMITS.arrayItems) return false;
      return value.every(item => visit(item, depth + 1));
    }
    let fields = 0;
    // Do not allocate Object.entries/keys for an unbounded dictionary.
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      if (++fields > SYNC_DATA_LIMITS.fields || (depth === 0 && key.length > SYNC_DATA_LIMITS.fieldName)) return false;
      if (!visit((value as Record<string, unknown>)[key], depth + 1)) return false;
    }
    return true;
  };
  return changes.every(change => !change || typeof change !== 'object' || !('data' in change) || visit(change.data, 0));
}
