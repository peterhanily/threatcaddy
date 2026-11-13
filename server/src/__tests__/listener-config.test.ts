import { describe, expect, it } from 'vitest';
import { listenerHosts } from '../lib/listener-config.js';

describe('HTTP listener host configuration', () => {
  it('keeps administration on loopback when neither variable is configured', () => {
    expect(listenerHosts({})).toEqual({ host: undefined, adminHost: '127.0.0.1' });
    expect(listenerHosts({ HOST: ' ', ADMIN_HOST: '' })).toEqual({ host: undefined, adminHost: '127.0.0.1' });
  });

  it('does not expose administration when HOST exposes the public API', () => {
    expect(listenerHosts({ HOST: '127.0.0.1' })).toEqual({ host: '127.0.0.1', adminHost: '127.0.0.1' });
    expect(listenerHosts({ HOST: '0.0.0.0' })).toEqual({ host: '0.0.0.0', adminHost: '127.0.0.1' });
    expect(listenerHosts({ HOST: '0.0.0.0', ADMIN_HOST: ' 127.0.0.1 ' }))
      .toEqual({ host: '0.0.0.0', adminHost: '127.0.0.1' });
  });

  it('allows an admin-only loopback bind and preserves an explicit IPv6 address', () => {
    expect(listenerHosts({ ADMIN_HOST: '127.0.0.1' })).toEqual({ host: undefined, adminHost: '127.0.0.1' });
    expect(listenerHosts({ HOST: '::1' })).toEqual({ host: '::1', adminHost: '127.0.0.1' });
    expect(listenerHosts({ ADMIN_HOST: ' ::1 ' })).toEqual({ host: undefined, adminHost: '::1' });
    expect(listenerHosts({ ADMIN_HOST: '0.0.0.0' })).toEqual({ host: undefined, adminHost: '0.0.0.0' });
  });
});
