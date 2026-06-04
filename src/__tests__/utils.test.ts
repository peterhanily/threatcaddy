import { describe, it, expect } from 'vitest';
import { formatDate, formatFullDate, wordCount, truncate, isOverdue, cn } from '../lib/utils';

describe('formatDate', () => {
  it('returns "Just now" for recent timestamps', () => {
    expect(formatDate(Date.now())).toBe('Just now');
  });

  it('returns minutes ago for recent past', () => {
    const fiveMinAgo = Date.now() - 5 * 60000;
    expect(formatDate(fiveMinAgo)).toBe('5m ago');
  });

  it('returns hours ago within 24h', () => {
    const threeHoursAgo = Date.now() - 3 * 3600000;
    expect(formatDate(threeHoursAgo)).toBe('3h ago');
  });

  it('returns days ago within a week', () => {
    const twoDaysAgo = Date.now() - 2 * 86400000;
    expect(formatDate(twoDaysAgo)).toBe('2d ago');
  });

  it('returns formatted date for older dates', () => {
    const oldDate = new Date('2024-03-15').getTime();
    const result = formatDate(oldDate);
    expect(result).toContain('Mar');
    expect(result).toContain('15');
  });
});

describe('formatFullDate', () => {
  it('returns a full human-readable date string', () => {
    const ts = new Date('2024-06-15T10:30:00').getTime();
    const result = formatFullDate(ts);
    expect(result).toContain('June');
    expect(result).toContain('15');
    expect(result).toContain('2024');
  });
});

describe('wordCount', () => {
  it('counts words and characters', () => {
    expect(wordCount('hello world')).toEqual({ words: 2, chars: 11 });
  });

  it('returns zero for empty string', () => {
    expect(wordCount('')).toEqual({ words: 0, chars: 0 });
  });

  it('returns zero for whitespace-only string', () => {
    expect(wordCount('   ')).toEqual({ words: 0, chars: 0 });
  });

  it('handles multiple spaces between words', () => {
    expect(wordCount('hello   world')).toEqual({ words: 2, chars: 13 });
  });

  it('handles newlines and tabs', () => {
    expect(wordCount('hello\nworld\tthere')).toEqual({ words: 3, chars: 17 });
  });
});

describe('truncate', () => {
  it('returns short text unchanged', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncates long text with ellipsis', () => {
    expect(truncate('hello world this is long', 10)).toBe('hello worl...');
  });

  it('handles exact length', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });
});

describe('isOverdue', () => {
  it('returns false for undefined', () => {
    expect(isOverdue(undefined)).toBe(false);
  });

  it('returns false for future date', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(isOverdue(tomorrow.toISOString().split('T')[0])).toBe(false);
  });

  it('returns true for past date', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(isOverdue(yesterday.toISOString().split('T')[0])).toBe(true);
  });

  it('returns false for today', () => {
    // Use the LOCAL calendar date (isOverdue compares in local time); toISOString
    // would give the UTC date, which can differ near midnight in non-UTC zones.
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(isOverdue(today)).toBe(false);
  });
});

describe('cn', () => {
  it('joins class strings', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('filters out falsy values', () => {
    expect(cn('foo', false, null, undefined, 'bar')).toBe('foo bar');
  });

  it('returns empty string for no truthy values', () => {
    expect(cn(false, null, undefined)).toBe('');
  });
});
