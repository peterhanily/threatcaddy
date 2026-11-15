import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Post } from '../types';
import { CaddyShackView } from '../components/CaddyShack/CaddyShackView';
import { ReplyThread } from '../components/CaddyShack/ReplyThread';
import { ServerBackup } from '../components/Settings/ServerBackup';

const api = vi.hoisted(() => ({ role: 'viewer', feed: vi.fn(), page: vi.fn(), list: vi.fn() }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ connected: true, serverUrl: 'https://server.test', user: { id: 'user-1', role: api.role } }) }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('../hooks/ScreenshareContext', () => ({ useScreenshare: () => ({ maxLevel: undefined, effectiveLevels: [] }) }));
vi.mock('../hooks/useSettings', () => ({ useSettings: () => ({ settings: { serverUrl: 'https://server.test' } }) }));
vi.mock('../lib/server-api', () => ({
  fetchFeed: api.feed, fetchTeamActivity: vi.fn(async () => []), fetchServerInfo: vi.fn(async () => ({ serverName: 'Synthetic' })),
  fetchPostPage: api.page, addReaction: vi.fn(), removeReaction: vi.fn(), deletePost: vi.fn(), editPost: vi.fn(),
  listBackups: api.list, downloadBackup: vi.fn(), createBackup: vi.fn(), deleteBackup: vi.fn(),
}));
vi.mock('../components/CaddyShack/PostComposer', () => ({ PostComposer: () => <output data-testid="composer" /> }));
vi.mock('../components/CaddyShack/PostCard', () => ({ PostCard: ({ post, onReply, onEdit, onPin, onDelete, onClick }: {
  post: Post; onReply?: unknown; onEdit?: unknown; onPin?: unknown; onDelete?: unknown; onClick?: (postId: string) => void;
}) => <article onClick={() => onClick?.(post.id)}>{post.content} {JSON.stringify({ reply: !!onReply, edit: !!onEdit, pin: !!onPin, delete: !!onDelete })}</article> }));

const post = (id: string, replies: Post[] = []): Post => ({ id, content: `Post ${id}`, authorId: 'user-1', authorDisplayName: 'Synthetic viewer',
  attachments: [], mentions: [], pinned: false, deleted: false, replies, createdAt: '2026-10-04T00:00:00Z', updatedAt: '2026-10-04T00:00:00Z' });
const readOnlyHint = /Your viewer role can read and react to posts/;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('caddyshack-onboarded', '1');
  api.feed.mockResolvedValue([post('p1')]);
  api.page.mockResolvedValue(post('root', [post('r1')]));
  api.list.mockResolvedValue({ backups: [{ id: 'b1', name: 'Earlier backup', type: 'full', scope: 'all', createdAt: '2026-01-01', sizeBytes: 100, entityCount: 1 }] });
});
afterEach(cleanup);

describe('viewer role: the SPA offers only what the server accepts', () => {
  it('hides the feed composer, Edit and Pin for viewers but keeps reactions, replies view and Delete', async () => {
    api.role = 'viewer';
    render(<CaddyShackView />);
    expect(await screen.findByText(/Post p1/)).toHaveTextContent('{"reply":true,"edit":false,"pin":false,"delete":true}');
    expect(screen.queryByTestId('composer')).not.toBeInTheDocument();
    expect(screen.getByText(readOnlyHint)).toBeInTheDocument();
  });

  it('keeps the feed composer, Edit and Pin for analysts', async () => {
    api.role = 'analyst';
    render(<CaddyShackView />);
    expect(await screen.findByText(/Post p1/)).toHaveTextContent('{"reply":true,"edit":true,"pin":true,"delete":true}');
    expect(screen.getByTestId('composer')).toBeInTheDocument();
    expect(screen.queryByText(readOnlyHint)).not.toBeInTheDocument();
  });

  it('opens a post from the feed as a read-only thread for viewers', async () => {
    api.role = 'viewer';
    render(<CaddyShackView />);
    fireEvent.click(await screen.findByText(/Post p1/));
    expect(await screen.findByText(/Post r1/)).toHaveTextContent('{"reply":false,"edit":false,"pin":false,"delete":true}');
    expect(api.page).toHaveBeenCalledWith('p1');
    expect(screen.queryByTestId('composer')).not.toBeInTheDocument();
    expect(screen.getByText(readOnlyHint)).toBeInTheDocument();
  });

  it('hides the reply composer and reply targets in a read-only thread', async () => {
    render(<ReplyThread postId="root" onBack={vi.fn()} readOnly />);
    expect(await screen.findByText(/Post r1/)).toHaveTextContent('{"reply":false,"edit":false,"pin":false,"delete":true}');
    expect(screen.getByText(/Post root/)).toHaveTextContent('{"reply":false,"edit":false,"pin":false,"delete":true}');
    expect(screen.queryByTestId('composer')).not.toBeInTheDocument();
    expect(screen.getByText(readOnlyHint)).toBeInTheDocument();
  });

  it('PostCard offers Edit and Pin only when it is given those actions', async () => {
    const { PostCard } = await vi.importActual<typeof import('../components/CaddyShack/PostCard')>('../components/CaddyShack/PostCard');
    const openMenu = () => fireEvent.click(screen.getAllByRole('button').filter(button => !button.textContent?.trim())[0]);
    const view = render(<PostCard post={post('p1')} currentUserId="user-1" onDelete={vi.fn()} />);
    openMenu();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pin' })).not.toBeInTheDocument();
    view.unmount();

    render(<PostCard post={post('p1')} currentUserId="user-1" onDelete={vi.fn()} onEdit={vi.fn()} onPin={vi.fn()} />);
    openMenu();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pin' })).toBeInTheDocument();
  });

  it('hides server backup creation for viewers but keeps restore and delete', async () => {
    api.role = 'viewer';
    render(<ServerBackup />);
    expect(await screen.findByText('Earlier backup')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create Backup' })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Encryption password')).not.toBeInTheDocument();
    expect(screen.getByText(/Your viewer role cannot store backups on the server/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(screen.getByRole('button', { name: 'Decrypt' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Backup' })).toBeInTheDocument();
  });

  it('keeps server backup creation for analysts', async () => {
    api.role = 'analyst';
    render(<ServerBackup />);
    expect(await screen.findByText('Earlier backup')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Backup' })).toBeInTheDocument();
    expect(screen.queryByText(/Your viewer role cannot store backups/)).not.toBeInTheDocument();
  });
});
