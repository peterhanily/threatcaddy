import { useTranslation } from 'react-i18next';
import { Contact } from 'lucide-react';
import type { FoundSource } from '../../lib/identity-model';
import { cn } from '../../lib/utils';
import { useIdentityLinks } from './identity-links';

const TONES = {
  // Colours the light theme remaps (index.css) or theme tokens, so chips stay readable in both themes;
  // a linked chip is told apart by its icon and weight, not by a paler colour.
  actor: { plain: 'bg-purple-500/15 text-purple-400', linked: 'bg-purple-500/15 text-purple-400 font-medium', notYet: 'border-purple-400/60 text-purple-400' },
  asset: { plain: 'bg-bg-raised text-text-secondary', linked: 'bg-bg-raised text-text-primary font-medium', notYet: 'border-border-medium text-text-secondary' },
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
    // Text that names more than one identity opens the list filtered to it, so a person chooses.
    const ambiguous = link.others > 0;
    return (
      <button type="button" onClick={() => links.open(link.identity, ambiguous ? text : undefined)} title={`${role}: ${link.identity.name}`}
        aria-label={ambiguous ? t('identityChip.ambiguous', { text, role }) : t('identityChip.open', { text, role, name: link.identity.name })}
        className={cn(base, TONES[tone].linked, 'hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent')}>
        <Contact size={9} aria-hidden="true" className="shrink-0" /><span dir="auto" className="truncate">{text}</span>
      </button>
    );
  }
  if (links?.resolve && folderId && link.state === 'notYet') {
    const resolve = links.resolve;
    return (
      <button type="button" onClick={() => resolve(folderId, text, source)} title={`${role}: ${text}`} aria-label={t('identityChip.notYet', { text, role })}
        className={cn(base, TONES[tone].notYet, 'border border-dashed hover:border-solid')}>
        <span dir="auto" className="truncate">{text}</span>
      </button>
    );
  }
  return <span title={`${role}: ${text}`} className={cn(base, TONES[tone].plain)}><span dir="auto" className="truncate">{text}</span></span>;
}
