import { lazy, Suspense, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Folder, Identity } from '../../types';
import { foundKey, guessFrom, guessIdentity, type FoundName } from '../../lib/identity-model';
import { belongsTo, buildIdentityIndex, linkFor, type IdentityIndex } from '../../lib/identity-match';
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
  /** Adds a name to Settings › Intel › Attribution Actors, so it is no longer offered as an identity. */
  onTrackThreatActor?: (name: string) => void;
  children: ReactNode;
}

function sameIndex(next: IdentityIndex, previous: IdentityIndex): boolean {
  return next.folders.size === previous.folders.size && [...next.folders].every(([id, folder]) => previous.folders.get(id) === folder)
    && next.actors.size === previous.actors.size && [...next.actors].every(actor => previous.actors.has(actor));
}

export function IdentityLinksProvider({ identities, isVisible, threatActors, folders, readOnly = false, onCreate, onUpdate, onOpen, onTrackThreatActor, children }: Props) {
  const { isIgnored, ignore } = useIgnoredNames();
  // Rebuilt while rendering when its inputs change; investigations whose identities did not change
  // keep their index object, so their note previews are not re-rendered.
  const [built, setBuilt] = useState(() => ({ identities, isVisible, threatActors, index: buildIdentityIndex(identities, { isVisible, threatActors }) }));
  let index = built.index;
  if (built.identities !== identities || built.isVisible !== isVisible || built.threatActors !== threatActors) {
    const next = buildIdentityIndex(identities, { isVisible, threatActors, previous: built.index });
    // While screensharing, the visibility check is a new function whenever any data changes (a note
    // saved); otherwise it is one constant. When no investigation's index and no threat actor
    // changed, the same index is kept, so the chips, IOC owners, reports and graph that read it are
    // not re-rendered.
    index = sameIndex(next, built.index) ? built.index : next;
    setBuilt({ identities, isVisible, threatActors, index });
  }
  const [picked, setPicked] = useState<FoundName | null>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const close = useCallback(() => {
    setPicked(null);
    const target = returnTo.current;
    returnTo.current = null;
    // After the dialog has returned focus to its chip, or found it gone.
    setTimeout(() => { if (target?.isConnected && (document.activeElement === document.body || !document.activeElement?.isConnected)) target.focus(); });
  }, []);

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
      // If the chip is gone when the dialog closes (the name was ignored), focus goes to its item (an event's title).
      const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      returnTo.current = opener?.closest('[data-focus-host]')?.querySelector<HTMLElement>('[data-focus-return]') ?? null;
      setPicked({ key: foundKey(folderId, text), folderId, text, sources: [source],
        guess: guessIdentity(text, guessFrom(source.kind)), looksLike: link.looksLike });
    },
  }), [index, isIgnored, readOnly, onOpen]);

  const live = useMemo(() => [...index.folders.values()].flatMap(folder => folder.identities), [index]);
  return (
    <IdentityLinksContext.Provider value={value}>
      {children}
      {picked && (
        <Suspense fallback={null}>
          <IdentityLinkDialogs found={picked} folders={folders} identities={live} onClose={close}
            onIgnore={() => ignore(picked.folderId, picked.text)} onCreate={onCreate} onUpdate={onUpdate} onTrackActor={onTrackThreatActor} />
        </Suspense>
      )}
    </IdentityLinksContext.Provider>
  );
}
