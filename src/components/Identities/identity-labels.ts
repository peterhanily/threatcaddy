import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Identity, IdentityStatus } from '../../types';
import {
  BUILTIN_TYPES, CONNECTION_PHRASES, DETAIL_LABELS, PRIVATE_DETAIL_LABELS, isBuiltinType, isConnectionPhrase, isPerson,
  organizationOf, sameText, type BuiltinType, type ConnectionPhrase,
} from '../../lib/identity-model';

/** Translated labels for types, statuses, connection phrases and detail labels. */
export function useIdentityLabels() {
  const { t } = useTranslation('identities');
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
      privateByDefault: (label: string) => {
        const key = sameText(label);
        return PRIVATE_DETAIL_LABELS.some((name, index) => sameText(name.replace(/([A-Z])/g, ' $1')) === key || sameText(privateLabels[index]) === key);
      },
    };
  }, [t]);
}
export type IdentityLabels = ReturnType<typeof useIdentityLabels>;
/** An identity's new field values, or a function that computes them from the stored row. */
export type IdentityChange = Partial<Identity> | ((current: Identity) => Partial<Identity>);

export const STATUS_DOT: Record<IdentityStatus, string> = {
  compromised: 'bg-red-500', suspicious: 'bg-amber-500', cleared: 'bg-green-500',
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
