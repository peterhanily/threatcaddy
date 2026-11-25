import { createContext, useContext } from 'react';
import type { Identity } from '../../types';
import type { FoundSource } from '../../lib/identity-model';
import type { FolderIndex, TextLink } from '../../lib/identity-match';

/**
 * How the rest of ThreatCaddy links text to identities: timeline chips, `@` mentions in notes,
 * IOC "Belongs to". Provided once in App (`IdentityLinksProvider`); without a provider,
 * components show plain text as before.
 */
export interface IdentityLinks {
  /** How text in an investigation shows: linked, not yet in Identities, or plain. */
  linkFor: (folderId: string | undefined, text: string | undefined) => TextLink;
  /** The identity an IOC value belongs to; `others` counts further identities with that value. */
  belongsTo: (folderId: string | undefined, value: string) => { identity: Identity; others: number } | undefined;
  /** An investigation's linkable identities and names, for suggestions and `@` mentions. */
  folder: (folderId: string | undefined) => FolderIndex | undefined;
  /** Shows an identity in the Identities view. With `query`, the list is filtered to it: used when
   * text names more than one identity, so a person chooses. */
  open: (identity: Identity, query?: string) => void;
  /** Opens the link / add / ignore dialog for text not yet in Identities. Absent when read-only. */
  resolve?: (folderId: string, text: string, source: FoundSource) => void;
}

export const IdentityLinksContext = createContext<IdentityLinks | null>(null);
export const useIdentityLinks = () => useContext(IdentityLinksContext);
