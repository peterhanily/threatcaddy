import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { getFailedDrafts, subscribeFailedDrafts } from '../../lib/entity-drafts';
import { downloadFile } from '../../lib/export';
import { useScreenshare } from '../../hooks/ScreenshareContext';

/** Recovery remains reachable after navigating away or deleting an entity. */
export function DraftRecoveryNotice() {
  const { t } = useTranslation();
  const { maxLevel } = useScreenshare();
  const failures = useSyncExternalStore(subscribeFailedDrafts, getFailedDrafts);
  if (failures.length === 0) return null;
  // Recovery errors, titles and conflict snapshots have no classification
  // provenance. Preserve the drafts, but do not reveal their contents or offer
  // a download that could expose sensitive filenames while sharing the screen.
  if (maxLevel !== null) {
    return (
      <aside role="alert" className="fixed bottom-4 left-4 right-4 md:right-auto md:max-w-lg z-[100] rounded-lg border border-red-700 bg-gray-950 p-4 text-sm text-red-200 shadow-xl">
        <p>{t('draftRecovery.message')}</p>
        <p>{t('draftRecovery.screenshareHidden', { defaultValue: 'Turn off screenshare mode to review unsaved drafts.' })}</p>
      </aside>
    );
  }
  return (
    <aside role="alert" className="fixed bottom-4 left-4 right-4 md:right-auto md:max-w-lg z-[100] rounded-lg border border-red-700 bg-gray-950 p-4 text-sm text-red-200 shadow-xl">
      <p>{t('draftRecovery.message')}</p>
      <ul className="mt-2 space-y-2 max-h-48 overflow-y-auto">
        {failures.map(({ key, draft, snapshot }) => {
          const title = snapshot.patch.title ?? snapshot.patch.name;
          return (
            <li key={key} className="flex flex-wrap items-center gap-3">
              <span className="truncate max-w-48">{typeof title === 'string' && title ? title : t('draftRecovery.untitled')}</span>
              <button className="underline" disabled={Object.keys(snapshot.conflicts ?? {}).length > 0} onClick={() => { void draft.retry(); }}>{t('draftRecovery.retry')}</button>
              <button className="underline" onClick={() => {
                downloadFile(JSON.stringify({ format: 'threatcaddy-unsaved-draft-v1', entity: key, changes: snapshot.patch, conflicts: snapshot.conflicts }, null, 2),
                  `threatcaddy-draft-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}.json`, 'application/json');
              }}>{t('draftRecovery.download')}</button>
              <button className="underline" disabled={!draft.canDiscard()} onClick={() => {
                if (window.confirm(t('draftRecovery.discardConfirm', { defaultValue: 'Discard this unsaved draft permanently? Download it first if you need a recovery copy.' }))) draft.discard(true);
              }}>{t('draftRecovery.discard', { defaultValue: 'Discard draft' })}</button>
              <span className="basis-full text-xs">{snapshot.error}</span>
              {Object.entries(snapshot.conflicts ?? {}).map(([field, conflict]) => (
                <div key={field} className="basis-full border-t border-red-900 pt-2">
                  <details><summary>{t('draftRecovery.conflictField', { defaultValue: 'Review {{field}} conflict', field })}</summary>
                    <pre className="max-h-32 overflow-auto whitespace-pre-wrap">{JSON.stringify({ local: conflict.local, remote: conflict.remote }, null, 2)}</pre>
                  </details>
                  <button className="underline mr-3" disabled={!draft.canDiscard()} onClick={() => draft.resolveConflict(field, 'local')}>{t('draftRecovery.keepLocal', { defaultValue: 'Keep my {{field}}', field })}</button>
                  <button className="underline" disabled={!draft.canDiscard()} onClick={() => draft.resolveConflict(field, 'remote')}>{t('draftRecovery.useRemote', { defaultValue: 'Use remote {{field}}', field })}</button>
                </div>
              ))}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
