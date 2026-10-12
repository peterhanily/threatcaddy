/** Unset bindings preserve Node's existing platform-specific wildcard default. */
export function listenerHosts(env: { HOST?: string; ADMIN_HOST?: string }): {
  host: string | undefined;
  adminHost: string | undefined;
} {
  const host = env.HOST?.trim() || undefined;
  return { host, adminHost: env.ADMIN_HOST?.trim() || host };
}
