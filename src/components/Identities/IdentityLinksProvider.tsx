import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import type { Folder, Identity } from '../../types';
import { foundKey, guessIdentity, type FoundName } from '../../lib/identity-model';
import { belongsTo, buildIdentityIndex, linkFor } from '../../lib/identity-match';
import { useIgnoredNames } from '../../hooks/useIgnoredNames';
import { IdentityLinksContext, type IdentityLinks } from './identity-links';
import type { IdentityChange } from './identity-labels';

// The dialogs, and the identities strings they use, load only when one opens.
const IdentityLinkDialogs = lazy(() => import('./IdentityLinkDialogs').then(m => ({ default: m.IdentityLinkDialogs })));

interface Props {
  /** Every identity in scope (any state): this device's, or a remote investigation's. */
  identities: Identity[];
  /** Screenshare visibility; hidden identities are known but never linked. */
  isVisible?: (identity: Identity) => boolean;
  threatActors?: string[];
  folders: Folder[];
  /** A remote investigation: links open, but nothing is offered to add. */
  readOnly?: boolean;
  onCreate: (partial: Partial<Identity>) => Promise<Identity>;
  onUpdate: (id: string, change: IdentityChange) => Promise<void>;
  onOpen: (identity: Identity, query?: string) => void;
  children: ReactNode;
}

export function IdentityLinksProvider({ identities, isVisible, threatActors, folders, readOnly = false, onCreate, onUpdate, onOpen, children }: Props) {
  const { isIgnored, ignore } = useIgnoredNames();
  // Rebuilt while rendering when its inputs change; investigations whose identities did not change
  // keep their index object, so their note previews are not re-rendered.
  const [built, setBuilt] = useState(() => ({ identities, isVisible, threatActors, index: buildIdentityIndex(identities, { isVisible, threatActors }) }));
  let index = built.index;
  if (built.identities !== identities || built.isVisible !== isVisible || built.threatActors !== threatActors) {
    index = buildIdentityIndex(identities, { isVisible, threatActors, previous: built.index });
    setBuilt({ identities, isVisible, threatActors, index });
  }
  const [picked, setPicked] = useState<FoundName | null>(null);

  const value = useMemo<IdentityLinks>(() => ({
    linkFor: (folderId, text) => {
      const link = linkFor(index, folderId, text, isIgnored);
      return readOnly && link.state === 'notYet' ? { state: 'plain' } : link;
    },
    belongsTo: (folderId, ioc) => belongsTo(index, { folderId, value: ioc }),
    folder: folderId => (folderId ? index.folders.get(folderId) : undefined),
    open: onOpen,
    resolve: readOnly ? undefined : (folderId, raw, source) => {
      const text = raw.trim();
      const link = linkFor(index, folderId, text);
      if (link.state !== 'notYet') return;
      setPicked({ key: foundKey(folderId, text), folderId, text, sources: [source],
        guess: guessIdentity(text, source.kind === 'asset'), looksLike: link.looksLike });
    },
  }), [index, isIgnored, readOnly, onOpen]);

  const live = useMemo(() => [...index.folders.values()].flatMap(folder => folder.identities), [index]);
  return (
    <IdentityLinksContext.Provider value={value}>
      {children}
      {picked && (
        <Suspense fallback={null}>
          <IdentityLinkDialogs found={picked} folders={folders} identities={live} onClose={() => setPicked(null)}
            onIgnore={() => ignore(picked.folderId, picked.text)} onCreate={onCreate} onUpdate={onUpdate} />
        </Suspense>
      )}
    </IdentityLinksContext.Provider>
  );
}
