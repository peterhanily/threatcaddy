import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Identity, IdentityStatus } from '../../types';
import {
  BUILTIN_TYPES, CONNECTION_PHRASES, DETAIL_LABELS, PRIVATE_DETAIL_LABELS, isBuiltinType, isConnectionPhrase, isPerson, isPrivateLabel,
  organizationOf, sameText, type BuiltinType, type ConnectionPhrase, type FoundName,
} from '../../lib/identity-model';
import type { AddPrefill } from './IdentityFormModal';

/**
 * Translated labels for types, statuses, connection phrases and detail labels. `suspense: false`
 * for views mounted before anyone opens them (the graph), so the strings load without holding up
 * the app; until then the labels are their keys.
 */
export function useIdentityLabels(options?: { suspense?: boolean }) {
  const { t, i18n } = useTranslation('identities', { useSuspense: options?.suspense ?? true });
  const language = i18n.language;
  return useMemo(() => {
    const typeLabels = Object.fromEntries(BUILTIN_TYPES.map(type => [type, t(`type.${type}`)])) as Record<BuiltinType, string>;
    const phraseLabels = Object.fromEntries((Object.keys(CONNECTION_PHRASES) as ConnectionPhrase[])
      .map(phrase => [phrase, t(`connection.${CONNECTION_PHRASES[phrase]}`)])) as Record<ConnectionPhrase, string>;
    const reverseLabels = Object.fromEntries((Object.keys(CONNECTION_PHRASES) as ConnectionPhrase[])
      .map(phrase => [phrase, t(`connectionReverse.${CONNECTION_PHRASES[phrase]}`)])) as Record<ConnectionPhrase, string>;
    const privateLabels = PRIVATE_DETAIL_LABELS.map(key => t(`detailLabel.${key}`));
    return {
      t,
      typeLabels,
      phraseLabels,
      reverseLabels,
      detailLabels: DETAIL_LABELS.map(key => t(`detailLabel.${key}`)),
      typeLabel: (type: string) => (isBuiltinType(type) ? typeLabels[type] : type),
      statusLabel: (status?: IdentityStatus) => t(`status.${status ?? 'none'}`),
      /** How a connection reads from this identity's side. Built-in phrases read naturally from both. */
      phrase: (label: string, outgoing: boolean) => (isConnectionPhrase(label)
        ? t(`${outgoing ? 'connection' : 'connectionReverse'}.${CONNECTION_PHRASES[label]}`) : label),
      /** Phone, address and similar labels start out private (English or the interface language). */
      privateByDefault: (label: string) => isPrivateLabel(label, privateLabels),
      /** Names or places as a list in the interface language ("A, B, C"; "A、B、C"; "A وB وC"). */
      list: (items: readonly string[]) => new Intl.ListFormat(language, { type: 'conjunction', style: 'narrow' }).format(items),
    };
  }, [t, language]);
}
export type IdentityLabels = ReturnType<typeof useIdentityLabels>;
/** An identity's new field values, or a function that computes them from the stored row. */
export type IdentityChange = Partial<Identity> | ((current: Identity) => Partial<Identity>);

/** The Add form filled in from a name found in an investigation. */
export function prefillFromFound(found: Pick<FoundName, 'text' | 'guess' | 'folderId'>, labels: Pick<IdentityLabels, 't'>): AddPrefill {
  const { guess } = found;
  return { name: found.text, type: guess.type, folderId: found.folderId, fromText: found.text,
    ...(guess.detailLabel ? { detailLabel: labels.t(`detailLabel.${guess.detailLabel}`), detailValue: found.text } : {}) };
}

/** Adds text as another name of an identity, unless it already has it. */
export const withOtherName = (text: string) => (current: Identity): Partial<Identity> =>
  ({ aliases: current.aliases.some(alias => sameText(alias) === sameText(text)) ? current.aliases : [...current.aliases, text] });

export const STATUS_DOT: Record<IdentityStatus, string> = {
  compromised: 'bg-red-500', contained: 'bg-sky-500', suspicious: 'bg-amber-500', cleared: 'bg-green-500',
};

/** One line under a name: role and organisation for a person; type, description and organisation otherwise. */
export function identitySubtitle(identity: Identity, byId: ReadonlyMap<string, Identity>, labels: IdentityLabels): string {
  const organization = organizationOf(identity, byId)?.name;
  const role = identity.description?.trim();
  if (isPerson(identity)) {
    if (role && organization) return labels.t('subtitle.roleAt', { role, organization });
    return role || organization || labels.typeLabel(identity.type);
  }
  return [labels.typeLabel(identity.type), role, organization].filter(Boolean).join(' · ');
}
