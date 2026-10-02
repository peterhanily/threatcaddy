import { describe, it, expect } from 'vitest';
import { mergeText, adjustCursor } from '../lib/text-merge';
import type { MergeResult } from '../lib/text-merge';

// ── mergeText ──────────────────────────────────────────────────────

describe('mergeText', () => {
  // --- Fast paths ---

  describe('fast paths', () => {
    it('accepts remote when no local changes', () => {
      const r = mergeText('A', 'A', 'B');
      expect(r).toEqual({ ok: true, merged: 'B' });
    });

    it('keeps local when no remote changes', () => {
      const r = mergeText('A', 'A!', 'A');
      expect(r).toEqual({ ok: true, merged: 'A!' });
    });

    it('returns local when both sides made the same change', () => {
      const r = mergeText('A', 'B', 'B');
      expect(r).toEqual({ ok: true, merged: 'B' });
    });

    it('no-ops when base, local, and remote are all equal', () => {
      const r = mergeText('hello', 'hello', 'hello');
      expect(r).toEqual({ ok: true, merged: 'hello' });
    });

    it('fast-path results always return ok: true', () => {
      expect(mergeText('x', 'x', 'y').ok).toBe(true); // no local change
      expect(mergeText('x', 'y', 'x').ok).toBe(true); // no remote change
      expect(mergeText('x', 'y', 'y').ok).toBe(true); // same change
    });

    it('returns ok: true with merged string on success', () => {
      const r = mergeText('a', 'a', 'b');
      expect(r.ok).toBe(true);
      expect('merged' in r).toBe(true);
      expect('conflict' in r).toBe(false);
    });
  });

  // --- 3-way merge scenarios ---

  describe('three-way merge', () => {
    it('merges non-overlapping edits at beginning and end', () => {
      const r = mergeText('hello world', 'HI world', 'hello WORLD');
      expect(r.ok).toBe(true);
      expect((r as Extract<MergeResult, { ok: true }>).merged).toBe('HI WORLD');
    });

    it('merges edits on different lines', () => {
      const r = mergeText(
        'line1\nline2\nline3',
        'LINE1\nline2\nline3',
        'line1\nline2\nLINE3',
      );
      expect(r.ok).toBe(true);
      expect((r as Extract<MergeResult, { ok: true }>).merged).toBe('LINE1\nline2\nLINE3');
    });

    it('handles remote insertion when local is unchanged', () => {
      const r = mergeText('foo bar', 'foo bar', 'foo baz bar');
      expect(r).toEqual({ ok: true, merged: 'foo baz bar' });
    });

    it('handles remote deletion with local addition elsewhere', () => {
      const r = mergeText('aaa bbb ccc', 'aaa bbb ccc ddd', 'aaa ccc');
      expect(r.ok).toBe(true);
      const merged = (r as Extract<MergeResult, { ok: true }>).merged;
      expect(merged).toContain('aaa');
      expect(merged).toContain('ccc');
      expect(merged).toContain('ddd');
    });

    it('merges edits in a large multi-paragraph note', () => {
      const base = 'Paragraph one.\n\nParagraph two.\n\nParagraph three.\n\nParagraph four.';
      const local = 'Paragraph one EDITED.\n\nParagraph two.\n\nParagraph three.\n\nParagraph four.';
      const remote = 'Paragraph one.\n\nParagraph two.\n\nParagraph three.\n\nParagraph four EDITED.';
      const r = mergeText(base, local, remote);
      expect(r.ok).toBe(true);
      const merged = (r as Extract<MergeResult, { ok: true }>).merged;
      expect(merged).toContain('Paragraph one EDITED.');
      expect(merged).toContain('Paragraph four EDITED.');
    });

    it('merges local insertion at start and remote insertion at end', () => {
      const base = 'middle content';
      const local = 'PREFIX middle content';
      const remote = 'middle content SUFFIX';
      const r = mergeText(base, local, remote);
      expect(r.ok).toBe(true);
      const merged = (r as Extract<MergeResult, { ok: true }>).merged;
      expect(merged).toContain('PREFIX');
      expect(merged).toContain('SUFFIX');
    });

    it('merges local deletion at start and remote addition at end', () => {
      const base = 'remove-me important text';
      const local = 'important text';
      const remote = 'remove-me important text added-part';
      const r = mergeText(base, local, remote);
      expect(r.ok).toBe(true);
      const merged = (r as Extract<MergeResult, { ok: true }>).merged;
      expect(merged).toContain('important text');
      expect(merged).toContain('added-part');
      expect(merged).not.toContain('remove-me');
    });

    it('merges non-overlapping multiline insertions', () => {
      const base = 'A\nB\nC\nD\nE';
      const local = 'A\nB\nX\nC\nD\nE';   // inserted X after B
      const remote = 'A\nB\nC\nD\nY\nE';  // inserted Y after D
      const r = mergeText(base, local, remote);
      expect(r.ok).toBe(true);
      const merged = (r as Extract<MergeResult, { ok: true }>).merged;
      expect(merged).toContain('X');
      expect(merged).toContain('Y');
    });

    it('merges replacements on different lines', () => {
      const base = 'line A\nline B\nline C\nline D';
      const local = 'line A\nLOCAL B\nline C\nline D';
      const remote = 'line A\nline B\nline C\nREMOTE D';
      const r = mergeText(base, local, remote);
      expect(r.ok).toBe(true);
      const merged = (r as Extract<MergeResult, { ok: true }>).merged;
      expect(merged).toContain('LOCAL B');
      expect(merged).toContain('REMOTE D');
    });
  });

  // --- Conflict detection ---

  describe('conflict detection', () => {
    it('reports conflict when both sides modify the same region differently', () => {
      // Both sides change the same word to different values
      const r = mergeText('The cat sat', 'The dog sat', 'The bird sat');
      expect(r).toEqual({ ok: false, conflict: true });
    });

    it('conflict result has ok: false and conflict: true when patches fail', () => {
      // Construct a scenario where patches definitely cannot apply cleanly
      // by making the local text completely different from what the patch expects
      const base = 'AAAA BBBB CCCC DDDD';
      const remote = 'XXXX BBBB CCCC DDDD'; // changed AAAA->XXXX
      const local = 'ZZZZ YYYY WWWW VVVV';  // completely different
      const r = mergeText(base, local, remote);
      // The result must have 'ok' property regardless
      expect(r).toHaveProperty('ok');
      if (!r.ok) {
        expect(r).toEqual({ ok: false, conflict: true });
      }
    });
  });

  // --- Empty string edge cases ---

  describe('empty string edge cases', () => {
    it('handles all three inputs empty', () => {
      const r = mergeText('', '', '');
      expect(r).toEqual({ ok: true, merged: '' });
    });

    it('handles empty base with remote content (no local change)', () => {
      const r = mergeText('', '', 'new content');
      expect(r).toEqual({ ok: true, merged: 'new content' });
    });

    it('handles empty base with local content (no remote change)', () => {
      const r = mergeText('', 'local stuff', '');
      expect(r).toEqual({ ok: true, merged: 'local stuff' });
    });

    it('handles base empty with both local and remote adding content', () => {
      const r = mergeText('', 'local', 'remote');
      // Both diverged from empty — goes through patch_apply
      expect(r.ok).toBeDefined();
    });

    it('handles local emptied (deletion) with no remote change', () => {
      const r = mergeText('some content', '', 'some content');
      expect(r).toEqual({ ok: true, merged: '' });
    });

    it('handles remote emptied (deletion) with no local change', () => {
      const r = mergeText('some content', 'some content', '');
      expect(r).toEqual({ ok: true, merged: '' });
    });

    it('handles both sides deleting to empty', () => {
      const r = mergeText('some content', '', '');
      expect(r).toEqual({ ok: true, merged: '' });
    });
  });

  // --- Special characters ---

  describe('special characters', () => {
    it('handles unicode content', () => {
      const base = 'Hello world';
      const local = 'Hello world';
      const remote = 'Hello world \u{1F30D}';
      const r = mergeText(base, local, remote);
      expect(r).toEqual({ ok: true, merged: 'Hello world \u{1F30D}' });
    });

    it('handles markdown-style content', () => {
      const base = '# Title\n\n- item 1\n- item 2';
      const local = '# Title\n\n- item 1\n- item 2\n- item 3';
      const remote = '# Updated Title\n\n- item 1\n- item 2';
      const r = mergeText(base, local, remote);
      expect(r.ok).toBe(true);
      const merged = (r as Extract<MergeResult, { ok: true }>).merged;
      expect(merged).toContain('Updated Title');
      expect(merged).toContain('item 3');
    });

    it('handles content with newlines and tabs', () => {
      const base = 'line1\n\tindented\nline3';
      const local = 'line1\n\tindented\nline3';
      const remote = 'line1\n\tindented\n\tnew line\nline3';
      const r = mergeText(base, local, remote);
      expect(r).toEqual({ ok: true, merged: 'line1\n\tindented\n\tnew line\nline3' });
    });

    it('handles very long single-line text', () => {
      const base = 'a'.repeat(10000);
      const local = 'X' + 'a'.repeat(9999);
      const remote = 'a'.repeat(9999) + 'Y';
      const r = mergeText(base, local, remote);
      expect(r.ok).toBe(true);
      const merged = (r as Extract<MergeResult, { ok: true }>).merged;
      expect(merged.startsWith('X')).toBe(true);
      expect(merged.endsWith('Y')).toBe(true);
    });
  });

  // --- Whitespace-only changes ---

  describe('whitespace changes', () => {
    it('handles adding trailing whitespace remotely', () => {
      const base = 'no trailing';
      const local = 'no trailing';
      const remote = 'no trailing   ';
      const r = mergeText(base, local, remote);
      expect(r).toEqual({ ok: true, merged: 'no trailing   ' });
    });

    it('handles newline-only differences', () => {
      const base = 'a\nb';
      const local = 'a\nb';
      const remote = 'a\n\nb';
      const r = mergeText(base, local, remote);
      expect(r).toEqual({ ok: true, merged: 'a\n\nb' });
    });
  });
});

