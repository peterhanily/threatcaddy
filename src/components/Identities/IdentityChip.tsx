import { useTranslation } from 'react-i18next';
import { Contact } from 'lucide-react';
import type { FoundSource } from '../../lib/identity-model';
import { cn } from '../../lib/utils';
import { useIdentityLinks } from './identity-links';

const TONES = {
  actor: { plain: 'bg-purple-500/15 text-purple-400', linked: 'bg-purple-500/15 text-purple-300', notYet: 'border-purple-400/60 text-purple-300' },
  asset: { plain: 'bg-gray-700/50 text-gray-400', linked: 'bg-gray-700/50 text-gray-200', notYet: 'border-gray-500 text-gray-400' },
} as const;

/**
 * Text from an event or IOC as a chip: linked to an identity (opens it), dashed when it is not
 * in Identities yet (opens link / add / ignore), or plain. `role` names the field for title text.
 */
export function IdentityChip({ folderId, text, source, tone, role }: {
  folderId?: string; text: string; source: FoundSource; tone: keyof typeof TONES; role: string;
}) {
  const { t } = useTranslation('common');
  const links = useIdentityLinks();
  const link = links?.linkFor(folderId, text) ?? { state: 'plain' as const };
  const base = 'inline-flex min-w-0 max-w-[140px] items-center gap-0.5 rounded-full px-1.5 text-[10px]';
  if (links && link.state === 'linked') {
    return (
      <button type="button" onClick={() => links.open(link.identity)} title={`${role}: ${link.identity.name}`}
        aria-label={t('identityChip.open', { text, name: link.identity.name })}
        className={cn(base, TONES[tone].linked, 'hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent')}>
        <Contact size={9} aria-hidden="true" className="shrink-0" /><span className="truncate">{text}</span>
      </button>
    );
  }
  if (links?.resolve && folderId && link.state === 'notYet') {
    const resolve = links.resolve;
    return (
      <button type="button" onClick={() => resolve(folderId, text, source)} title={role} aria-label={t('identityChip.notYet', { text })}
        className={cn(base, TONES[tone].notYet, 'border border-dashed hover:border-solid')}>
        <span className="truncate">{text}</span>
      </button>
    );
  }
  return <span title={role} className={cn(base, TONES[tone].plain)}><span className="truncate">{text}</span></span>;
}
