import { useId, useState } from 'react';
import type { Folder, Identity } from '../../types';
import { Modal } from '../Common/Modal';
import { downloadFile } from '../../lib/export';
import { slugify } from '../../lib/ioc-export';
import { identitiesToCsv } from '../../lib/identity-export';
import type { IdentityLabels } from './identity-labels';

const button = 'rounded-md border border-border-subtle px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary';

/** Exports the identities in view. Private details stay out unless asked for, and never while screensharing. */
export function IdentityExportDialog({ identities, byId, folders, folderId, screensharing, labels, onClose, onExported }: {
  identities: Identity[];
  byId: ReadonlyMap<string, Identity>;
  folders: Folder[];
  /** The investigation shown, or undefined for every investigation. */
  folderId?: string;
  screensharing: boolean;
  labels: IdentityLabels;
  onClose: () => void;
  onExported: (file: string) => void;
}) {
  const { t } = labels;
  const ids = useId();
  const [includePrivate, setIncludePrivate] = useState(false);
  const scope = folders.find(folder => folder.id === folderId)?.name;
  const exportFile = () => {
    // A name in a non-Latin script has no ASCII slug: say "investigation" rather than "all".
    const file = `threatcaddy-identities-${scope ? slugify(scope) || 'investigation' : 'all'}-${new Date().toISOString().slice(0, 10)}.csv`;
    downloadFile(identitiesToCsv(identities, { byId, folders, includePrivate: includePrivate && !screensharing }), file, 'text/csv;charset=utf-8');
    onExported(file);
  };
  return (
    <Modal open onClose={onClose} title={t('export.title')}>
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-text-secondary">{t('export.summary', { count: identities.length, scope: scope ?? t('export.allInvestigations') })}</p>
        <p className="text-xs text-text-muted">{t('export.csvHint')}</p>
        <label htmlFor={`${ids}-private`} className="flex items-start gap-2 text-text-secondary">
          <input id={`${ids}-private`} type="checkbox" className="mt-1" checked={includePrivate && !screensharing} disabled={screensharing}
            onChange={event => setIncludePrivate(event.target.checked)} aria-describedby={`${ids}-private-hint`} />
          <span>{t('export.includePrivate')}</span>
        </label>
        <p id={`${ids}-private-hint`} className="-mt-2 ps-6 text-xs text-text-muted">{screensharing ? t('details.hiddenWhileSharing') : t('export.privateHint')}</p>
        <div className="flex justify-end gap-2 border-t border-border-subtle pt-3">
          <button type="button" className={button} onClick={onClose}>{t('form.cancel')}</button>
          <button type="button" disabled={!identities.length} onClick={exportFile}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50">
            {t('export.button')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
