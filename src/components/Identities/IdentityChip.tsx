import { useTranslation } from 'react-i18next';
import { Contact } from 'lucide-react';
import type { FoundSource } from '../../lib/identity-model';
import { cn } from '../../lib/utils';
import { useIdentityLinks } from './identity-links';

const TONES = {
  // Colours the light theme remaps to dark ones (index.css) or theme tokens, so chips stay readable in
  // both themes; a linked chip is told apart by its icon and weight. A not-yet chip's dashed outline
  // is drawn in its text colour, so it stands out (WCAG 1.4.11). Asset pills use the hover tone,
  // which differs from the card's own background.
  actor: { plain: 'bg-purple-500/15 text-purple-300', linked: 'bg-purple-500/15 text-purple-300 font-medium', notYet: 'border-current text-purple-300' },
  asset: { plain: 'bg-bg-hover text-text-secondary', linked: 'bg-bg-hover text-text-primary font-medium', notYet: 'border-current text-text-secondary' },
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
