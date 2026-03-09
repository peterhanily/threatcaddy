import DiffMatchPatch from 'diff-match-patch';

const dmp = new DiffMatchPatch();

export interface DiffSegment {
  type: 'equal' | 'insert' | 'delete';
  text: string;
}

/**
 * Compute a character-level diff between two strings.
 * Uses diff-match-patch for quality, then optionally cleans up for readability.
 */
export function computeDiff(oldText: string, newText: string): DiffSegment[] {
  const diffs = dmp.diff_main(oldText, newText);
  dmp.diff_cleanupSemantic(diffs);

  return diffs.map(([op, text]) => ({
    type: op === DiffMatchPatch.DIFF_EQUAL ? 'equal' : op === DiffMatchPatch.DIFF_INSERT ? 'insert' : 'delete',
    text,
  }));
}

/**
 * Compute field-level diffs for structured entities (tasks, timeline events, IOCs).
 * Compares scalar fields and returns a list of changed fields with old/new values.
 */
export interface FieldDiff {
  field: string;
  label: string;
  oldValue: string;
  newValue: string;
}

const FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  content: 'Content',
  description: 'Description',
  status: 'Status',
  priority: 'Priority',
  name: 'Name',
  value: 'Value',
  type: 'Type',
  notes: 'Notes',
  category: 'Category',
  timestamp: 'Timestamp',
  source: 'Source',
};

export function computeFieldDiffs(
  localData: Record<string, unknown>,
  serverData: Record<string, unknown>,
): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  const allKeys = new Set([...Object.keys(localData), ...Object.keys(serverData)]);

  for (const key of allKeys) {
    // Skip internal/meta fields
    if (['id', 'createdAt', 'updatedAt', 'version', 'folderId', 'syncedAt', 'trashedAt'].includes(key)) continue;

    const local = localData[key];
    const server = serverData[key];

    // Skip unchanged
    if (JSON.stringify(local) === JSON.stringify(server)) continue;

    // Only compare displayable fields
    const localStr = local == null ? '' : typeof local === 'object' ? JSON.stringify(local) : String(local);
    const serverStr = server == null ? '' : typeof server === 'object' ? JSON.stringify(server) : String(server);

    // Skip very long fields in field-level view (content is handled by full diff)
    if (localStr.length > 500 || serverStr.length > 500) continue;

    diffs.push({
      field: key,
      label: FIELD_LABELS[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()),
      oldValue: localStr,
      newValue: serverStr,
    });
  }

  return diffs;
}
