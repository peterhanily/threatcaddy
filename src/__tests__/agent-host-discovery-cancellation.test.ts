import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchHostSkills } from '../lib/agent-hosts';
import type { AgentHost } from '../types';

vi.mock('../lib/connection-policy', () => ({ assertConfiguredConnection: vi.fn() }));
const host: AgentHost = { id: 'fictional', name: 'fictional', displayName: 'Fictional host', url: 'https://synthetic.example.test', enabled: true, skills: [] };
afterEach(() => vi.unstubAllGlobals());

describe('agent-host discovery cancellation', () => {
  it('does not issue a request when its owner was already cancelled', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const owner = new AbortController(); owner.abort();
    await expect(fetchHostSkills(host, owner.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('forwards owner cancellation to the actual fetch signal', async () => {
    let requestedSignal: AbortSignal | undefined;
    const fetch = vi.fn((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
      requestedSignal = options.signal as AbortSignal;
      requestedSignal.addEventListener('abort', () => reject(new DOMException('Synthetic cancelled request', 'AbortError')), { once: true });
    }));
    vi.stubGlobal('fetch', fetch);
    const owner = new AbortController(); const pending = fetchHostSkills(host, owner.signal);
    owner.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(requestedSignal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('keeps existing no-signal discovery compatible and removes completed ownership', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([{ name: 'read', description: 'Synthetic skill', parameters: { type: 'object', properties: {} } }]))));
    await expect(fetchHostSkills(host)).resolves.toMatchObject([{ name: 'read' }]);
  });
});
