import { useTranslation } from 'react-i18next';
import type { IOCType } from '../../types';
import { IOC_TYPE_LABELS } from '../../types';

interface IOCBadgeProps {
  type: IOCType;
  count?: number;
  active?: boolean;
  onClick?: () => void;
}

export function IOCBadge({ type, count, active, onClick }: IOCBadgeProps) {
  const { t } = useTranslation('analysis');
  const { label, color } = IOC_TYPE_LABELS[type as IOCType] || { label: type, color: '#6b7280' };

  const ariaLabel = count !== undefined && count > 0
    ? (active
      ? t('badge.filterActiveAria', { label, count })
      : t('badge.filterCountAria', { label, count }))
    : active
      ? t('badge.filterActiveOnlyAria', { label })
      : t('badge.filterAria', { label });

  return (
    <button
      onClick={onClick}
      aria-label={ariaLabel}
      className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors whitespace-nowrap"
      style={{
        backgroundColor: active ? `${color}30` : `${color}15`,
        color: active ? color : `${color}99`,
        border: `1px solid ${active ? `${color}60` : `${color}20`}`,
      }}
    >
      <span>{label}</span>
      {count !== undefined && count > 0 && (
        <span
          className="min-w-[16px] h-4 flex items-center justify-center rounded-full text-[10px]"
          style={{ backgroundColor: `${color}30` }}
        >
          {count}
        </span>
      )}
    </button>
  );
}
