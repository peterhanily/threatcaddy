import { useState, useRef, useEffect } from 'react';
import { MonitorOff, Check } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ScreenshareToggleProps {
  maxLevel: string | null;
  onChangeLevel: (level: string | null) => void;
  effectiveLevels: string[];
}

export function ScreenshareToggle({ maxLevel, onChangeLevel, effectiveLevels }: ScreenshareToggleProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const active = maxLevel !== null;

  return (
    <div className="relative" ref={ref} data-tour="screenshare">
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setOpen(!open)}
          className={cn(
            'p-1.5 sm:p-2 rounded-lg transition-colors',
            active
              ? 'text-red-400 hover:text-red-300 hover:bg-red-500/10'
              : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
          )}
          title={active ? `Screenshare: ${maxLevel}` : 'Screenshare mode'}
          aria-label="Toggle screenshare mode"
        >
          <MonitorOff size={16} />
        </button>
        {active && (
          <span className="hidden sm:inline text-[10px] font-medium text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">
            Screenshare: {maxLevel}
          </span>
        )}
      </div>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-60 bg-gray-800 border border-gray-700 rounded-lg shadow-lg z-50">
          <button
            onClick={() => { onChangeLevel(null); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 rounded-t-lg"
          >
            {!active && <Check size={12} />}
            <span className={cn('whitespace-nowrap', !active ? '' : 'ms-5')}>Off</span>
          </button>
          {effectiveLevels.map((level, i) => (
            <button
              key={level}
              onClick={() => { onChangeLevel(level); setOpen(false); }}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700',
                i === effectiveLevels.length - 1 && 'rounded-b-lg'
              )}
            >
              {maxLevel === level && <Check size={12} />}
              <span className={cn('whitespace-nowrap', maxLevel === level ? '' : 'ms-5')}>Show up to {level}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
