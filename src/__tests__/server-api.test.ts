import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configureServerApi, fetchMe, syncPush, syncPull, fetchInvestigations, uploadFile, getFileUrl, updateProfile, fetchServerInfo } from '../lib/server-api';

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// ---------------------------------------------------------------------------
// server-api
// ---------------------------------------------------------------------------

describe('server-api', () => {
  const mockGetToken = vi.fn();
  const mockInvalidateToken = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    configureServerApi('http://test-server', mockGetToken, mockInvalidateToken);
    mockGetToken.mockResolvedValue('test-token');
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(''),
      blob: () => Promise.resolve(new Blob()),
    });
  });

  // ─── configureServerApi ─────────────────────────────────────────

  describe('configureServerApi', () => {
    it('sets the server URL so subsequent calls use it', async () => {
      await fetchMe();
      expect(mockFetch).toHaveBeenCalledWith(
        'http://test-server/api/auth/me',
        expect.any(Object),
      );
    });

    it('uses the provided token getter', async () => {
      mockGetToken.mockResolvedValue('custom-token');
      await fetchMe();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer custom-token',
          }),
        }),
      );
    });

    it('uses the provided invalidate callback on 401', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({}),
      });
      // After invalidation, token getter returns null so no retry
      mockGetToken.mockResolvedValueOnce('test-token').mockResolvedValueOnce(null);

      try { await fetchMe(); } catch { /* expected */ }
      expect(mockInvalidateToken).toHaveBeenCalledTimes(1);
    });
  });

  // ─── apiFetch: Authorization header ─────────────────────────────

  describe('apiFetch — Authorization header', () => {
    it('adds Authorization header when token is available', async () => {
      await fetchMe();
      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers.Authorization).toBe('Bearer test-token');
    });

    it('omits Authorization header when token is null', async () => {
      mockGetToken.mockResolvedValue(null);
      await fetchMe();
      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers.Authorization).toBeUndefined();
    });
  });

  // ─── apiFetch: Content-Type ─────────────────────────────────────

  describe('apiFetch — Content-Type', () => {
    it('sets Content-Type to application/json by default', async () => {
      await fetchMe();
      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers['Content-Type']).toBe('application/json');
    });

    it('does NOT set Content-Type for FormData bodies', async () => {
      // uploadFile uses FormData internally
      const file = new File(['hello'], 'test.txt', { type: 'text/plain' });
      await uploadFile(file);
      const [, opts] = mockFetch.mock.calls[0];
      // Content-Type should NOT be set for FormData — browser sets it with boundary
      expect(opts.headers['Content-Type']).toBeUndefined();
    });
  });

  // ─── apiFetch: no server URL ────────────────────────────────────

  describe('apiFetch — no server URL', () => {
    it('throws when no server URL is configured', async () => {
      configureServerApi(null, mockGetToken, mockInvalidateToken);
      await expect(fetchMe()).rejects.toThrow('Not connected to server');
    });
  });

  // ─── 401 retry logic ───────────────────────────────────────────

  describe('apiFetch — 401 retry logic', () => {
    it('on 401, invalidates token, gets fresh token, retries once', async () => {
      // First call returns 401
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({}),
      });
      // Retry returns 200
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 'user1' }),
      });

      // First getToken call for original request, second for fresh token after invalidation,
      // third for the retry request
      mockGetToken
        .mockResolvedValueOnce('stale-token')
        .mockResolvedValueOnce('fresh-token')
        .mockResolvedValueOnce('fresh-token');

      const result = await fetchMe();

      expect(mockInvalidateToken).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ id: 'user1' });

      // The retry request should use the fresh token
      const [, retryOpts] = mockFetch.mock.calls[1];
      expect(retryOpts.headers.Authorization).toBe('Bearer fresh-token');
    });

    it('does NOT retry if already retried (_retry=true internally)', async () => {
      // Both calls return 401 — should only retry once (2 total fetch calls)
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({}),
      });

      mockGetToken.mockResolvedValue('some-token');

      // fetchMe throws because resp.ok is false
      await expect(fetchMe()).rejects.toThrow('Failed to fetch profile');

      // First attempt + one retry = 2 calls
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockInvalidateToken).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry if fresh token is null', async () => {
      // First call returns 401
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({}),
      });

      // Original token, then null after invalidation
      mockGetToken
        .mockResolvedValueOnce('stale-token')
        .mockResolvedValueOnce(null);

      // Should not retry and should throw because resp.ok is false
      await expect(fetchMe()).rejects.toThrow('Failed to fetch profile');

      // Only 1 fetch call — no retry
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockInvalidateToken).toHaveBeenCalledTimes(1);
    });
  });

  // ─── API function coverage ─────────────────────────────────────

  describe('API functions call correct paths', () => {
    it('fetchMe calls GET /api/auth/me', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 'u1', displayName: 'Test' }),
      });
      const result = await fetchMe();
      expect(mockFetch).toHaveBeenCalledWith(
        'http://test-server/api/auth/me',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
        }),
      );
      expect(result).toEqual({ id: 'u1', displayName: 'Test' });
    });

    it('updateProfile calls PATCH /api/auth/me', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ displayName: 'New Name' }),
      });
      await updateProfile({ displayName: 'New Name' });
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://test-server/api/auth/me');
      expect(opts.method).toBe('PATCH');
      expect(JSON.parse(opts.body)).toEqual({ displayName: 'New Name' });
    });

    it('fetchServerInfo calls GET /api/server/info', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ serverName: 'MyServer' }),
      });
      const result = await fetchServerInfo();
      expect(mockFetch).toHaveBeenCalledWith(
        'http://test-server/api/server/info',
        expect.any(Object),
      );
      expect(result).toEqual({ serverName: 'MyServer' });
    });

    it('syncPush calls POST /api/sync/push with changes', async () => {
      const changes = [{ table: 'iocs', op: 'put' as const, entityId: 'e1', data: { value: '1.2.3.4' } }];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ results: [{ entityId: 'e1', status: 'accepted' }] }),
      });

      const result = await syncPush(changes);

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://test-server/api/sync/push');
      expect(opts.method).toBe('POST');
      expect(JSON.parse(opts.body)).toEqual({ changes });
      expect(result.results[0].status).toBe('accepted');
    });

    it('syncPull calls GET /api/sync/pull with query params', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ changes: [] }),
      });

      await syncPull('2024-01-01T00:00:00Z', 'folder1');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('/api/sync/pull?');
      expect(url).toContain('since=2024-01-01T00%3A00%3A00Z');
      expect(url).toContain('folderId=folder1');
    });

    it('fetchInvestigations calls GET /api/investigations', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
      });
      await fetchInvestigations();
      expect(mockFetch).toHaveBeenCalledWith(
        'http://test-server/api/investigations',
        expect.any(Object),
      );
    });

    it('getFileUrl returns correct URL', () => {
      const url = getFileUrl('file-123');
      expect(url).toBe('http://test-server/api/files/file-123');
    });

    it('getFileUrl returns empty string when no server configured', () => {
      configureServerApi(null, mockGetToken, mockInvalidateToken);
      expect(getFileUrl('file-123')).toBe('');
    });
  });

  // ─── Error handling ────────────────────────────────────────────

  describe('error handling', () => {
    it('fetchMe throws on non-ok response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Server error' }),
      });
      await expect(fetchMe()).rejects.toThrow('Failed to fetch profile');
    });

    it('syncPush throws on non-ok response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      });
      await expect(syncPush([])).rejects.toThrow('Sync push failed');
    });
  });
});
