import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bell,
  CheckCheck,
  AtSign,
  MessageCircle,
  Smile,
  UserPlus,
  Bot,
  Info,
  BellOff,
  Inbox,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useSettings } from '../../hooks/useSettings';
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from '../../lib/server-api';
import type { Notification, NotificationType, Settings } from '../../types';

// ── Helpers ────────────────────────────────────────────────────────

function relativeTime(date: string | Date): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(date).toLocaleDateString();
}

/** Returns a calendar-day bucket label */
function dateBucket(date: string | Date): string {
  const d = new Date(date);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday.getTime() - 86_400_000);
  if (d >= startOfToday) return 'Today';
  if (d >= startOfYesterday) return 'Yesterday';
  return 'Earlier';
}

type NotifMeta = {
  icon: typeof Bell;
  color: string;        // tailwind bg- class for the icon circle
  accentBorder: string; // left-border accent for unread items
};

function notifMeta(type: NotificationType): NotifMeta {
  switch (type) {
    case 'mention':
      return { icon: AtSign, color: 'bg-blue-600', accentBorder: 'border-l-blue-500' };
    case 'reply':
      return { icon: MessageCircle, color: 'bg-green-600', accentBorder: 'border-l-green-500' };
    case 'reaction':
      return { icon: Smile, color: 'bg-amber-500', accentBorder: 'border-l-amber-400' };
    case 'invite':
      return { icon: UserPlus, color: 'bg-purple-600', accentBorder: 'border-l-purple-500' };
    case 'entity-update':
      return { icon: Bot, color: 'bg-teal-600', accentBorder: 'border-l-teal-500' };
    default:
      return { icon: Info, color: 'bg-gray-600', accentBorder: 'border-l-gray-500' };
  }
}

function notifTypeLabel(type: NotificationType): string {
  switch (type) {
    case 'mention':       return 'Mention';
    case 'reply':         return 'Reply';
    case 'reaction':      return 'Reaction';
    case 'invite':        return 'Invite';
    case 'entity-update': return 'Update';
    default:              return 'Notification';
  }
}

function isNotifTypeEnabled(
  type: NotificationType,
  prefs: Settings['notificationPrefs'],
): boolean {
  if (!prefs) return true;
  const key = type === 'entity-update' ? 'bot' : type;
  return prefs[key as keyof typeof prefs] !== false;
}

/** Group a sorted (newest-first) array of notifications by date bucket */
function groupByDate(
  items: Notification[],
): { label: string; items: Notification[] }[] {
  const map = new Map<string, Notification[]>();
  for (const n of items) {
    const label = dateBucket(n.createdAt);
    const arr = map.get(label);
    if (arr) arr.push(n);
    else map.set(label, [n]);
  }
  // Maintain order: Today -> Yesterday -> Earlier
  const order = ['Today', 'Yesterday', 'Earlier'];
  return order
    .filter((l) => map.has(l))
    .map((l) => ({ label: l, items: map.get(l) ?? [] }));
}

// ── Component ──────────────────────────────────────────────────────

