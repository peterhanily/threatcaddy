import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Post } from '../types';
import { CaddyShackView } from '../components/CaddyShack/CaddyShackView';
import type { ActivityEntry } from '../components/CaddyShack/ActivityCard';

const api = vi.hoisted(() => ({ feed: vi.fn(), activity: vi.fn(), info: vi.fn(), toast: vi.fn(), serverUrl: 'https://server.test', userId: 'synthetic-user' }));
vi.mock('../lib/server-api', () => ({ fetchFeed: api.feed, fetchTeamActivity: api.activity, fetchServerInfo: api.info,
  addReaction: vi.fn(), removeReaction: vi.fn(), deletePost: vi.fn(), editPost: vi.fn() }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ connected: true, serverUrl: api.serverUrl, user: { id: api.userId } }) }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: api.toast }) }));
vi.mock('../hooks/ScreenshareContext', () => ({ useScreenshare: () => ({ maxLevel: undefined, effectiveLevels: [] }) }));
vi.mock('../components/CaddyShack/PostCard', () => ({ PostCard: ({ post, onReply, onUserClick }: { post: Post; onReply: (id: string) => void; onUserClick: (id: string) => void }) => <article>
  {post.content}
  <button onClick={() => onReply(post.id)}>Open replies {post.id}</button>
  <button onClick={() => onUserClick(post.authorId)}>Open author {post.id}</button>
</article> }));
vi.mock('../components/CaddyShack/PostComposer', () => ({ PostComposer: () => <input aria-label="Composer draft" /> }));
vi.mock('../components/CaddyShack/ReplyThread', () => ({ ReplyThread: ({ postId }: { postId: string }) => <div>Selected replies {postId}</div> }));
vi.mock('../components/CaddyShack/UserProfile', () => ({ UserProfile: ({ userId }: { userId: string }) => <div>Selected profile {userId}</div> }));
vi.mock('../components/CaddyShack/ActivityCard', () => ({ ActivityCard: ({ entry }: { entry: ActivityEntry }) => <article>{entry.detail}</article> }));

function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Not initialized'); };
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const post = (id: string): Post => ({ id, content: `Post ${id}`, folderId: id, authorId: 'synthetic-user', attachments: [], mentions: [],
  pinned: false, deleted: false, createdAt: '2026-10-04T00:00:00Z', updatedAt: '2026-10-04T00:00:00Z' });
const activity = (id: string): ActivityEntry => ({ id, detail: `Activity ${id}`, userId: 'synthetic-user', category: 'note', action: 'created', timestamp: '2026-10-04T00:00:00Z', userDisplayName: 'Synthetic analyst' });
beforeEach(() => {
  vi.clearAllMocks(); api.activity.mockResolvedValue([]); api.info.mockResolvedValue({ serverName: 'Synthetic server' });
  api.serverUrl = 'https://server.test'; api.userId = 'synthetic-user';
  localStorage.setItem('caddyshack-onboarded', '1');
});
afterEach(cleanup);

