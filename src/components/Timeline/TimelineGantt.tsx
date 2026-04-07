import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ZoomIn, ZoomOut, Maximize2, Layers } from 'lucide-react';
import type { TimelineEvent, TimelineEventType } from '../../types';
import { TIMELINE_EVENT_TYPE_LABELS } from '../../types';
import { cn, currentLocale } from '../../lib/utils';

interface TimelineGanttProps {
  events: TimelineEvent[];
  onSelect: (id: string) => void;
  onToggleStar: (id: string) => void;
}

const ROW_HEIGHT = 32;
const ROW_GAP = 2;
const ROW_TOTAL = ROW_HEIGHT + ROW_GAP;
const LABEL_WIDTH = 220;
const HEADER_HEIGHT = 36;
const POINT_WIDTH = 10;
const MIN_BAR_WIDTH = 6;
const PADDING_FRACTION = 0.05;

function getEventMeta(eventType: TimelineEventType): { label: string; color: string } {
  return TIMELINE_EVENT_TYPE_LABELS[eventType] ?? { label: String(eventType), color: '#6b7280' };
}

interface TooltipData {
  event: TimelineEvent;
  x: number;
  y: number;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString(currentLocale(), {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function formatTickLabel(ts: number, spanMs: number): string {
  const d = new Date(ts);
  if (spanMs < 2 * 86400000) {
    return d.toLocaleString(currentLocale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  if (spanMs < 7 * 86400000) {
    return d.toLocaleString(currentLocale(), { month: 'short', day: 'numeric', hour: '2-digit' });
  }
  if (spanMs < 30 * 86400000) {
    return d.toLocaleString(currentLocale(), { month: 'short', day: 'numeric' });
  }
  return d.toLocaleString(currentLocale(), { month: 'short', day: 'numeric', year: '2-digit' });
}

function computeTickInterval(spanMs: number): number {
  if (spanMs < 2 * 3600000) return 15 * 60000;          // 15 min
  if (spanMs < 12 * 3600000) return 3600000;             // 1 hour
  if (spanMs < 2 * 86400000) return 6 * 3600000;         // 6 hours
  if (spanMs < 7 * 86400000) return 86400000;             // 1 day
  if (spanMs < 30 * 86400000) return 7 * 86400000;        // 1 week
  if (spanMs < 180 * 86400000) return 30 * 86400000;      // ~1 month
  return 90 * 86400000;                                    // ~3 months
}

export function TimelineGantt({ events, onSelect, onToggleStar: _onToggleStar }: TimelineGanttProps) {
  void _onToggleStar;
  const { t } = useTranslation('timeline');
  const chartRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [groupByType, setGroupByType] = useState(false);

  // Sort events by timestamp ascending
  const sortedEvents = useMemo(() => {
    const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
    if (!groupByType) return sorted;
    // Group by event type, keeping timestamp order within each group
    const groups = new Map<string, TimelineEvent[]>();
    for (const ev of sorted) {
      const g = groups.get(ev.eventType) || [];
      g.push(ev);
      groups.set(ev.eventType, g);
    }
    return Array.from(groups.values()).flat();
  }, [events, groupByType]);

  // Compute group headers for grouped mode
  const groupHeaders = useMemo(() => {
    if (!groupByType) return [];
    const headers: { type: string; label: string; color: string; startRow: number; count: number }[] = [];
    let currentType = '';
    let startRow = 0;
    for (let i = 0; i < sortedEvents.length; i++) {
      if (sortedEvents[i].eventType !== currentType) {
        if (currentType && headers.length > 0) {
          headers[headers.length - 1].count = i - startRow;
        }
        currentType = sortedEvents[i].eventType;
        startRow = i;
        const meta = getEventMeta(sortedEvents[i].eventType);
        headers.push({ type: currentType, label: meta.label, color: meta.color, startRow: i, count: 0 });
      }
    }
    if (headers.length > 0) {
      headers[headers.length - 1].count = sortedEvents.length - headers[headers.length - 1].startRow;
    }
    return headers;
  }, [sortedEvents, groupByType]);

  // Stable fallback for empty chart (captured once at mount)
  const [emptyFallbackTime] = useState(() => Date.now());

  // Time range
  const { minTime, maxTime, span } = useMemo(() => {
    if (sortedEvents.length === 0) {
      return { minTime: emptyFallbackTime, maxTime: emptyFallbackTime + 86400000, span: 86400000 };
    }
    let min = Infinity;
    let max = -Infinity;
    for (const ev of sortedEvents) {
      if (ev.timestamp < min) min = ev.timestamp;
      const end = ev.timestampEnd || ev.timestamp;
      if (end > max) max = end;
      if (ev.timestamp > max) max = ev.timestamp;
    }
    // Ensure minimum span of 1 hour
    if (max - min < 3600000) {
      const mid = (min + max) / 2;
      min = mid - 1800000;
      max = mid + 1800000;
    }
    const rawSpan = max - min;
    const padding = rawSpan * PADDING_FRACTION;
    return { minTime: min - padding, maxTime: max + padding, span: rawSpan + padding * 2 };
  }, [sortedEvents, emptyFallbackTime]);

  // Zoom: pixels per millisecond. Default computed to fit container.
  const [containerWidth, setContainerWidth] = useState(800);
  const defaultPxPerMs = useMemo(() => containerWidth / span, [containerWidth, span]);
  const [zoomLevel, setZoomLevel] = useState<number | null>(null);
  const pxPerMs = zoomLevel ?? defaultPxPerMs;

  // Reset zoom when events change
  useEffect(() => { setZoomLevel(null); }, [events]); // eslint-disable-line react-hooks/set-state-in-effect

  // Track container width
  useEffect(() => {
    const el = chartRef.current?.parentElement;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const chartWidth = Math.max(containerWidth, span * pxPerMs);
  const chartHeight = sortedEvents.length * ROW_TOTAL;

  const toX = useCallback((ts: number) => (ts - minTime) * pxPerMs, [minTime, pxPerMs]);

  // Zoom handlers
  const handleZoomIn = () => setZoomLevel((pxPerMs) * 1.5);
  const handleZoomOut = () => setZoomLevel(Math.max(defaultPxPerMs * 0.1, (pxPerMs) * 0.67));
  const handleFitAll = () => setZoomLevel(null);

  // Mouse wheel zoom on chart area
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    setZoomLevel(Math.max(defaultPxPerMs * 0.1, pxPerMs * factor));
  }, [pxPerMs, defaultPxPerMs]);

  // Sync vertical scroll between labels and chart
  const handleChartScroll = useCallback(() => {
    if (chartRef.current && labelRef.current) {
      labelRef.current.scrollTop = chartRef.current.scrollTop;
    }
  }, []);

  // Ticks
  const ticks = useMemo(() => {
    const interval = computeTickInterval(span);
    const firstTick = Math.ceil(minTime / interval) * interval;
    const result: number[] = [];
    for (let t = firstTick; t <= maxTime; t += interval) {
      result.push(t);
    }
    return result;
  }, [minTime, maxTime, span]);

  const handleBarHover = useCallback((ev: TimelineEvent, e: React.MouseEvent) => {
    setTooltip({ event: ev, x: e.clientX, y: e.clientY });
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-gray-800 shrink-0">
        <button onClick={handleZoomIn} className="p-1 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800" title={t('gantt.zoomIn')}>
          <ZoomIn size={14} />
        </button>
        <button onClick={handleZoomOut} className="p-1 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800" title={t('gantt.zoomOut')}>
          <ZoomOut size={14} />
        </button>
        <button onClick={handleFitAll} className="p-1 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800" title={t('gantt.fitAll')}>
          <Maximize2 size={14} />
        </button>
        <div className="w-px h-4 bg-gray-700 mx-1" />
        <button
          onClick={() => setGroupByType(!groupByType)}
          className={cn('flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors',
            groupByType ? 'bg-gray-600 text-gray-200' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
          )}
          title={t('gantt.groupByEventType')}
        >
          <Layers size={10} />
          {t('gantt.group')}
        </button>
        <span className="ml-auto text-[10px] text-gray-600">{t('gantt.eventCount', { count: sortedEvents.length })}</span>
      </div>

      {/* Chart area */}
      <div className="flex flex-1 min-h-0 overflow-hidden" data-gantt-chart>
        {/* Label column */}
        <div
          ref={labelRef}
          className="shrink-0 overflow-hidden border-r border-gray-800"
          style={{ width: LABEL_WIDTH }}
        >
          {/* Sticky header */}
          <div className="sticky top-0 z-10 bg-gray-900 border-b border-gray-700" style={{ height: HEADER_HEIGHT }}>
            <div className="px-2 py-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">{t('gantt.eventLabel')}</div>
          </div>
          {/* Row labels */}
            <div style={{ height: chartHeight }}>
              {sortedEvents.map((ev, i) => {
                const meta = getEventMeta(ev.eventType);
                const showGroupHeader = groupByType && groupHeaders.some(h => h.startRow === i);
                const header = groupByType ? groupHeaders.find(h => h.startRow === i) : null;
                return (
                  <div key={ev.id}>
                    {showGroupHeader && header && (
                      <div
                        className="flex items-center gap-1.5 px-2"
                        style={{ height: 0 }}
                      >
                        {/* Group header is shown via a visual indicator on the bar side */}
                      </div>
                    )}
                    <div
                      className={cn(
                        'flex items-center gap-1.5 px-2 cursor-pointer hover:bg-gray-800/50 transition-colors',
                        i % 2 === 0 ? 'bg-gray-900/30' : ''
                      )}
                      style={{ height: ROW_HEIGHT, marginBottom: ROW_GAP }}
                      onClick={() => onSelect(ev.id)}
                    >
                      <span
                        className="shrink-0 w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: meta.color }}
                      />
                      <span className="text-[11px] text-gray-300 truncate flex-1" title={ev.title}>
                        {ev.title}
                      </span>
                      <span
                        className="shrink-0 text-[9px] px-1 py-0.5 rounded font-medium"
                        style={{ color: meta.color, backgroundColor: meta.color + '18' }}
                      >
                        {meta.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
        </div>

        {/* Scrollable chart */}
        <div
          ref={chartRef}
          className="flex-1 overflow-auto"
          onScroll={handleChartScroll}
          onWheel={handleWheel}
        >
          {/* Time axis header */}
          <div className="sticky top-0 z-10 border-b border-gray-700 bg-gray-900" style={{ height: HEADER_HEIGHT, width: chartWidth }}>
            {ticks.map((tick) => (
              <div
                key={tick}
                className="absolute top-0 text-[10px] text-gray-500 whitespace-nowrap"
                style={{ left: toX(tick), height: HEADER_HEIGHT, borderLeft: '1px solid rgba(75,85,99,0.4)', paddingLeft: 4, paddingTop: 4 }}
              >
                {formatTickLabel(tick, span)}
              </div>
            ))}
          </div>

          {/* Rows */}
          <div className="relative" style={{ width: chartWidth, height: chartHeight }}>
            {/* Grid lines */}
            {ticks.map((tick) => (
              <div
                key={tick}
                className="absolute top-0 bottom-0"
                style={{ left: toX(tick), width: 1, backgroundColor: 'rgba(75,85,99,0.15)' }}
              />
            ))}

            {/* Row stripes */}
            {sortedEvents.map((_, i) => (
              <div
                key={i}
                className={i % 2 === 0 ? 'bg-gray-900/30' : ''}
                style={{ position: 'absolute', top: i * ROW_TOTAL, left: 0, right: 0, height: ROW_HEIGHT }}
              />
            ))}

            {/* Group headers (in chart area) */}
            {groupByType && groupHeaders.map((header) => (
              <div
                key={header.type}
                className="absolute left-0 right-0 pointer-events-none"
                style={{ top: header.startRow * ROW_TOTAL - 1 }}
              >
                <div className="border-t border-gray-700/60" style={{ marginLeft: -4 }} />
              </div>
            ))}

            {/* Event bars */}
            {sortedEvents.map((ev, i) => {
              const meta = getEventMeta(ev.eventType);
              const isPoint = !ev.timestampEnd;
              const top = i * ROW_TOTAL + (ROW_HEIGHT - (isPoint ? POINT_WIDTH : 20)) / 2;

              if (isPoint) {
                // Point event: diamond marker
                const cx = toX(ev.timestamp);
                return (
                  <div
                    key={ev.id}
                    className="absolute cursor-pointer hover:scale-125 transition-transform"
                    style={{
                      left: cx - POINT_WIDTH / 2,
                      top,
                      width: POINT_WIDTH,
                      height: POINT_WIDTH,
                      backgroundColor: meta.color,
                      transform: 'rotate(45deg)',
                      borderRadius: 2,
                    }}
                    onClick={() => onSelect(ev.id)}
                    onMouseMove={(e) => handleBarHover(ev, e)}
                    onMouseLeave={() => setTooltip(null)}
                    title={ev.title}
                  />
                );
              }

              // Duration bar
              const x1 = toX(ev.timestamp);
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              const x2 = toX(ev.timestampEnd!);
              const barWidth = Math.max(MIN_BAR_WIDTH, x2 - x1);

              return (
                <div
                  key={ev.id}
                  className="absolute rounded-sm cursor-pointer hover:brightness-125 transition-all"
                  style={{
                    left: x1,
                    top,
                    width: barWidth,
                    height: 20,
                    backgroundColor: meta.color + 'CC',
                    border: `1px solid ${meta.color}`,
                  }}
                  onClick={() => onSelect(ev.id)}
                  onMouseMove={(e) => handleBarHover(ev, e)}
                  onMouseLeave={() => setTooltip(null)}
                >
                  {barWidth > 60 && (
                    <span className="absolute inset-0 flex items-center px-1.5 text-[10px] text-white truncate font-medium pointer-events-none" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
                      {ev.title}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

        </div>
      </div>

      {/* Tooltip (portal-style, fixed position) */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none bg-gray-800 border border-gray-700 rounded-lg shadow-xl px-3 py-2 text-xs max-w-xs"
          style={{ left: tooltip.x + 12, top: tooltip.y - 8, transform: 'translateY(-100%)' }}
        >
          <div className="font-medium text-gray-200 mb-1 truncate">{tooltip.event.title}</div>
          <div className="text-gray-400 space-y-0.5">
            <div>{formatTime(tooltip.event.timestamp)}{tooltip.event.timestampEnd ? ` → ${formatTime(tooltip.event.timestampEnd)}` : ` ${t('gantt.pointEvent')}`}</div>
            <div className="flex items-center gap-1.5">
              <span
                className="px-1 py-0.5 rounded text-[9px] font-medium"
                style={{
                  color: getEventMeta(tooltip.event.eventType).color,
                  backgroundColor: getEventMeta(tooltip.event.eventType).color + '20',
                }}
              >
                {getEventMeta(tooltip.event.eventType).label}
              </span>
            </div>
            {tooltip.event.source && <div>{t('gantt.tooltipSource', { source: tooltip.event.source })}</div>}
            {tooltip.event.actor && <div>{t('gantt.tooltipActor', { actor: tooltip.event.actor })}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
