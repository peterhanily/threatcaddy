import { describe, expect, it, vi } from 'vitest';
vi.mock('../lib/logger.js', () => ({ logger: { error: vi.fn() } }));
import { logger } from '../lib/logger.js';
import { notifySessionRevocation, onSessionRevocation } from '../services/session-events.js';

describe('postcommit revocation observers', () => {
  it('isolates sync throws and async rejections and still notifies every other listener', async () => {
    const delivered = vi.fn();
    const stops = [
      onSessionRevocation(() => { throw new Error('Synthetic listener failure'); }),
      onSessionRevocation(async () => { throw new Error('Synthetic asynchronous failure'); }),
      onSessionRevocation(delivered),
    ];
    try {
      expect(() => notifySessionRevocation({ userId: 'fictional-user', family: 'fictional-family' })).not.toThrow();
      await Promise.resolve();
      expect(delivered).toHaveBeenCalledExactlyOnceWith({ userId: 'fictional-user', family: 'fictional-family' });
      expect(vi.mocked(logger.error).mock.calls).toEqual([
        ['A session revocation listener failed'], ['A session revocation listener failed'],
      ]);
    } finally { for (const stop of stops) stop(); }
  });
});
