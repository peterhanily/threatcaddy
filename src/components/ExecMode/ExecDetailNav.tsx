import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ExecDetailNavProps {
  currentIndex: number;
  totalCount: number;
  onPrev: () => void;
  onNext: () => void;
}

export function ExecDetailNav({ currentIndex, totalCount, onPrev, onNext }: ExecDetailNavProps) {
  const { t } = useTranslation('exec');
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < totalCount - 1;

  return (
    <div className="flex items-center justify-between bg-bg-raised rounded-xl px-4 py-2.5">
      <button
        onClick={onPrev}
        disabled={!hasPrev}
        className={cn('flex items-center gap-1 text-xs font-medium rounded-lg px-2 py-1.5 active:bg-bg-hover transition-colors', hasPrev ? 'text-accent' : 'text-text-muted opacity-40')}
      >
        <ChevronLeft size={14} />
        {t('nav.prev')}
      </button>
      <span className="text-xs text-text-muted">{t('nav.ofTotal', { current: currentIndex + 1, total: totalCount })}</span>
      <button
        onClick={onNext}
        disabled={!hasNext}
        className={cn('flex items-center gap-1 text-xs font-medium rounded-lg px-2 py-1.5 active:bg-bg-hover transition-colors', hasNext ? 'text-accent' : 'text-text-muted opacity-40')}
      >
        {t('nav.next')}
        <ChevronRight size={14} />
      </button>
    </div>
  );
}
