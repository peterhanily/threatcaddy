import { useState, useEffect, useCallback } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { fetchNotifications, markNotificationRead, markAllNotificationsRead } from '../../lib/server-api';
import type { Notification } from '../../types';

export function NotificationBell() {
  const { connected } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const loadNotifications = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    try {
      const data = await fetchNotifications(false, 20);
      setNotifications(data);
    } catch {
      console.warn('NotificationBell: failed to load notifications');
    } finally {
      setLoading(false);
    }
  }, [connected]);

  // Initial load + listen for WS push events
  useEffect(() => {
    loadNotifications();

    const handleWsNotification = () => {
      loadNotifications();
    };
    window.addEventListener('ws-notification', handleWsNotification);

    // Fallback poll every 60s in case WS drops
    const interval = setInterval(loadNotifications, 60_000);
    return () => {
      window.removeEventListener('ws-notification', handleWsNotification);
      clearInterval(interval);
    };
  }, [loadNotifications]);

  const handleMarkRead = async (id: string) => {
    try {
      await markNotificationRead(id);
      setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
    } catch {
      console.warn('NotificationBell: failed to mark notification read');
    }
  };

  const handleNotificationClick = async (n: Notification) => {
    await handleMarkRead(n.id);
    setOpen(false);
    window.dispatchEvent(new CustomEvent('notification-navigate', {
      detail: { type: n.type, postId: n.postId, folderId: n.folderId },
    }));
  };

  const handleMarkAllRead = async () => {
    try {
      await markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch {
      console.warn('NotificationBell: failed to mark all read');
    }
  };

  if (!connected) return null;

  return (
    <div className="relative">
      <button
        onClick={() => { setOpen(!open); if (!open) loadNotifications(); }}
        className="relative p-1.5 rounded hover:bg-gray-800/50 text-gray-500 hover:text-gray-300"
        title="Notifications"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 rounded-full text-white text-[10px] flex items-center justify-center font-medium">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-50 w-80 max-h-96 bg-gray-900 border border-gray-700 rounded-lg shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
              <span className="text-sm font-medium text-gray-100">Notifications</span>
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                >
                  <CheckCheck size={12} /> Mark all read
                </button>
              )}
            </div>
            <div className="overflow-y-auto max-h-80">
              {loading && notifications.length === 0 ? (
                <div className="p-4 text-center text-sm text-gray-500">Loading...</div>
              ) : notifications.length === 0 ? (
                <div className="p-4 text-center text-sm text-gray-500">No notifications</div>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`px-3 py-2.5 border-b border-gray-700 hover:bg-gray-800/50 cursor-pointer flex items-start gap-2 ${
                      !n.read ? 'bg-blue-500/5' : ''
                    }`}
                    onClick={() => handleNotificationClick(n)}
                  >
                    <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs shrink-0 mt-0.5">
                      {n.sourceUserDisplayName?.[0]?.toUpperCase() || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-300 line-clamp-2">{n.message}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {new Date(n.createdAt).toLocaleString()}
                      </p>
                    </div>
                    {!n.read && (
                      <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0 mt-1.5" />
                    )}
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
