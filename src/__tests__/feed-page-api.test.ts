import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureServerApi, fetchFeed, fetchPost, fetchPostPage } from '../lib/server-api';

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  configureServerApi('http://synthetic-server.invalid', async () => 'synthetic-token');
  fetchMock.mockReset();
});
afterEach(() => { configureServerApi(null, async () => null); vi.unstubAllGlobals(); });

describe('explicit opt-in feed API compatibility', () => {
  it('opts into reply pages and reaction summaries without changing the legacy fetchPost function', async () => {
    const legacy = { id: 'root', replies: [{ id: 'one' }, { id: 'two' }] };
    fetchMock.mockImplementation(async () => Response.json(legacy));
    expect(await fetchPostPage('root', 'opaque-cursor')).toEqual(legacy);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get('replies')).toBe('page');
    expect(url.searchParams.get('reactions')).toBe('summary');
    expect(url.searchParams.get('limit')).toBe('50');
    expect(url.searchParams.get('cursor')).toBe('opaque-cursor');
    await fetchPost('root');
    expect(fetchMock.mock.calls[1][0]).toBe('http://synthetic-server.invalid/api/caddyshack/posts/root');
  });
  it('requests compact feed reactions while retaining the array response', async () => {
    fetchMock.mockResolvedValueOnce(Response.json([{ id: 'root' }]));
    expect(await fetchFeed({ folderId: 'case-a', limit: 50 })).toEqual([{ id: 'root' }]);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get('reactions')).toBe('summary');
    expect(url.searchParams.get('folderId')).toBe('case-a');
  });
  it('retains status on refused pages so the UI can hide revoked content', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'No longer available' }, { status: 403 }));
    await expect(fetchPostPage('root')).rejects.toMatchObject({ status: 403, message: 'No longer available' });
  });
});
