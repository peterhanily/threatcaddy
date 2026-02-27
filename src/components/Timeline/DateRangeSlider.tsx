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
      <span className="text-[10px] text-gray-500 whitespace-nowrap shrink-0 select-none tabular-nums">
        {formatDate(dateStart ?? minTs, shortSpan)}
      </span>
      <div
        ref={trackRef}
        className="relative flex-1 h-4 select-none touch-none cursor-pointer"
        onPointerDown={(e) => {
          const frac = getTrackFraction(e.clientX);
          // Pick the closer handle
          const pick = Math.abs(frac - startFrac) <= Math.abs(frac - endFrac) ? 'start' : 'end';
          e.preventDefault();
          setDragging(pick);
        }}
      >
        {/* Track */}
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-gray-700" />
        {/* Selected fill */}
        <div
          className="absolute top-1/2 -translate-y-1/2 h-1 rounded-full bg-accent/40"
          style={{ left: `${startFrac * 100}%`, right: `${(1 - endFrac) * 100}%` }}
        />
        {/* Start handle */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-accent border-2 border-gray-900 cursor-grab active:cursor-grabbing z-10 hover:scale-125 transition-transform"
          style={{ left: `${startFrac * 100}%`, transform: `translateX(-50%) translateY(-50%)` }}
          onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setDragging('start'); }}
        />
        {/* End handle */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-accent border-2 border-gray-900 cursor-grab active:cursor-grabbing z-10 hover:scale-125 transition-transform"
          style={{ left: `${endFrac * 100}%`, transform: `translateX(-50%) translateY(-50%)` }}
          onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setDragging('end'); }}
        />
      </div>
      <span className="text-[10px] text-gray-500 whitespace-nowrap shrink-0 select-none tabular-nums">
        {formatDate(dateEnd ?? maxTs, shortSpan)}
      </span>
      {isNarrowed && (
        <button
          onClick={() => onChange(undefined, undefined)}
          className="text-[10px] text-accent hover:text-accent-hover shrink-0 ml-0.5"
        >
          Reset
        </button>
      )}
    </div>
  );
}
