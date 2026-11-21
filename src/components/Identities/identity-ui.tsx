import { Box, Building, KeyRound, Landmark, Monitor, Server } from 'lucide-react';
import type { Folder, Identity, IdentityStatus } from '../../types';
import { initials, isOrganization, isPerson } from '../../lib/identity-model';
import { cn } from '../../lib/utils';

const STATUS_RING: Record<IdentityStatus, string> = {
  compromised: 'ring-red-500', suspicious: 'ring-amber-500', cleared: 'ring-green-500',
};

/** Initials for a person; an icon for anything else. Decorative: the name is always beside it. */
export function IdentityAvatar({ identity, size = 'sm' }: { identity: Identity; size?: 'xs' | 'sm' | 'md' | 'lg' }) {
  const box = { xs: 'h-5 w-5 text-[9px]', sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-14 w-14 text-lg' }[size];
  const icon = { xs: 11, sm: 15, md: 18, lg: 26 }[size];
  const ring = identity.status ? cn('ring-2 ring-offset-1 ring-offset-bg-surface', STATUS_RING[identity.status]) : '';
  if (isPerson(identity)) {
    return <span aria-hidden="true" className={cn('inline-flex shrink-0 items-center justify-center rounded-full bg-accent-blue/15 font-semibold text-accent-blue', box, ring)}>{initials(identity.name)}</span>;
  }
  const Icon = isOrganization(identity) ? Building : identity.type === 'system'
    ? (/server|controller|gateway|db|sql/i.test(`${identity.name} ${identity.description ?? ''}`) ? Server : Monitor)
    : identity.type === 'account' ? (identity.details.some(detail => /iban|bank/i.test(detail.label)) ? Landmark : KeyRound) : Box;
  const tone = isOrganization(identity) ? 'bg-purple/15 text-purple' : identity.type === 'system' ? 'bg-accent-green/15 text-accent-green' : 'bg-amber-500/15 text-amber-400';
  return <span aria-hidden="true" className={cn('inline-flex shrink-0 items-center justify-center rounded-lg', box, tone, ring)}><Icon size={icon} /></span>;
}

/** The investigation's name in its colour, shown when every investigation is listed. */
export function InvestigationPill({ folder, missingLabel }: { folder?: Folder; missingLabel: string }) {
  return (
    <span
      className="inline-block max-w-[9rem] truncate rounded-full px-1.5 text-[10px] text-text-primary align-middle"
      style={{ backgroundColor: folder?.color ? `${folder.color}33` : 'rgba(107,114,128,0.2)' }}
    >
      {folder?.name ?? missingLabel}
    </span>
  );
}
