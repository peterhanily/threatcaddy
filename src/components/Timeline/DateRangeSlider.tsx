import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import type { TimelineEvent } from '../../types';

interface DateRangeSliderProps {
  events: TimelineEvent[];
  dateStart: number | undefined;
  dateEnd: number | undefined;
  onChange: (start: number | undefined, end: number | undefined) => void;
}

function formatDate(ts: number, shortSpan: boolean): string {
  const d = new Date(ts);
  const month = d.toLocaleString('en-US', { month: 'short' });
  const day = d.getDate();
  if (shortSpan) {
    const hours = d.getHours().toString().padStart(2, '0');
    const mins = d.getMinutes().toString().padStart(2, '0');
    return `${month} ${day} ${hours}:${mins}`;
  }
  return `${month} ${day}`;
}

export function DateRangeSlider({ events, dateStart, dateEnd, onChange }: DateRangeSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null);

  const { minTs, maxTs } = useMemo(() => {
    if (events.length < 2) return { minTs: 0, maxTs: 0 };
    let min = Infinity;
    let max = -Infinity;
    for (const e of events) {
      if (e.timestamp < min) min = e.timestamp;
      if (e.timestamp > max) max = e.timestamp;
    }
    return { minTs: min, maxTs: max };
  }, [events]);

  const range = maxTs - minTs;
  const hidden = events.length < 2 || range === 0;

  const shortSpan = range < 2 * 24 * 60 * 60 * 1000; // < 2 days
  const startFrac = dateStart !== undefined && range > 0 ? (dateStart - minTs) / range : 0;
  const endFrac = dateEnd !== undefined && range > 0 ? (dateEnd - minTs) / range : 1;
  const isNarrowed = dateStart !== undefined || dateEnd !== undefined;

  const getTrackFraction = useCallback((clientX: number) => {
    if (!trackRef.current) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    const frac = (clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(1, frac));
  }, []);

  useEffect(() => {
    if (!dragging) return;

    const handleMove = (e: PointerEvent) => {
      const frac = getTrackFraction(e.clientX);
      const toTs = (f: number) => minTs + f * range;
      if (dragging === 'start') {
        const clamped = Math.min(frac, endFrac);
        onChange(clamped <= 0 ? undefined : toTs(clamped), dateEnd);
      } else {
        const clamped = Math.max(frac, startFrac);
        onChange(dateStart, clamped >= 1 ? undefined : toTs(clamped));
      }
    };

    const handleUp = () => setDragging(null);

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }); // intentionally no deps — re-subscribes each render to capture latest values

  if (hidden) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800">
      <span className="text-[10px] text-gray-500 shrink-0 select-none">Range</span>
      <div className="relative flex-1 flex items-center h-6 select-none touch-none">
        {/* Track */}
        <div
          ref={trackRef}
          className="absolute inset-x-0 h-1.5 rounded bg-gray-700"
        />
        {/* Selected fill */}
        <div
          className="absolute h-1.5 rounded bg-accent/40"
          style={{ left: `${startFrac * 100}%`, right: `${(1 - endFrac) * 100}%` }}
        />
        {/* Start handle */}
        <div
          className="absolute w-3 h-3 rounded-full bg-accent cursor-grab active:cursor-grabbing z-10"
          style={{ left: `${startFrac * 100}%`, transform: 'translateX(-50%)' }}
          onPointerDown={(e) => { e.preventDefault(); setDragging('start'); }}
        />
        {/* End handle */}
        <div
          className="absolute w-3 h-3 rounded-full bg-accent cursor-grab active:cursor-grabbing z-10"
          style={{ left: `${endFrac * 100}%`, transform: 'translateX(-50%)' }}
          onPointerDown={(e) => { e.preventDefault(); setDragging('end'); }}
        />
        {/* Start label */}
        <div
          className="absolute top-3.5 text-[10px] text-gray-500 whitespace-nowrap pointer-events-none"
          style={{ left: `${startFrac * 100}%`, transform: 'translateX(-50%)' }}
        >
          {formatDate(dateStart ?? minTs, shortSpan)}
        </div>
        {/* End label */}
        <div
          className="absolute top-3.5 text-[10px] text-gray-500 whitespace-nowrap pointer-events-none"
          style={{ left: `${endFrac * 100}%`, transform: 'translateX(-50%)' }}
        >
          {formatDate(dateEnd ?? maxTs, shortSpan)}
        </div>
      </div>
      {isNarrowed && (
        <button
          onClick={() => onChange(undefined, undefined)}
          className="text-[10px] text-gray-500 hover:text-gray-300 shrink-0"
        >
          Reset
        </button>
      )}
    </div>
  );
}
