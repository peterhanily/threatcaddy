import { getEffectiveClsLevels, getClsBadgeStyle } from '../../lib/classification';

interface ClsSelectProps {
  value?: string;
  onChange: (level: string | undefined) => void;
  clsLevels?: string[];
  className?: string;
}

/** Compact TLP/classification level dropdown for toolbars. */
export function ClsSelect({ value, onChange, clsLevels, className }: ClsSelectProps) {
  const style = value ? getClsBadgeStyle(value) : null;
  return (
    <select
      value={value || ''}
      onChange={(e) => onChange(e.target.value || undefined)}
      className={`bg-transparent text-xs border rounded px-1.5 py-0.5 focus:outline-none focus:border-accent cursor-pointer ${
        style ? `${style.text} ${style.border}` : 'text-gray-500 border-gray-700'
      } ${className ?? ''}`}
      aria-label="Classification level"
    >
      <option value="">TLP</option>
      {getEffectiveClsLevels(clsLevels).map((v) => (
        <option key={v} value={v}>{v}</option>
      ))}
    </select>
  );
}
