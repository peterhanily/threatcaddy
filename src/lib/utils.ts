import i18n from '../i18n';

/** Returns the active locale for date/number formatting (falls back to browser default). */
export function currentLocale(): string {
  return i18n.language || navigator.language || 'en-US';
}

export function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return i18n.t('justNow', { ns: 'dates' });
  if (diffMins < 60) return i18n.t('minutesAgo', { ns: 'dates', count: diffMins });
  if (diffHours < 24) return i18n.t('hoursAgo', { ns: 'dates', count: diffHours });
  if (diffDays < 7) return i18n.t('daysAgo', { ns: 'dates', count: diffDays });

  return date.toLocaleDateString(currentLocale(), {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

export function formatFullDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(currentLocale(), {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function wordCount(text: string): { words: number; chars: number } {
  const trimmed = text.trim();
  if (!trimmed) return { words: 0, chars: 0 };
  return {
    words: trimmed.split(/\s+/).length,
    chars: trimmed.length,
  };
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

export function isOverdue(dueDate?: string): boolean {
  if (!dueDate) return false;
  const due = new Date(dueDate);
  due.setHours(23, 59, 59, 999);
  return due.getTime() < Date.now();
}

export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function isSafeUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Returns the correct targetOrigin for postMessage.
 * On file:// pages, window.location.origin is the string "null" and
 * postMessage(data, "null") silently drops the message. Use '*' instead.
 */
export function postMessageOrigin(): string {
  return window.location.protocol === 'file:' ? '*' : window.location.origin;
}

/** Get the current user's display name for entity attribution. */
export function getCurrentUserName(): string {
  try {
    const auth = JSON.parse(localStorage.getItem('threatcaddy-auth') || 'null');
    if (auth?.user?.displayName) return auth.user.displayName;
  } catch { /* ignore */ }
  try {
    const settings = JSON.parse(localStorage.getItem('threatcaddy-settings') || '{}');
    if (settings.displayName) return settings.displayName;
  } catch { /* ignore */ }
  return 'Analyst';
}
