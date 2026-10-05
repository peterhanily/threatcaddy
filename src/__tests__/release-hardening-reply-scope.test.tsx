import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Post } from '../types';
import { ReplyThread } from '../components/CaddyShack/ReplyThread';

const api = vi.hoisted(() => ({ fetch: vi.fn(), react: vi.fn(), toast: vi.fn() }));
vi.mock('../lib/server-api', () => ({ fetchPost: api.fetch, addReaction: api.react, removeReaction: vi.fn(), deletePost: vi.fn(), editPost: vi.fn() }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: api.toast }) }));
vi.mock('../components/CaddyShack/PostCard', () => ({ PostCard: ({ post, onReact, onReply }: {
  post: Post; onReact: (id: string, emoji: string) => void; onReply?: (id: string) => void;
}) => <article><span>{post.content}</span><button onClick={() => onReact(post.id, '👍')}>React {post.id}</button>
  {onReply && <button onClick={() => onReply(post.id)}>Reply {post.id}</button>}</article> }));
vi.mock('../components/CaddyShack/PostComposer', () => ({ PostComposer: ({ parentId, replyToId, folderId }: {
  parentId: string; replyToId: string; folderId?: string;
}) => <output data-testid="composer">{JSON.stringify({ parentId, replyToId, folderId })}</output> }));

function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Not initialized'); };
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const post = (id: string, content = `Post ${id}`): Post => ({ id, content, folderId: `folder-${id}`, replies: [], authorDisplayName: 'Synthetic author',
  authorId: 'synthetic-user', attachments: [], mentions: [], pinned: false, deleted: false,
  createdAt: '2026-10-04T00:00:00Z', updatedAt: '2026-10-04T00:00:00Z' });
beforeEach(() => { vi.clearAllMocks(); api.react.mockResolvedValue(undefined); });
afterEach(cleanup);

describe('release hardening: reply-thread request ownership', () => {
  it('ignores a late earlier post response after switching root posts', async () => {
    const earlier = deferred<Post>();
    api.fetch.mockImplementation((id: string) => id === 'a' ? earlier.promise : Promise.resolve(post('b')));
    const view = render(<ReplyThread postId="a" onBack={vi.fn()} />);
    view.rerender(<ReplyThread postId="b" onBack={vi.fn()} />);
    expect(await screen.findByText('Post b')).toBeInTheDocument();
    await act(async () => { earlier.resolve(post('a')); });
    expect(screen.queryByText('Post a')).not.toBeInTheDocument();
    expect(screen.getByTestId('composer')).toHaveTextContent('"parentId":"b"');
    expect(screen.getByTestId('composer')).toHaveTextContent('"folderId":"folder-b"');
  });

  it('resets the nested reply target when opening a different root post', async () => {
    const a = post('a'); a.replies = [post('reply-a')];
    api.fetch.mockImplementation(async (id: string) => id === 'a' ? a : post('b'));
    const view = render(<ReplyThread postId="a" onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reply reply-a' }));
    expect(screen.getByTestId('composer')).toHaveTextContent('"replyToId":"reply-a"');
    view.rerender(<ReplyThread postId="b" onBack={vi.fn()} />);
    expect(await screen.findByText('Post b')).toBeInTheDocument();
    expect(screen.getByTestId('composer')).toHaveTextContent('"replyToId":"b"');
    expect(screen.getByTestId('composer')).not.toHaveTextContent('reply-a');
  });

  it('keeps the latest refresh when two reaction reloads finish out of order', async () => {
    const earlier = deferred<Post>(); const latest = deferred<Post>();
    api.fetch.mockResolvedValueOnce(post('a')).mockReturnValueOnce(earlier.promise).mockReturnValueOnce(latest.promise);
    render(<ReplyThread postId="a" onBack={vi.fn()} />);
    const reactButton = await screen.findByRole('button', { name: 'React a' });
    await act(async () => { fireEvent.click(reactButton); fireEvent.click(reactButton); });
    expect(api.fetch).toHaveBeenCalledTimes(3);
    await act(async () => { latest.resolve(post('a', 'Latest revision')); });
    expect(screen.getByText('Latest revision')).toBeInTheDocument();
    await act(async () => { earlier.resolve(post('a', 'Stale revision')); });
    expect(screen.queryByText('Stale revision')).not.toBeInTheDocument();
    expect(screen.getByText('Latest revision')).toBeInTheDocument();
  });

  it('does not start an old-post reload after a reaction completes on an unmounted thread', async () => {
    const reaction = deferred<void>();
    api.fetch.mockImplementation(async (id: string) => post(id));
    api.react.mockReturnValue(reaction.promise);
    const view = render(<ReplyThread postId="a" onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'React a' }));
    view.rerender(<ReplyThread postId="b" onBack={vi.fn()} />);
    expect(await screen.findByText('Post b')).toBeInTheDocument();
    await act(async () => { reaction.resolve(); });
    expect(api.fetch.mock.calls.map(call => call[0])).toEqual(['a', 'b']);
  });
});
