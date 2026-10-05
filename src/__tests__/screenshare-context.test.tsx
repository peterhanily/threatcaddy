import { act, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InvestigationProvider, InvestigationVisibilityScope, useInvestigation } from '../contexts/InvestigationContext';
import { ScreenshareContext } from '../hooks/ScreenshareContext';
import { DraftRecoveryNotice } from '../components/Common/DraftRecoveryNotice';
import type { Folder, Tag } from '../types';

const api = vi.hoisted(() => ({ members: vi.fn(), count: vi.fn(), bridge: vi.fn(), evict: vi.fn(), failures: vi.fn() }));
vi.mock('../lib/server-api', () => ({ fetchInvestigationMembers: api.members }));
vi.mock('../lib/agent-bridge', () => ({ syncBridgeFolderId: api.bridge }));
vi.mock('../lib/sync-cache', () => ({ evictSyncedFolder: api.evict }));
vi.mock('../lib/entity-drafts', () => ({ getFailedDrafts: api.failures, subscribeFailedDrafts: () => () => {} }));
vi.mock('../lib/export', () => ({ downloadFile: vi.fn() }));
vi.mock('../db', () => ({ db: { agentActions: { where: () => ({
  equals: () => ({ count: api.count }),
}) } } }));

const folders: Folder[] = ['first', 'second'].map(id => ({ id, name: id, order: 0, createdAt: 1 }));
const tags: Tag[] = [{ id: 'tag-first', name: 'first-tag', color: '#123456' }];
beforeEach(() => {
  api.members.mockReset().mockResolvedValue([{ id: 'private-member' }]);
  api.count.mockReset().mockResolvedValue(4);
  api.bridge.mockClear();
  api.evict.mockClear();
  api.failures.mockReset().mockReturnValue([]);
});

