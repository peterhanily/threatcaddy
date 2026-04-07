import { useState, useMemo, useRef, useCallback, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TimelineEvent } from '../../types';
import { currentLocale } from '../../lib/utils';

interface DateRangeSliderProps {
  events: TimelineEvent[];
  dateStart: number | undefined;
  dateEnd: number | undefined;
  onChange: (start: number | undefined, end: number | undefined) => void;
}

function formatLabel(ts: number): string {
  const d = new Date(ts);
  const month = d.toLocaleString(currentLocale(), { month: 'short' });
  const day = d.getDate();
  const hours = d.getHours().toString().padStart(2, '0');
  const mins = d.getMinutes().toString().padStart(2, '0');
  const secs = d.getSeconds().toString().padStart(2, '0');
  return `${month} ${day} ${hours}:${mins}:${secs}`;
}

interface Tick {
  frac: number;
  label: string;
  major: boolean;
}

function computeTicks(minTs: number, maxTs: number): Tick[] {
  const range = maxTs - minTs;
  const ticks: Tick[] = [];

  const DAY = 86_400_000;
  const HOUR = 3_600_000;

  if (range <= 0) return ticks;

  // Choose interval based on span
  let stepMs: number;
  let majorEvery: number;
  let labelFn: (d: Date) => string;
  let majorLabelFn: (d: Date) => string;

  if (range > 365 * DAY) {
    // > 1 year: tick every month, major every 3 months
    return computeMonthTicks(minTs, maxTs, 1, 3);
  } else if (range > 90 * DAY) {
    // 3-12 months: tick every month, major every month
    return computeMonthTicks(minTs, maxTs, 1, 1);
  } else if (range > 14 * DAY) {
    // 2 weeks – 3 months: tick every week, labels on weeks
    stepMs = 7 * DAY;
    majorEvery = 1;
    labelFn = (d) => `${d.toLocaleString(currentLocale(), { month: 'short' })} ${d.getDate()}`;
    majorLabelFn = labelFn;
  } else if (range > 2 * DAY) {
    // 2–14 days: tick every day
    stepMs = DAY;
    majorEvery = 1;
    labelFn = (d) => `${d.toLocaleString(currentLocale(), { month: 'short' })} ${d.getDate()}`;
    majorLabelFn = labelFn;
  } else if (range > 12 * HOUR) {
    // 12h–2d: tick every 4 hours
    stepMs = 4 * HOUR;
    majorEvery = 1;
    labelFn = (d) => `${d.getHours().toString().padStart(2, '0')}:00`;
    majorLabelFn = labelFn;
  } else {
    // < 12h: tick every hour
    stepMs = HOUR;
    majorEvery = 1;
    labelFn = (d) => `${d.getHours().toString().padStart(2, '0')}:00`;
    majorLabelFn = labelFn;
  }

  // Align first tick to step boundary
  const firstAligned = Math.ceil(minTs / stepMs) * stepMs;
  let count = 0;
  for (let ts = firstAligned; ts <= maxTs; ts += stepMs) {
    const frac = (ts - minTs) / range;
    if (frac < 0.02 || frac > 0.98) continue; // skip ticks too close to edges
    const major = count % majorEvery === 0;
    const d = new Date(ts);
    ticks.push({
      frac,
      label: major ? majorLabelFn(d) : labelFn(d),
      major,
    });
    count++;
  }
  return ticks;
}

function computeMonthTicks(minTs: number, maxTs: number, stepMonths: number, majorEvery: number): Tick[] {
  const range = maxTs - minTs;
  const ticks: Tick[] = [];
  const startDate = new Date(minTs);
  // Start at the first of the next month after minTs
  let year = startDate.getFullYear();
  let month = startDate.getMonth() + 1;
  if (month > 11) { month = 0; year++; }

  let count = 0;
  for (let i = 0; i < 200; i++) {
    const ts = new Date(year, month, 1).getTime();
    if (ts > maxTs) break;
    const frac = (ts - minTs) / range;
    if (frac >= 0.02 && frac <= 0.98) {
      const major = count % majorEvery === 0;
      const d = new Date(ts);
      const label = d.getMonth() === 0
        ? `${d.toLocaleString(currentLocale(), { month: 'short' })} '${String(d.getFullYear()).slice(2)}`
        : d.toLocaleString(currentLocale(), { month: 'short' });
      ticks.push({ frac, label, major });
    }
    month += stepMonths;
    if (month > 11) { month -= 12; year++; }
    count++;
  }
  return ticks;
}

