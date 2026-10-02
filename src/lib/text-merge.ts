import DiffMatchPatch from 'diff-match-patch';

const dmp = new DiffMatchPatch();

export type MergeResult =
  | { ok: true; merged: string }
  | { ok: false; conflict: true };

/**
 * Merge only disjoint edits in base coordinates. Fuzzy patch success is not
 * conflict detection: it can silently replace another author's changed text.
 */
export function mergeText(base: string, local: string, remote: string): MergeResult {
  // Fast path: no remote change
  if (base === remote) return { ok: true, merged: local };
  // Fast path: no local change — accept remote
  if (base === local) return { ok: true, merged: remote };
  // Fast path: both made same change
  if (local === remote) return { ok: true, merged: local };

  type Edit = { start: number; end: number; text: string };
  const edits = (text: string): Edit[] => {
    const result: Edit[] = [];
    const diffs = dmp.diff_main(base, text);
    dmp.diff_cleanupSemantic(diffs);
    let offset = 0;
    let edit: Edit | undefined;
    for (const [op, value] of diffs) {
      if (op === DiffMatchPatch.DIFF_EQUAL) {
        edit = undefined;
        offset += value.length;
      } else {
        if (!edit) { edit = { start: offset, end: offset, text: '' }; result.push(edit); }
        if (op === DiffMatchPatch.DIFF_DELETE) { offset += value.length; edit.end = offset; }
        else edit.text += value;
      }
    }
    return result;
  };
  const combined = edits(local);
  for (const remoteEdit of edits(remote)) {
    let duplicate = false;
    for (const localEdit of combined) {
      if (localEdit.start === remoteEdit.start && localEdit.end === remoteEdit.end && localEdit.text === remoteEdit.text) {
        duplicate = true;
        break;
      }
      // Insertions at a changed boundary are ambiguous too; ask the user.
      const overlaps = localEdit.start === localEdit.end || remoteEdit.start === remoteEdit.end
        ? localEdit.start <= remoteEdit.end && remoteEdit.start <= localEdit.end
        : localEdit.start < remoteEdit.end && remoteEdit.start < localEdit.end;
      if (overlaps) return { ok: false, conflict: true };
    }
    if (!duplicate) combined.push(remoteEdit);
  }
  let merged = base;
  for (const edit of combined.sort((a, b) => b.start - a.start)) merged = merged.slice(0, edit.start) + edit.text + merged.slice(edit.end);
  return { ok: true, merged };
}

/**
 * Map a cursor position from oldText to the equivalent position in newText
 * by walking character-level diffs.
 */
export function adjustCursor(oldText: string, newText: string, cursorPos: number): number {
  if (oldText === newText) return cursorPos;

  const diffs = dmp.diff_main(oldText, newText);
  let oldIdx = 0;
  let newIdx = 0;

  for (const [op, text] of diffs) {
    if (op === DiffMatchPatch.DIFF_EQUAL) {
      const len = text.length;
      if (oldIdx + len >= cursorPos) {
        // Cursor falls within this equal segment
        return newIdx + (cursorPos - oldIdx);
      }
      oldIdx += len;
      newIdx += len;
    } else if (op === DiffMatchPatch.DIFF_DELETE) {
      const len = text.length;
      if (oldIdx + len >= cursorPos) {
        // Cursor was inside deleted text — snap to current newIdx
        return newIdx;
      }
      oldIdx += len;
    } else if (op === DiffMatchPatch.DIFF_INSERT) {
      newIdx += text.length;
    }
  }

  return newIdx;
}
