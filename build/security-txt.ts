import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

const RENEW_WITHIN_DAYS = 30;
const DAY = 86_400_000;
const FILE = 'public/.well-known/security.txt';

/** Why security.txt needs renewing at `now`, or nothing while it has more
 * than RENEW_WITHIN_DAYS left. */
export function securityTxtRenewalWarning(text: string, now: number): string | undefined {
  const expires = /^Expires: (\S+)$/m.exec(text)?.[1];
  const time = expires ? Date.parse(expires) : NaN;
  if (Number.isNaN(time)) return `${FILE} has no valid Expires field.`;
  const renew = 'renew Expires (at most a year ahead) before publishing.';
  if (time <= now) return `${FILE} expired on ${expires}: ${renew}`;
  const days = Math.floor((time - now) / DAY);
  if (days < RENEW_WITHIN_DAYS) return `${FILE} expires on ${expires}, in ${days} days: ${renew}`;
  return undefined;
}

/** RFC 9116 consumers treat an expired security.txt as stale. Each build
 * warns, as an annotation in GitHub Actions, from 30 days before Expires. It
 * never fails, so an older release still builds after the date. */
export function securityTxtExpiry(path: string, now: () => number = Date.now): Plugin {
  return {
    name: 'security-txt-expiry',
    apply: 'build',
    buildStart() {
      const warning = securityTxtRenewalWarning(readFileSync(path, 'utf8'), now());
      if (!warning) return;
      if (process.env.GITHUB_ACTIONS === 'true') console.log(`::warning title=security.txt::${warning}`);
      this.warn(warning);
    },
  };
}
