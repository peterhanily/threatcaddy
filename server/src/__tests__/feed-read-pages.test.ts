import { describe, expect, it } from 'vitest';
import { encodeReplyCursor, FeedReadInputError, parseReplyPage } from '../services/feed-read.js';

describe('additive reply-page query contract', () => {
  it('defaults to50 and caps requested larger pages', () => {
    expect(parseReplyPage('root')).toEqual({ limit: 50 });
    expect(parseReplyPage('root', '100')).toEqual({ limit: 50 });
    expect(parseReplyPage('root', '12')).toEqual({ limit: 12 });
  });
  it.each(['0', '-1', '1.5', 'none', ''])('rejects an invalid limit: %s', value => {
    expect(() => parseReplyPage('root', value)).toThrow(FeedReadInputError);
  });
  it('roundtrips the exact PostgreSQL timestamp and tie-breaking ID', () => {
    const cursor = { postId: 'root', createdAt: '2026-10-10T12:34:56.123456Z', id: 'reply-001' };
    expect(parseReplyPage('root', undefined, encodeReplyCursor(cursor))).toEqual({ limit: 50, cursor });
  });
  it('rejects a cursor for a different thread', () => {
    const cursor = encodeReplyCursor({ postId: 'another-root', createdAt: '2026-10-10T12:34:56.123456Z', id: 'reply' });
    expect(() => parseReplyPage('root', '50', cursor)).toThrow(/another post/);
  });
  it('rejects a malformed date or cursor without falling back to the first page', () => {
    const cursor = encodeReplyCursor({ postId: 'root', createdAt: '2026-02-30T12:34:56.123456Z', id: 'reply' });
    expect(() => parseReplyPage('root', undefined, cursor)).toThrow(FeedReadInputError);
    expect(() => parseReplyPage('root', undefined, 'not-a-cursor')).toThrow(FeedReadInputError);
  });
});