// ── adjustCursor ───────────────────────────────────────────────────

describe('adjustCursor', () => {
  describe('identity and basic shifts', () => {
    it('returns same position when texts are identical', () => {
      expect(adjustCursor('hello', 'hello', 3)).toBe(3);
    });

    it('shifts cursor forward after insertion before cursor', () => {
      expect(adjustCursor('hello', 'XXhello', 3)).toBe(5);
    });

    it('shifts cursor backward after deletion before cursor', () => {
      expect(adjustCursor('XXhello', 'hello', 5)).toBe(3);
    });

    it('keeps cursor stable when changes are after cursor', () => {
      expect(adjustCursor('hello world', 'hello WORLD', 3)).toBe(3);
    });
  });

  describe('cursor at boundaries', () => {
    it('handles cursor at position 0 with insertion before it', () => {
      expect(adjustCursor('abc', 'Xabc', 0)).toBe(1);
    });

    it('handles cursor at end of text', () => {
      expect(adjustCursor('abc', 'abcXX', 3)).toBe(3);
    });

    it('handles cursor at position 0 with no change', () => {
      expect(adjustCursor('abc', 'abc', 0)).toBe(0);
    });

    it('handles cursor at end of old text with append', () => {
      expect(adjustCursor('abc', 'abcdef', 3)).toBe(3);
    });
  });

  describe('cursor inside modified regions', () => {
    it('snaps cursor to start of deletion when inside deleted region', () => {
      expect(adjustCursor('abcdef', 'adef', 2)).toBe(1);
    });

    it('snaps cursor at boundary of deleted text', () => {
      // "abcdef" -> "aef", deleting "bcd" (indices 1-3)
      // cursor at 3 (inside deleted region) should snap to newIdx
      const result = adjustCursor('abcdef', 'aef', 3);
      expect(result).toBe(1);
    });

    it('handles cursor right after deleted region', () => {
      // "abcdef" -> "aef", deleting "bcd" (indices 1-3)
      // cursor at 4 (after deleted region) should map forward
      const result = adjustCursor('abcdef', 'aef', 4);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual('aef'.length);
    });
  });

  describe('empty text edge cases', () => {
    it('handles empty old text (cursor at 0)', () => {
      expect(adjustCursor('', 'abc', 0)).toBe(3);
    });

    it('handles empty new text', () => {
      expect(adjustCursor('abc', '', 2)).toBe(0);
    });

    it('handles both texts empty', () => {
      expect(adjustCursor('', '', 0)).toBe(0);
    });
  });

  describe('multiple edits', () => {
    it('handles multiple insertions and deletions', () => {
      const result = adjustCursor('abcdef', 'Xabef', 4);
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual('Xabef'.length);
    });

    it('clamps to valid range for complete replacement', () => {
      const result = adjustCursor('abc', 'de', 3);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(2);
    });

    it('handles replacement of text where cursor is in unchanged prefix', () => {
      // "hello world" -> "hello earth", cursor at 2 (inside "hello")
      const result = adjustCursor('hello world', 'hello earth', 2);
      expect(result).toBe(2);
    });

    it('handles insertion in the middle with cursor before insert point', () => {
      // "abcd" -> "abXXcd", cursor at 1 (in "a" portion, before insert)
      const result = adjustCursor('abcd', 'abXXcd', 1);
      expect(result).toBe(1);
    });

    it('handles insertion in the middle with cursor after insert point', () => {
      // "abcd" -> "abXXcd", cursor at 3 (after insert point)
      const result = adjustCursor('abcd', 'abXXcd', 3);
      expect(result).toBe(5);
    });
  });

  describe('real-world scenarios', () => {
    it('tracks cursor through a typical collaborative edit', () => {
      // User is typing at position 5 in "Hello world"
      // Remote user changes "world" to "earth"
      // Cursor should stay at position 5 (within "Hello" which is unchanged)
      expect(adjustCursor('Hello world', 'Hello earth', 5)).toBe(5);
    });

    it('adjusts cursor when remote inserts a line before cursor line', () => {
      const old = 'line1\nline2';
      const newText = 'line0\nline1\nline2';
      // Cursor at position 8 (in "line2")
      expect(adjustCursor(old, newText, 8)).toBe(14);
    });

    it('returns a valid position for any input', () => {
      // Property: result should always be in [0, newText.length]
      const cases = [
        { old: 'abc', new: 'xyz', cursor: 0 },
        { old: 'abc', new: 'xyz', cursor: 1 },
        { old: 'abc', new: 'xyz', cursor: 2 },
        { old: 'abc', new: 'xyz', cursor: 3 },
        { old: 'abc', new: '', cursor: 1 },
        { old: '', new: 'abc', cursor: 0 },
      ];
      for (const c of cases) {
        const result = adjustCursor(c.old, c.new, c.cursor);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(c.new.length);
      }
    });
  });
});
