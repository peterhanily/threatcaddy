/** Give a useful preflight error for configurable endpoints rather than an
 * opaque browser CSP failure. This does not loosen browser-enforced policy. */
export function assertConfiguredConnection(url: string): void {
  if (typeof document === 'undefined') return;
  const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
  if (!csp) return; // Standalone and test environments have no build CSP.
  const endpoint = new URL(url, window.location.href);
  if (endpoint.origin === window.location.origin || ['localhost', '127.0.0.1'].includes(endpoint.hostname)) return;
  const configured = document.querySelector<HTMLMetaElement>('meta[name="threatcaddy-connect-origins"]')?.content.split(/\s+/) ?? [];
  if (!configured.includes(endpoint.origin)) {
    throw new Error(`This build does not allow connections to ${endpoint.origin}. Add that origin to VITE_CONNECT_ORIGINS and rebuild, or use the same-origin server deployment.`);
  }
}
