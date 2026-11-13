/** Public API binding is configurable; administration is private by default. */
export function listenerHosts(env: { HOST?: string; ADMIN_HOST?: string }): {
  host: string | undefined;
  adminHost: string | undefined;
} {
  const host = env.HOST?.trim() || undefined;
  return { host, adminHost: env.ADMIN_HOST?.trim() || '127.0.0.1' };
}
