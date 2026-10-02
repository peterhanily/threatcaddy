import { useState } from 'react';
import { db } from '../../db';
import { activateWorkspace, getActiveWorkspaceId, listWorkspaceProfiles, createLocalWorkspace, preserveEncryptionForNewWorkspace } from '../../lib/workspace-profiles';
import { withEntityDraftBarrier, hasPendingEntityDrafts } from '../../lib/entity-drafts';
import { syncEngine } from '../../lib/sync-engine';

export function WorkspaceSwitcher() {
  const [profiles] = useState(listWorkspaceProfiles);
  const [selected, setSelected] = useState(getActiveWorkspaceId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const switchWorkspace = async (create = false) => {
    setBusy(true);
    setError('');
    try {
      await withEntityDraftBarrier(async () => {
        if (hasPendingEntityDrafts()) throw new Error('Resolve unsaved drafts before switching workspaces.');
        const destination = create ? (await createLocalWorkspace()).id : selected;
        if (create) preserveEncryptionForNewWorkspace(destination);
        window.dispatchEvent(new Event('workspace-will-switch'));
        syncEngine.stop();
        activateWorkspace(destination);
        db.close();
        window.location.reload();
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to switch workspace.');
      setBusy(false);
    }
  };
  return <section className="space-y-2" aria-label="Workspace">
    <label htmlFor="workspace-profile" className="block text-sm font-semibold">Workspace</label>
    <p className="text-xs text-text-secondary">Each server and account has separate local data, queued edits, credentials, and encryption settings. Signing into a new account creates an empty workspace. Your original local data stays available here.</p>
    <div className="flex gap-2">
      <select id="workspace-profile" value={selected} disabled={busy} onChange={event => setSelected(event.target.value)} className="min-w-0 flex-1 bg-bg-secondary border border-border rounded px-2 py-2 text-sm">
        {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
      </select>
      <button disabled={busy || selected === getActiveWorkspaceId()} onClick={() => void switchWorkspace()} className="px-3 py-2 text-sm border border-border rounded disabled:opacity-50">Switch</button>
    </div>
    <button disabled={busy} onClick={() => void switchWorkspace(true)} className="text-xs underline">Create a new empty local workspace</button>
    {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
  </section>;
}
