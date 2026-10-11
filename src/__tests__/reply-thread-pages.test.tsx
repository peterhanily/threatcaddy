import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Post } from '../types';
import { ReplyThread } from '../components/CaddyShack/ReplyThread';

const api = vi.hoisted(() => ({ fetch: vi.fn(), react: vi.fn(), toast: vi.fn() }));
vi.mock('../lib/server-api', () => ({ fetchPostPage: api.fetch, addReaction: api.react, removeReaction: vi.fn(), deletePost: vi.fn(), editPost: vi.fn() }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: api.toast }) }));
vi.mock('../components/CaddyShack/PostCard', () => ({ PostCard: ({ post, onReact }: {
  post: Post; onReact: (id: string, emoji: string) => void;
}) => <article><span>{post.content}</span><button onClick={() => onReact(post.id, '👍')}>React {post.id}</button></article> }));
vi.mock('../components/CaddyShack/PostComposer', () => ({ PostComposer: function Composer() {
  const [value, setValue] = useState('');
  return <textarea aria-label="Reply draft" value={value} onChange={event => setValue(event.target.value)} />;
} }));

function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Not initialized'); };
  let reject: (error: Error) => void = () => { throw new Error('Not initialized'); };
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const post = (id: string): Post => ({ id, content: `Post ${id}`, replies: [], authorDisplayName: 'Synthetic author',
  authorId: 'synthetic-user', attachments: [], mentions: [], pinned: false, deleted: false,
  createdAt: '2026-10-04T00:00:00Z', updatedAt: '2026-10-04T00:00:00Z' });
function page(ids: string[], nextCursor: string | null, root = 'root'): Post {
  return { ...post(root), replies: ids.map(post), replyPage: { total: 3, limit: 50, hasMore: !!nextCursor, nextCursor } };
}
beforeEach(() => { vi.clearAllMocks(); api.react.mockResolvedValue(undefined); });
afterEach(cleanup);

describe('reply page presentation and ownership', () => {
  it('appends a page once, deduplicates IDs, and keeps the composer mounted throughout', async () => {
    const next = deferred<Post>();
    api.fetch.mockResolvedValueOnce(page(['one'], 'next-page')).mockReturnValueOnce(next.promise);
    render(<ReplyThread postId="root" onBack={vi.fn()} />);
    expect(await screen.findByText('Post one')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Reply draft' }), { target: { value: 'Retain this draft' } });
    const more = screen.getByRole('button', { name: 'Next' });
    fireEvent.click(more); fireEvent.click(more);
    expect(api.fetch).toHaveBeenCalledTimes(2);
    expect(api.fetch).toHaveBeenLastCalledWith('root', 'next-page');
    expect(screen.getByRole('textbox', { name: 'Reply draft' })).toHaveValue('Retain this draft');
    await act(async () => { next.resolve(page(['one', 'two', 'three'], null)); });
    expect(screen.getAllByText('Post one')).toHaveLength(1);
    expect(screen.getByText('Post three')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Reply draft' })).toHaveValue('Retain this draft');
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
  });

  it('treats a legacy response as a complete thread without inventing continuation', async () => {
    api.fetch.mockResolvedValueOnce({ ...post('root'), replies: [post('one'), post('two')] });
    render(<ReplyThread postId="root" onBack={vi.fn()} />);
    expect(await screen.findByText('Post two')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    expect(api.fetch).toHaveBeenCalledTimes(1);
  });

  it('ignores an old page after changing root posts', async () => {
    const next = deferred<Post>();
    api.fetch.mockResolvedValueOnce(page(['one'], 'cursor')).mockReturnValueOnce(next.promise).mockResolvedValueOnce(post('new-root'));
    const view = render(<ReplyThread postId="root" onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    view.rerender(<ReplyThread postId="new-root" onBack={vi.fn()} />);
    expect(await screen.findByText('Post new-root')).toBeInTheDocument();
    await act(async () => { next.resolve(page(['late-reply'], null)); });
    expect(screen.queryByText('Post late-reply')).not.toBeInTheDocument();
  });

  it('invalidates an older page when a mutation reloads the thread, retaining the draft', async () => {
    const next = deferred<Post>();
    const refresh = deferred<Post>();
    api.fetch.mockResolvedValueOnce(page(['one'], 'cursor')).mockReturnValueOnce(next.promise).mockReturnValueOnce(refresh.promise);
    render(<ReplyThread postId="root" onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Reply draft' }), { target: { value: 'Draft during refresh' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'React root' })); });
    expect(screen.getByRole('textbox', { name: 'Reply draft' })).toHaveValue('Draft during refresh');
    await act(async () => { refresh.resolve(page(['current-reply'], null)); next.resolve(page(['stale-reply'], null)); });
    expect(screen.queryByText('Post stale-reply')).not.toBeInTheDocument();
    expect(screen.getByText('Post current-reply')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Reply draft' })).toHaveValue('Draft during refresh');
  });

  it('retains the page and draft after a transient error and permits retry', async () => {
    api.fetch.mockResolvedValueOnce(page(['one'], 'cursor')).mockRejectedValueOnce(new Error('Temporary offline fixture')).mockResolvedValueOnce(page(['two'], null));
    render(<ReplyThread postId="root" onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Post one')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Post two')).toBeInTheDocument();
  });

  it('hides the old thread when a later page is no longer authorized', async () => {
    api.fetch.mockResolvedValueOnce(page(['one'], 'cursor')).mockRejectedValueOnce(Object.assign(new Error('Scope removed'), { status: 403 }));
    render(<ReplyThread postId="root" onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    await screen.findByRole('button', { name: 'Reload' });
    expect(screen.queryByText('Post one')).not.toBeInTheDocument();
    expect(screen.queryByText('Post root')).not.toBeInTheDocument();
  });
});
