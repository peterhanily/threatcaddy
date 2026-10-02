/** Explicit public build settings. Never interpolate an arbitrary CSP fragment
 * or HTML attribute supplied through the environment. */
export interface DeploymentPolicy {
  analyticsToken?: string;
  connectOrigins?: string;
}

export function deploymentOrigins(value = ''): string[] {
  const origins = new Set<string>();
  for (const part of value.split(/[\s,]+/).filter(Boolean)) {
    let url: URL;
    try { url = new URL(part); } catch { throw new Error(`Invalid VITE_CONNECT_ORIGINS entry: ${part}`); }
    if (!['https:', 'http:', 'wss:', 'ws:'].includes(url.protocol) || url.hostname.includes('*') || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('VITE_CONNECT_ORIGINS must contain exact HTTP(S)/WS(S) origins without credentials, paths, queries, or wildcards.');
    }
    origins.add(url.origin);
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      origins.add(url.origin.replace(/^http/, 'ws'));
    }
  }
  return [...origins];
}

export function applyDeploymentPolicy(html: string, policy: DeploymentPolicy): string {
  const origins = deploymentOrigins(policy.connectOrigins);
  const token = policy.analyticsToken?.trim() ?? '';
  if (token && !/^[a-f\d]{32}$/i.test(token)) throw new Error('VITE_CF_ANALYTICS_TOKEN must be a 32-character hexadecimal site token.');
  let output = html.replace(/ https:\/\/static\.cloudflareinsights\.com/g, '');
  output = output.replace(/(connect-src [^;]*)(;)/, (_match, directive: string, end: string) => `${directive}${origins.length ? ` ${origins.join(' ')}` : ''}${token ? ' https://cloudflareinsights.com' : ''}${end}`);
  output = output.replace('</head>', `<meta name="threatcaddy-connect-origins" content="${origins.join(' ')}" />\n</head>`);
  if (token) {
    output = output.replace(/(script-src [^;]*)(;)/, '$1 https://static.cloudflareinsights.com$2');
    output = output.replace('</body>', `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='${JSON.stringify({ token, spa: true })}'></script>\n</body>`);
  }
  return output;
}