describe('release hardening: feed response ownership', () => {
  it('ignores a late investigation response after the selected folder changes', async () => {
    const earlier = deferred<Post[]>();
    api.feed.mockImplementation(({ folderId }: { folderId: string }) => folderId === 'a' ? earlier.promise : Promise.resolve([post('b')]));
    const view = render(<CaddyShackView folderId="a" />);
    view.rerender(<CaddyShackView folderId="b" />);
    expect(await screen.findByText('Post b')).toBeInTheDocument();
    await act(async () => { earlier.resolve([post('a')]); });
    expect(screen.queryByText('Post a')).not.toBeInTheDocument();
    expect(screen.getByText('Post b')).toBeInTheDocument();
  });

  it('hides prior-scope posts immediately while preserving the composer draft', async () => {
    const next = deferred<Post[]>();
    api.feed.mockImplementation(({ folderId }: { folderId: string }) => folderId === 'a' ? Promise.resolve([post('a')]) : next.promise);
    const view = render(<CaddyShackView folderId="a" />);
    expect(await screen.findByText('Post a')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Composer draft' }), { target: { value: 'Unsaved analyst draft' } });
    view.rerender(<CaddyShackView folderId="b" />);
    expect(screen.queryByText('Post a')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Composer draft' })).toHaveValue('Unsaved analyst draft');
    await act(async () => { next.resolve([post('b')]); });
    expect(screen.getByText('Post b')).toBeInTheDocument();
  });

  it('preserves the newest result when refresh requests complete out of order', async () => {
    const earlier = deferred<Post[]>(); const latest = deferred<Post[]>();
    api.feed.mockResolvedValueOnce([post('initial')]).mockReturnValueOnce(earlier.promise).mockReturnValueOnce(latest.promise);
    render(<CaddyShackView folderId="a" />);
    expect(await screen.findByText('Post initial')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Refresh')); fireEvent.click(screen.getByTitle('Refresh'));
    await act(async () => { latest.resolve([post('latest')]); });
    await act(async () => { earlier.resolve([post('stale')]); });
    expect(screen.getByText('Post latest')).toBeInTheDocument();
    expect(screen.queryByText('Post stale')).not.toBeInTheDocument();
  });

  it('invalidates an in-flight response when the authenticated server identity changes', async () => {
    const earlier = deferred<Post[]>();
    api.feed.mockReturnValueOnce(earlier.promise).mockResolvedValueOnce([post('new-server')]);
    const view = render(<CaddyShackView folderId="a" />);
    api.serverUrl = 'https://other-server.test'; api.userId = 'other-synthetic-user';
    view.rerender(<CaddyShackView folderId="a" />);
    expect(await screen.findByText('Post new-server')).toBeInTheDocument();
    await act(async () => { earlier.resolve([post('old-server')]); });
    expect(screen.queryByText('Post old-server')).not.toBeInTheDocument();
  });

  it('does not mix late activity or server metadata from a previous authenticated identity', async () => {
    const oldActivity = deferred<ActivityEntry[]>(); const oldInfo = deferred<{ serverName: string }>();
    api.feed.mockResolvedValue([]);
    api.activity.mockReturnValueOnce(oldActivity.promise).mockResolvedValueOnce([activity('new-server')]);
    api.info.mockReturnValueOnce(oldInfo.promise).mockResolvedValueOnce({ serverName: 'New team' });
    const view = render(<CaddyShackView folderId="a" />);
    api.serverUrl = 'https://other-server.test';
    view.rerender(<CaddyShackView folderId="a" />);
    expect(await screen.findByText('Activity new-server')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New team server' })).toBeInTheDocument();
    await act(async () => { oldActivity.resolve([activity('old-server')]); oldInfo.resolve({ serverName: 'Old team' }); });
    expect(screen.queryByText('Activity old-server')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Old team server' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New team server' })).toBeInTheDocument();
  });

  it('hides loaded activity and metadata immediately on account change and clears the account-owned draft', async () => {
    const nextActivity = deferred<ActivityEntry[]>(); const nextInfo = deferred<{ serverName: string }>();
    api.feed.mockResolvedValue([]);
    api.activity.mockResolvedValueOnce([activity('first-account')]).mockReturnValueOnce(nextActivity.promise);
    api.info.mockResolvedValueOnce({ serverName: 'First account team' }).mockReturnValueOnce(nextInfo.promise);
    const view = render(<CaddyShackView folderId="a" />);
    expect(await screen.findByText('Activity first-account')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Composer draft' }), { target: { value: 'First account draft' } });
    api.userId = 'second-account';
    view.rerender(<CaddyShackView folderId="a" />);
    expect(screen.queryByText('Activity first-account')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'First account team server' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Composer draft' })).toHaveValue('');
    await act(async () => { nextActivity.resolve([activity('second-account')]); nextInfo.resolve({ serverName: 'Second account team' }); });
    expect(screen.getByText('Activity second-account')).toBeInTheDocument();
  });

  it('preserves the newest activity refresh when overlapping requests finish out of order', async () => {
    const earlier = deferred<ActivityEntry[]>(); const latest = deferred<ActivityEntry[]>();
    api.feed.mockResolvedValue([]);
    api.activity.mockResolvedValueOnce([activity('initial')]).mockReturnValueOnce(earlier.promise).mockReturnValueOnce(latest.promise);
    render(<CaddyShackView folderId="a" />);
    expect(await screen.findByText('Activity initial')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Refresh')); fireEvent.click(screen.getByTitle('Refresh'));
    await act(async () => { latest.resolve([activity('latest')]); });
    await act(async () => { earlier.resolve([activity('stale')]); });
    expect(screen.getByText('Activity latest')).toBeInTheDocument();
    expect(screen.queryByText('Activity stale')).not.toBeInTheDocument();
  });

  it('closes an old reply selection when switching authenticated servers', async () => {
    api.feed.mockResolvedValue([post('selected')]);
    const view = render(<CaddyShackView folderId="a" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open replies selected' }));
    expect(screen.getByText('Selected replies selected')).toBeInTheDocument();
    api.serverUrl = 'https://other-server.test';
    view.rerender(<CaddyShackView folderId="a" />);
    expect(screen.queryByText('Selected replies selected')).not.toBeInTheDocument();
    expect(await screen.findByText('Post selected')).toBeInTheDocument();
  });

  it('closes an old profile selection when switching authenticated accounts', async () => {
    api.feed.mockResolvedValue([post('selected')]);
    const view = render(<CaddyShackView folderId="a" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open author selected' }));
    expect(screen.getByText('Selected profile synthetic-user')).toBeInTheDocument();
    api.userId = 'second-account';
    view.rerender(<CaddyShackView folderId="a" />);
    expect(screen.queryByText('Selected profile synthetic-user')).not.toBeInTheDocument();
    expect(await screen.findByText('Post selected')).toBeInTheDocument();
  });
});