export function NotificationBell() {
  const { t } = useTranslation('caddyshack');
  const { t: tt } = useTranslation('toast');
  const { connected } = useAuth();
  const { addToast } = useToast();
  const { settings } = useSettings();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const prevUnreadRef = useRef(0);
  const [pulsing, setPulsing] = useState(false);

  const unreadCount = notifications.filter((n) => !n.read).length;

  // Detect new notifications arriving and trigger badge pulse
  useEffect(() => {
    if (unreadCount > prevUnreadRef.current && prevUnreadRef.current >= 0) {
      setPulsing(true);
      const timer = setTimeout(() => setPulsing(false), 4500); // 3 pulses * 1.5s
      return () => clearTimeout(timer);
    }
    prevUnreadRef.current = unreadCount;
  }, [unreadCount]);

  // Keep prevUnreadRef in sync even when pulse isn't triggered
  useEffect(() => {
    prevUnreadRef.current = unreadCount;
  }, [unreadCount]);

  const loadNotifications = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    try {
      const data = await fetchNotifications(false, 20);
      setNotifications(
        data.filter((n: Notification) =>
          isNotifTypeEnabled(n.type, settings.notificationPrefs),
        ),
      );
    } catch {
      addToast('error', tt('caddyshack.notificationsLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [connected, addToast, tt, settings.notificationPrefs]);

  // Initial load + WS push events
  useEffect(() => {
    loadNotifications();
    const handleWsNotification = () => loadNotifications();
    window.addEventListener('ws-notification', handleWsNotification);
    const interval = setInterval(loadNotifications, 60_000);
    return () => {
      window.removeEventListener('ws-notification', handleWsNotification);
      clearInterval(interval);
    };
  }, [loadNotifications]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  const handleMarkRead = async (id: string) => {
    try {
      await markNotificationRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
      );
    } catch {
      addToast('error', tt('caddyshack.markReadFailed'));
    }
  };

  const handleNotificationClick = async (n: Notification) => {
    await handleMarkRead(n.id);
    setOpen(false);
    window.dispatchEvent(
      new CustomEvent('notification-navigate', {
        detail: { type: n.type, postId: n.postId, folderId: n.folderId },
      }),
    );
  };

  const handleMarkAllRead = async () => {
    try {
      await markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch {
      addToast('error', tt('caddyshack.markAllReadFailed'));
    }
  };

  const handleClearAll = async () => {
    // Mark all read then remove from local state (effectively "dismiss")
    try {
      await markAllNotificationsRead();
      setNotifications([]);
    } catch {
      addToast('error', tt('caddyshack.clearNotificationsFailed'));
    }
  };

  if (!connected) return null;

  const groups = groupByDate(notifications);

  return (
    <div className="relative">
      {/* Bell button */}
      <button
        onClick={() => {
          setOpen((v) => !v);
          if (!open) loadNotifications();
        }}
        className="relative p-1.5 rounded-md hover:bg-gray-800/60 text-gray-400 hover:text-gray-200 transition-colors"
        title="Notifications"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span
            className={`absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-red-500 rounded-full text-white text-[10px] flex items-center justify-center font-semibold leading-none ${
              pulsing ? 'notif-badge-pulse' : ''
            }`}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <>
          {/* Click-outside overlay */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />

          <div
            className="notif-dropdown-enter absolute right-0 top-9 z-50 w-[340px] max-h-[28rem] bg-gray-900 border border-gray-700/80 rounded-xl shadow-2xl shadow-black/40 overflow-hidden flex flex-col"
            role="menu"
            aria-label="Notifications"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700/60 bg-gray-900/90 backdrop-blur-sm shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-100">
                  {t('notifications.title')}
                </span>
                {unreadCount > 0 && (
                  <span className="text-[10px] font-medium text-blue-400 bg-blue-500/15 rounded-full px-1.5 py-0.5 leading-none">
                    {unreadCount} new
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAllRead}
                    className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-blue-500/10 transition-colors"
                    title="Mark all as read"
                  >
                    <CheckCheck size={12} />
                    <span className="hidden sm:inline">Read all</span>
                  </button>
                )}
                {notifications.length > 0 && (
                  <button
                    onClick={handleClearAll}
                    className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-gray-700/40 transition-colors"
                    title="Clear all notifications"
                  >
                    <BellOff size={12} />
                    <span className="hidden sm:inline">Clear</span>
                  </button>
                )}
              </div>
            </div>

            {/* Body */}
            <div className="overflow-y-auto flex-1 overscroll-contain">
              {loading && notifications.length === 0 ? (
                <div className="p-6 text-center">
                  <div className="inline-block w-5 h-5 border-2 border-gray-600 border-t-blue-400 rounded-full animate-spin" />
                  <p className="text-sm text-gray-500 mt-2">Loading...</p>
                </div>
              ) : notifications.length === 0 ? (
                <div className="p-10 text-center">
                  <div className="mx-auto w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center mb-3">
                    <Inbox size={22} className="text-gray-600" />
                  </div>
                  <p className="text-sm font-medium text-gray-400">
                    {t('notifications.allCaughtUp')}
                  </p>
                  <p className="text-xs text-gray-600 mt-1">
                    {t('notifications.noNotifications')}
                  </p>
                </div>
              ) : (
                groups.map((group) => (
                  <div key={group.label}>
                    {/* Date group header */}
                    <div className="sticky top-0 z-10 px-4 py-1.5 bg-gray-900/95 backdrop-blur-sm border-b border-gray-800/60">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                        {group.label}
                      </span>
                    </div>

                    {group.items.map((n) => {
                      const meta = notifMeta(n.type);
                      const Icon = meta.icon;
                      return (
                        <div
                          key={n.id}
                          role="menuitem"
                          tabIndex={0}
                          className={`group px-4 py-3 border-b border-gray-800/40 cursor-pointer flex items-start gap-3 transition-colors
                            ${!n.read
                              ? `bg-blue-500/[0.04] border-l-2 ${meta.accentBorder} hover:bg-blue-500/[0.08]`
                              : 'border-l-2 border-l-transparent hover:bg-gray-800/40 opacity-75 hover:opacity-100'
                            }`}
                          onClick={() => handleNotificationClick(n)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              handleNotificationClick(n);
                            }
                          }}
                        >
                          {/* Type icon */}
                          <div
                            className={`w-7 h-7 rounded-full ${meta.color} flex items-center justify-center text-white shrink-0 mt-0.5`}
                          >
                            <Icon size={14} />
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">
                                {notifTypeLabel(n.type)}
                              </span>
                              {!n.read && (
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                              )}
                            </div>
                            <p className="text-[13px] text-gray-300 leading-snug line-clamp-2">
                              {n.message}
                            </p>
                            <p className="text-[11px] text-gray-600 mt-1">
                              {n.sourceUserDisplayName && (
                                <span className="text-gray-500">
                                  {n.sourceUserDisplayName}
                                  {' \u00B7 '}
                                </span>
                              )}
                              {relativeTime(n.createdAt)}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
