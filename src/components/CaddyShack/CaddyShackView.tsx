import { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, Globe, FolderOpen } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { fetchFeed, addReaction, removeReaction, deletePost, editPost } from '../../lib/server-api';
import { PostCard } from './PostCard';
import { PostComposer } from './PostComposer';
import { ReplyThread } from './ReplyThread';
import type { Post } from '../../types';

interface CaddyShackViewProps {
  folderId?: string;
  folderName?: string;
}

export function CaddyShackView({ folderId, folderName }: CaddyShackViewProps) {
  const { user, connected } = useAuth();
  const { addToast } = useToast();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [feedScope, setFeedScope] = useState<'global' | 'investigation'>(folderId ? 'investigation' : 'global');

  const loadFeed = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    try {
      const scope = feedScope === 'investigation' && folderId ? folderId : undefined;
      const data = await fetchFeed({ folderId: scope, limit: 50 });
      setPosts(data);
    } catch (err) {
      console.error('Failed to load feed:', err);
    } finally {
      setLoading(false);
    }
  }, [connected, feedScope, folderId]);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  // Listen for notification-driven post selection
  useEffect(() => {
    const handler = (e: Event) => {
      const postId = (e as CustomEvent).detail?.postId;
      if (postId) setSelectedPostId(postId);
    };
    window.addEventListener('caddyshack-select-post', handler);
    return () => window.removeEventListener('caddyshack-select-post', handler);
  }, []);

  const handleReact = async (postId: string, emoji: string) => {
    try {
      await addReaction(postId, emoji);
      await loadFeed();
    } catch { addToast('error', 'Failed to add reaction'); }
  };

  const handleRemoveReaction = async (postId: string, emoji: string) => {
    try {
      await removeReaction(postId, emoji);
      await loadFeed();
    } catch { addToast('error', 'Failed to remove reaction'); }
  };

  const handleDelete = async (postId: string) => {
    try {
      await deletePost(postId);
      await loadFeed();
    } catch { addToast('error', 'Failed to delete post'); }
  };

  const handleEdit = async (postId: string, content: string) => {
    try {
      await editPost(postId, { content });
      await loadFeed();
    } catch { addToast('error', 'Failed to edit post'); }
  };

  const handlePin = async (postId: string, pinned: boolean) => {
    try {
      await editPost(postId, { pinned });
      await loadFeed();
    } catch { addToast('error', 'Failed to update pin status'); }
  };

  const pinnedPosts = useMemo(() => posts.filter(p => p.pinned), [posts]);
  const unpinnedPosts = useMemo(() => posts.filter(p => !p.pinned), [posts]);
  const allOrdered = useMemo(() => [...pinnedPosts, ...unpinnedPosts], [pinnedPosts, unpinnedPosts]);

  if (!connected) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-tertiary)]">
        <p>Connect to a team server to use CaddyShack.</p>
      </div>
    );
  }

  if (selectedPostId) {
    return (
      <ReplyThread
        postId={selectedPostId}
        currentUserId={user?.id}
        onBack={() => setSelectedPostId(null)}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col max-w-2xl mx-auto w-full p-4 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">CaddyShack</h2>
        <div className="flex items-center gap-2">
          {folderId && (
            <div className="flex bg-[var(--bg-secondary)] rounded-lg border border-[var(--border)] overflow-hidden">
              <button
                onClick={() => setFeedScope('global')}
                className={`px-3 py-1.5 text-xs flex items-center gap-1.5 transition-colors ${feedScope === 'global' ? 'bg-blue-600 text-white' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'}`}
              >
                <Globe size={12} /> Global
              </button>
              <button
                onClick={() => setFeedScope('investigation')}
                className={`px-3 py-1.5 text-xs flex items-center gap-1.5 transition-colors ${feedScope === 'investigation' ? 'bg-blue-600 text-white' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'}`}
              >
                <FolderOpen size={12} /> {folderName || 'Investigation'}
              </button>
            </div>
          )}
          <button
            onClick={loadFeed}
            className="p-2 rounded-full hover:bg-[var(--bg-secondary)] text-[var(--text-tertiary)] transition-colors"
            title="Refresh"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Composer */}
      <PostComposer
        folderId={feedScope === 'investigation' ? folderId : null}
        onPostCreated={loadFeed}
      />

      {/* Feed container */}
      {loading ? (
        <div className="text-center py-12 text-[var(--text-tertiary)] text-sm">Loading feed...</div>
      ) : posts.length === 0 ? (
        <div className="text-center py-12 text-[var(--text-tertiary)] text-sm">
          No posts yet. Be the first to share an update!
        </div>
      ) : (
        <div className="border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--bg-secondary)] divide-y divide-[var(--border)]">
          {allOrdered.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              currentUserId={user?.id}
              onReply={setSelectedPostId}
              onReact={handleReact}
              onRemoveReaction={handleRemoveReaction}
              onDelete={handleDelete}
              onEdit={handleEdit}
              onPin={handlePin}
              onClick={setSelectedPostId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