describe('investigation visibility overlay', () => {
  function harness() {
    let maxLevel: string | null = null;
    let visibleFolders = folders;
    let visibleTags = tags;
    let raw!: ReturnType<typeof useInvestigation>;
    function Scope({ children }: { children: ReactNode }) {
      raw = useInvestigation();
      return <ScreenshareContext.Provider value={{ maxLevel, effectiveLevels: ['TLP:CLEAR', 'TLP:RED'] }}>
        <InvestigationVisibilityScope folders={visibleFolders} tags={visibleTags}>{children}</InvestigationVisibilityScope>
      </ScreenshareContext.Provider>;
    }
    const view = renderHook(useInvestigation, { wrapper: ({ children }) =>
      <InvestigationProvider folders={folders} tags={tags} authConnected initialSelectedFolderId="first"><Scope>{children}</Scope></InvestigationProvider>,
    });
    return {
      ...view,
      get raw() { return raw; },
      setVisibility(level: string | null, nextFolders = folders, nextTags = tags) {
        maxLevel = level; visibleFolders = nextFolders; visibleTags = nextTags;
        view.rerender();
      },
    };
  }

  it('hides context metadata immediately without clearing the underlying selection', async () => {
    const view = harness();
    await act(async () => {
      view.raw.setEditingFolderId('first');
      view.raw.setSelectedTag('first-tag');
      view.raw.setConfirmUnsyncId('first');
    });
    expect(view.result.current.agentPendingCount).toBe(4);

    view.setVisibility('TLP:CLEAR', [folders[1]], []);
    expect(view.result.current).toMatchObject({
      folders: [folders[1]], tags: [], selectedFolderId: undefined,
      selectedFolder: undefined, editingFolderId: undefined, editingFolder: undefined,
      selectedTag: undefined, selectedTagObj: undefined, investigationMembers: [],
      agentPendingCount: 0, confirmUnsyncId: null,
    });
    expect(view.raw.selectedFolderId).toBe('first');
    expect(view.raw.editingFolderId).toBe('first');
    expect(view.raw.selectedTag).toBe('first-tag');
    expect(api.bridge).not.toHaveBeenCalled();

    view.setVisibility(null);
    expect(view.result.current).toMatchObject({ selectedFolder: folders[0], editingFolder: folders[0], selectedTag: 'first-tag', agentPendingCount: 4 });
    expect(view.result.current.investigationMembers).toEqual([{ id: 'private-member' }]);
  });

  it('rejects hidden folder/tag targets but permits visible selection and explicit clearing', async () => {
    const view = harness();
    view.setVisibility('TLP:CLEAR', [folders[0]], []);
    await act(async () => {
      view.result.current.setSelectedFolderId('second');
      view.result.current.handleOpenInvestigation('second', 'remote');
      view.result.current.setEditingFolderId('second');
      view.result.current.setSelectedTag('first-tag');
      view.result.current.handleUnsync('second');
      view.result.current.setConfirmUnsyncId('second');
      await view.result.current.handleUnsyncConfirmed('second');
    });
    expect(view.raw.selectedFolderId).toBe('first');
    expect(view.raw.editingFolderId).toBeUndefined();
    expect(view.raw.selectedTag).toBeUndefined();
    expect(view.raw.confirmUnsyncId).toBeNull();
    expect(api.bridge).not.toHaveBeenCalled();
    expect(api.evict).not.toHaveBeenCalled();

    await act(async () => view.result.current.setSelectedFolderId(undefined));
    expect(view.raw.selectedFolderId).toBeUndefined();
    await act(async () => view.result.current.handleOpenInvestigation('first', 'local'));
    expect(view.raw.selectedFolderId).toBe('first');
  });

  it('preserves remote-only behavior while off and hides it only while sharing', async () => {
    const view = harness();
    expect(view.result.current.setSelectedFolderId).toBe(view.raw.setSelectedFolderId);
    await act(async () => view.result.current.handleOpenInvestigation('remote-only', 'remote'));
    expect(view.result.current).toMatchObject({ selectedFolderId: 'remote-only', investigationMode: 'remote' });
    view.setVisibility('TLP:CLEAR');
    expect(view.result.current).toMatchObject({ selectedFolderId: undefined, investigationMode: 'local', investigationMembers: [], agentPendingCount: 0 });
    expect(view.raw.selectedFolderId).toBe('remote-only');
    view.setVisibility(null);
    expect(view.result.current).toMatchObject({ selectedFolderId: 'remote-only', investigationMode: 'remote' });
  });
});

it('keeps failed draft contents and recovery actions hidden while sharing without mutating recovery', () => {
  const draft = { retry: vi.fn(), canDiscard: () => true, discard: vi.fn(), resolveConflict: vi.fn() };
  api.failures.mockReturnValue([{ key: 'note:secret-id', draft, snapshot: {
    patch: { title: 'Sensitive title' }, error: 'Sensitive error',
    conflicts: { content: { local: 'Sensitive local body', remote: 'Sensitive remote body' } },
  } }]);
  const ui = (maxLevel: string | null) => <ScreenshareContext.Provider value={{ maxLevel, effectiveLevels: [] }}><DraftRecoveryNotice /></ScreenshareContext.Provider>;
  const view = render(ui(null));
  expect(screen.getByText('Sensitive title')).toBeInTheDocument();
  view.rerender(ui('TLP:CLEAR'));
  expect(screen.getByRole('alert')).not.toHaveTextContent('Sensitive');
  expect(screen.queryAllByRole('button')).toHaveLength(0);
  expect(view.container.textContent).not.toContain('secret-id');
  view.rerender(ui(null));
  expect(screen.getByText('Sensitive title')).toBeInTheDocument();
  expect(screen.getByText('Sensitive error')).toBeInTheDocument();
  expect(draft.retry).not.toHaveBeenCalled();
  expect(draft.discard).not.toHaveBeenCalled();
  expect(draft.resolveConflict).not.toHaveBeenCalled();
});