export function DateRangeSlider({ events, dateStart, dateEnd, onChange }: DateRangeSliderProps) {
  const { t } = useTranslation('timeline');
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null);
  const [dragStartFrac, setDragStartFrac] = useState<number | null>(null);
  const [dragEndFrac, setDragEndFrac] = useState<number | null>(null);

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

  const propsStartFrac = dateStart !== undefined && range > 0 ? (dateStart - minTs) / range : 0;
  const propsEndFrac = dateEnd !== undefined && range > 0 ? (dateEnd - minTs) / range : 1;

  const startFrac = dragStartFrac ?? propsStartFrac;
  const endFrac = dragEndFrac ?? propsEndFrac;
  const isNarrowed = dateStart !== undefined || dateEnd !== undefined || dragStartFrac !== null || dragEndFrac !== null;

  const ticks = useMemo(() => {
    if (hidden) return [];
    return computeTicks(minTs, maxTs);
  }, [minTs, maxTs, hidden]);

  const getTrackFraction = useCallback((clientX: number) => {
    if (!trackRef.current) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    const frac = (clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(1, frac));
  }, []);

  // Drag via native window listeners with closure-local mutable variables — no stale state
  const beginDrag = useCallback((handle: 'start' | 'end', e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    let sf = propsStartFrac;
    let ef = propsEndFrac;
    setDragging(handle);
    setDragStartFrac(sf);
    setDragEndFrac(ef);

    const onMove = (me: PointerEvent) => {
      const frac = getTrackFraction(me.clientX);
      if (handle === 'start') {
        sf = Math.min(frac, ef);
        setDragStartFrac(sf);
      } else {
        ef = Math.max(frac, sf);
        setDragEndFrac(ef);
      }
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const toTs = (f: number) => minTs + f * range;
      onChange(
        sf <= 0.001 ? undefined : toTs(sf),
        ef >= 0.999 ? undefined : toTs(ef),
      );
      setDragging(null);
      setDragStartFrac(null);
      setDragEndFrac(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [propsStartFrac, propsEndFrac, getTrackFraction, minTs, range, onChange]);

  if (hidden) return null;

  const displayStartTs = minTs + startFrac * range;
  const displayEndTs = minTs + endFrac * range;

  return (
    <div className="px-3 py-1.5 border-b border-gray-800">
      {/* Slider row */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-gray-400 whitespace-nowrap shrink-0 select-none tabular-nums text-right">
          {formatLabel(displayStartTs)}
        </span>
        <div
          ref={trackRef}
          className="relative flex-1 h-5 select-none touch-none cursor-pointer"
          onPointerDown={(e) => {
            const frac = getTrackFraction(e.clientX);
            const pick = Math.abs(frac - startFrac) <= Math.abs(frac - endFrac) ? 'start' : 'end';
            beginDrag(pick, e);
          }}
        >
          {/* Track */}
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-gray-700" />
          {/* Selected fill */}
          <div
            className="absolute top-1/2 -translate-y-1/2 h-1 rounded-full bg-accent/40"
            style={{ left: `${startFrac * 100}%`, right: `${(1 - endFrac) * 100}%` }}
          />
          {/* Tick marks */}
          {ticks.map((tick) => (
            <div
              key={tick.frac}
              className="absolute top-1/2 w-px bg-gray-600"
              style={{
                left: `${tick.frac * 100}%`,
                height: tick.major ? 8 : 6,
                transform: 'translateX(-50%) translateY(-50%)',
              }}
            />
          ))}
          {/* Start handle + tooltip */}
          <div
            className="absolute top-1/2 z-10"
            style={{ left: `${startFrac * 100}%`, transform: 'translateX(-50%) translateY(-50%)' }}
          >
            <div
              className="w-3.5 h-3.5 rounded-full bg-accent border-2 border-gray-900 cursor-grab active:cursor-grabbing hover:scale-125 transition-transform"
              onPointerDown={(e) => { e.stopPropagation(); beginDrag('start', e); }}
            />
            {dragging === 'start' && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-1.5 py-0.5 rounded bg-gray-700 text-[10px] text-gray-200 whitespace-nowrap tabular-nums shadow-lg pointer-events-none">
                {formatLabel(displayStartTs)}
              </div>
            )}
          </div>
          {/* End handle + tooltip */}
          <div
            className="absolute top-1/2 z-10"
            style={{ left: `${endFrac * 100}%`, transform: 'translateX(-50%) translateY(-50%)' }}
          >
            <div
              className="w-3.5 h-3.5 rounded-full bg-accent border-2 border-gray-900 cursor-grab active:cursor-grabbing hover:scale-125 transition-transform"
              onPointerDown={(e) => { e.stopPropagation(); beginDrag('end', e); }}
            />
            {dragging === 'end' && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-1.5 py-0.5 rounded bg-gray-700 text-[10px] text-gray-200 whitespace-nowrap tabular-nums shadow-lg pointer-events-none">
                {formatLabel(displayEndTs)}
              </div>
            )}
          </div>
        </div>
        <span className="text-[10px] text-gray-400 whitespace-nowrap shrink-0 select-none tabular-nums">
          {formatLabel(displayEndTs)}
        </span>
        {isNarrowed && (
          <button
            onClick={() => { setDragStartFrac(null); setDragEndFrac(null); onChange(undefined, undefined); }}
            className="text-[10px] text-accent hover:text-accent-hover shrink-0"
          >
            {t('common:reset')}
          </button>
        )}
      </div>
      {/* Tick labels row */}
      {ticks.length > 0 && (
        <div className="relative ml-[110px] mr-[110px] h-3.5 select-none pointer-events-none">
          {ticks.map((tick) => (
            <span
              key={tick.frac}
              className="absolute text-[9px] text-gray-600 whitespace-nowrap tabular-nums"
              style={{ left: `${tick.frac * 100}%`, transform: 'translateX(-50%)' }}
            >
              {tick.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
