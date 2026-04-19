import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Mail, Shield, MessageSquare, Heart, Activity, Clock } from 'lucide-react';
import { fetchUserProfile, fetchUserFeed, fetchUserLikes, fetchUserActivity } from '../../lib/server-api';
import { PostCard } from './PostCard';
import type { Post, TeamUser } from '../../types';

type ProfileTab = 'posts' | 'likes' | 'activity';

interface ActivityEntry {
  id: string;
  category: string;
  action: string;
  detail: string;
  itemId?: string;
  itemTitle?: string;
  folderId?: string;
  timestamp: string;
}

interface UserProfileProps {
  userId: string;
  currentUserId?: string;
  onBack: () => void;
  onUserClick?: (userId: string) => void;
}

export function UserProfile({ userId, currentUserId, onBack, onUserClick }: UserProfileProps) {
  const { t } = useTranslation('caddyshack');
  const [user, setUser] = useState<TeamUser | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [likes, setLikes] = useState<Post[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<ProfileTab>('posts');

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [profile, feed] = await Promise.all([
          fetchUserProfile(userId),
          fetchUserFeed(userId),
        ]);
        setUser(profile);
        setPosts(feed);
      } catch (err) {
        console.error('Failed to load user profile:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [userId]);

  // Lazy-load likes and activity on tab switch
  useEffect(() => {
    if (tab === 'likes' && likes.length === 0) {
      fetchUserLikes(userId).then(setLikes).catch(console.error);
    }
    if (tab === 'activity' && activity.length === 0) {
      fetchUserActivity(userId).then(setActivity).catch(console.error);
    }
  }, [tab, userId, likes.length, activity.length]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-tertiary)] text-sm">
        {t('profile.loadingProfile')}
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-tertiary)] text-sm">
        {t('profile.userNotFound')}
      </div>
    );
  }

  const isOwnProfile = currentUserId === userId;
  const tabs: { key: ProfileTab; label: string; icon: typeof MessageSquare; count?: number }[] = [
    { key: 'posts', label: t('profile.posts'), icon: MessageSquare, count: posts.length },
    { key: 'likes', label: t('profile.likes'), icon: Heart },
    { key: 'activity', label: t('profile.activity'), icon: Activity },
  ];

  return (
    <div className="flex-1 flex flex-col max-w-2xl mx-auto w-full p-4 gap-4">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-[var(--text-tertiary)] hover:text-[var(--text-primary)] w-fit transition-colors"
      >
        <ArrowLeft size={16} /> Back to CaddyShack
      </button>

      {/* Profile card */}
      <div className="border border-[var(--border)] rounded-xl p-5 bg-[var(--bg-secondary)]">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-blue-600 flex items-center justify-center text-white text-2xl font-medium">
            {user.displayName[0]?.toUpperCase() || '?'}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-[var(--text-primary)] truncate">{user.displayName}</h2>
            <div className="flex items-center gap-4 text-sm text-[var(--text-tertiary)] mt-1 flex-wrap">
              <span className="flex items-center gap-1.5"><Mail size={13} /> {user.email}</span>
              <span className="flex items-center gap-1.5 capitalize"><Shield size={13} /> {user.role}</span>
            </div>
            {isOwnProfile && (
              <div className="mt-2 text-xs text-blue-400/70">{t('profile.thisIsYou')}</div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[var(--border)]" role="tablist" aria-label="User profile">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
            }`}
          >
            <t.icon size={15} />
            {t.label}
            {t.count !== undefined && (
              <span className="text-xs text-[var(--text-tertiary)] ms-0.5">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'posts' && (
        posts.length === 0 ? (
          <p className="text-sm text-[var(--text-tertiary)] text-center py-8">{t('profile.noPosts')}</p>
        ) : (
          <div className="border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--bg-secondary)] divide-y divide-[var(--border)]">
            {posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                currentUserId={currentUserId}
                onUserClick={onUserClick}
              />
            ))}
          </div>
        )
      )}

      {tab === 'likes' && (
        likes.length === 0 ? (
          <p className="text-sm text-[var(--text-tertiary)] text-center py-8">{t('profile.noLikes')}</p>
        ) : (
          <div className="border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--bg-secondary)] divide-y divide-[var(--border)]">
            {likes.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                currentUserId={currentUserId}
                onUserClick={onUserClick}
              />
            ))}
          </div>
        )
      )}

      {tab === 'activity' && (
        activity.length === 0 ? (
          <p className="text-sm text-[var(--text-tertiary)] text-center py-8">{t('profile.noActivity')}</p>
        ) : (
          <div className="border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--bg-secondary)] divide-y divide-[var(--border)]">
            {activity.map((entry) => (
              <div key={entry.id} className="px-4 py-3 flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center shrink-0 mt-0.5">
                  <Clock size={14} className="text-[var(--text-tertiary)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-[var(--text-primary)]">
                    <span className="font-medium capitalize">{entry.action}</span>
                    {entry.itemTitle && (
                      <span className="text-[var(--text-secondary)]"> &mdash; {entry.itemTitle}</span>
                    )}
                  </div>
                  <div className="text-xs text-[var(--text-tertiary)] mt-0.5">{entry.detail}</div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] uppercase tracking-wider">
                      {entry.category}
                    </span>
                    <span className="text-xs text-[var(--text-tertiary)]">
                      {formatTimeAgo(entry.timestamp)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}
