import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceSwitcher } from '../components/Settings/WorkspaceSwitcher';
import { markPending, clearPending } from '../lib/pending-changes';

const state = vi.hoisted(() => ({ activate: vi.fn(), create: vi.fn(), preserve: vi.fn(), close: vi.fn(), stop: vi.fn(), drafts: false }));
vi.mock('../db', () => ({ db: { close: state.close } }));
vi.mock('../lib/sync-engine', () => ({ syncEngine: { stop: state.stop } }));
vi.mock('../lib/entity-drafts', () => ({ hasPendingEntityDrafts: () => state.drafts,
  withEntityDraftBarrier: (fn: () => Promise<unknown>) => fn() }));
vi.mock('../lib/workspace-profiles', () => ({ getActiveWorkspaceId: () => 'default',
  listWorkspaceProfiles: () => [{ id: 'default', label: 'Original' }, { id: 'other', label: 'Other' }],
  activateWorkspace: state.activate, createLocalWorkspace: state.create, preserveEncryptionForNewWorkspace: state.preserve }));
const pending = Symbol('synthetic unsent file or chat draft');
beforeEach(() => { vi.clearAllMocks(); state.drafts = false; });
afterEach(() => { cleanup(); clearPending(pending); });

describe('workspace changes preserve uncommitted work before navigation', () => {
  it.each(['existing', 'new'])('blocks %s workspace before activation, DB close or new-profile creation', async kind => {
    markPending(pending); render(<WorkspaceSwitcher />);
    if (kind === 'existing') {
      fireEvent.change(screen.getByRole('combobox', { name: 'Workspace' }), { target: { value: 'other' } });
      fireEvent.click(screen.getByRole('button', { name: 'Switch' }));
    } else fireEvent.click(screen.getByRole('button', { name: 'Create a new empty local workspace' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Finish or discard unsaved work before switching workspaces.');
    expect(state.activate).not.toHaveBeenCalled(); expect(state.close).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled(); expect(state.preserve).not.toHaveBeenCalled(); expect(state.stop).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create a new empty local workspace' })).toBeEnabled());
  });
});
