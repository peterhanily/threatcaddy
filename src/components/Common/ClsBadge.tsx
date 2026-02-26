import { getClsBadgeStyle } from '../../lib/classification';

interface ClsBadgeProps {
  level: string;
  size?: 'xs' | 'sm';
}

export function ClsBadge({ level, size = 'xs' }: ClsBadgeProps) {
  if (!level) return null;
  const style = getClsBadgeStyle(level);
  const sizeClass = size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-[10px] px-1.5';
  return (
    <span className={`${style.bg} ${style.text} ${style.border} border rounded-full font-medium whitespace-nowrap ${sizeClass}`}>
      {level}
    </span>
  );
}
