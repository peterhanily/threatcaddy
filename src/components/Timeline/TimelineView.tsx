import { useState, useMemo, useRef, useEffect, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Search, ArrowUpDown, Star, List, Grid3X3, BarChart3, GanttChart, MapPin, Download, Upload, Trash2, RotateCcw } from 'lucide-react';
import type { TimelineEvent, TimelineEventType, Tag, Folder, Timeline } from '../../types';
import { TimelineFeed } from './TimelineFeed';
import { EventTypeFilterBar } from './EventTypeFilterBar';
import { DateRangeSlider } from './DateRangeSlider';
import { TimelineEventForm } from './TimelineEventForm';
import { MitreHeatmap } from './MitreHeatmap';
import type { HeatmapColorMode } from './MitreHeatmap';
import { MitreReport } from './MitreReport';
import { TimelineGantt } from './TimelineGantt';
const LazyTimelineMap = lazy(() => import('./TimelineMap').then(m => ({ default: m.TimelineMap })));
import { TimelineEventCard } from './TimelineEventCard';
import { Modal } from '../Common/Modal';
import { ConfirmDialog } from '../Common/ConfirmDialog';
import { cn } from '../../lib/utils';
import { getTechniqueLabel, getParentTechniqueId, buildNavigatorLayer, buildMitreCSV } from '../../lib/mitre-attack';
import { downloadFile, exportTimelineJSON, exportEventsJSON } from '../../lib/export';
import { TimelineImportModal } from './TimelineImportModal';
import { useLogActivity } from '../../hooks/ActivityLogContext';
import { useToast } from '../../contexts/ToastContext';

interface TimelineViewProps {
  events: TimelineEvent[];
  allTags: Tag[];
  folders: Folder[];
  onCreateTag: (name: string) => Promise<Tag>;
  onCreateEvent: (data: Partial<TimelineEvent>) => void;
  onUpdateEvent: (id: string, updates: Partial<TimelineEvent>) => void;
  onDeleteEvent: (id: string) => void;
  onTrashEvent?: (id: string) => void;
  onRestoreEvent?: (id: string) => void;
  onToggleArchiveEvent?: (id: string) => void;
  onToggleStar: (id: string) => void;
  getFilteredEvents: (opts: {
    folderId?: string;
    eventTypes?: TimelineEventType[];
    starred?: boolean;
    search?: string;
    sortDir?: 'asc' | 'desc';
    timelineId?: string;
    dateStart?: number;
    dateEnd?: number;
  }) => TimelineEvent[];
  timelines?: Timeline[];
  selectedTimelineId?: string;
  onTimelineReload?: () => void;
  onEventsReload?: () => void;
  scopeLabel?: string;
  selectedFolderId?: string;
  openNewForm?: boolean;
  onNewFormOpened?: () => void;
}

function ExportDropdown({ events, selectedTimelineId, timelines, onImportClick }: { events: TimelineEvent[]; selectedTimelineId?: string; timelines: Timeline[]; onImportClick: () => void }) {
  const { t } = useTranslation('timeline');
  const logActivity = useLogActivity();
  const { addToast } = useToast();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  const handleNavigatorExport = () => {
    const layer = buildNavigatorLayer(events, 'ThreatCaddy Export');
    downloadFile(JSON.stringify(layer, null, 2), 'attack-navigator-layer.json', 'application/json');
    logActivity('timeline', 'export', 'Exported ATT&CK Navigator layer');
    setOpen(false);
  };

  const handleCSVExport = () => {
    const csv = buildMitreCSV(events);
    downloadFile(csv, 'mitre-mappings.csv', 'text/csv');
    logActivity('timeline', 'export', 'Exported MITRE mappings CSV');
    setOpen(false);
  };

  const handleTimelineExport = async () => {
    try {
      if (selectedTimelineId) {
        const json = await exportTimelineJSON(selectedTimelineId);
        const timeline = timelines.find((tl) => tl.id === selectedTimelineId);
        const filename = timeline ? `timeline-${timeline.name.toLowerCase().replace(/\s+/g, '-')}.json` : 'timeline-export.json';
        downloadFile(json, filename, 'application/json');
        logActivity('timeline', 'export', `Exported timeline "${timeline?.name || 'Unknown'}"`, selectedTimelineId, timeline?.name);
      } else {
        const json = exportEventsJSON(events);
        downloadFile(json, 'all-events-export.json', 'application/json');
        logActivity('timeline', 'export', `Exported all events (${events.length})`);
      }
    } catch (err) {
      console.error('Timeline export failed:', err);
      addToast('error', t('export.exportFailed'));
    }
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn('p-1 rounded', open ? 'bg-gray-700 text-gray-200' : 'text-gray-500 hover:text-gray-300')}
        title={t('export.exportImport')}
        aria-label={t('export.exportImport')}
      >
        <Download size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-52 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1">
          <button
            onClick={handleTimelineExport}
            className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 transition-colors"
          >
            {selectedTimelineId ? t('export.exportTimelineJSON') : t('export.exportAllEventsJSON')}
          </button>
          <button
            onClick={() => { setOpen(false); onImportClick(); }}
            className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 transition-colors flex items-center gap-1.5"
          >
            <Upload size={12} />
            {t('export.importTimeline')}
          </button>
          <div className="border-t border-gray-700 my-1" />
          <button
            onClick={handleNavigatorExport}
            className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 transition-colors"
          >
            {t('export.attackNavigatorJSON')}
          </button>
          <button
            onClick={handleCSVExport}
            className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 transition-colors"
          >
            {t('export.mitreMappingsCSV')}
          </button>
        </div>
      )}
    </div>
  );
}

export function TimelineView({
  events,
  allTags,
  folders,
  onCreateTag,
  onCreateEvent,
  onUpdateEvent,
  onDeleteEvent,
  onTrashEvent,
  onRestoreEvent,
  onToggleArchiveEvent,
  onToggleStar,
  getFilteredEvents,
  timelines = [],
  selectedTimelineId,
  onTimelineReload,
  onEventsReload,
  scopeLabel,
  selectedFolderId,
  openNewForm,
  onNewFormOpened,
}: TimelineViewProps) {
  const { t } = useTranslation('timeline');
  const [editingEvent, setEditingEvent] = useState<TimelineEvent | null>(null);
  const [showNewEvent, setShowNewEvent] = useState(false);

  // Open creation form when triggered externally (e.g. from header "+ New" dropdown)
  useEffect(() => {
    if (!openNewForm) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: syncing external prop to local modal state
    setShowNewEvent(true);
    onNewFormOpened?.();
  }, [openNewForm, onNewFormOpened]);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [selectedEventTypes, setSelectedEventTypes] = useState<TimelineEventType[]>([]);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [showStarredOnly, setShowStarredOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'feed' | 'heatmap' | 'report' | 'gantt' | 'map'>('feed');
  const [newEventCoords, setNewEventCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [heatmapColorMode, setHeatmapColorMode] = useState<HeatmapColorMode>('count');
  const [heatmapDetailTechId, setHeatmapDetailTechId] = useState<string | null>(null);
  const [dateStart, setDateStart] = useState<number | undefined>(undefined);
  const [dateEnd, setDateEnd] = useState<number | undefined>(undefined);

  const filteredEvents = useMemo(
    () => getFilteredEvents({
      folderId: selectedFolderId,
      eventTypes: selectedEventTypes.length > 0 ? selectedEventTypes : undefined,
      starred: showStarredOnly || undefined,
      search: searchQuery || undefined,
      sortDir,
      timelineId: selectedTimelineId,
      dateStart,
      dateEnd,
    }),
    [getFilteredEvents, selectedFolderId, selectedEventTypes, showStarredOnly, searchQuery, sortDir, selectedTimelineId, dateStart, dateEnd]
  );

  const heatmapDetailEvents = useMemo(() => {
    if (!heatmapDetailTechId) return [];
    const parentId = getParentTechniqueId(heatmapDetailTechId);
    return filteredEvents.filter((e) =>
      e.mitreAttackIds.some((id) => getParentTechniqueId(id) === parentId)
    );
  }, [filteredEvents, heatmapDetailTechId]);

  const handleTechniqueClick = (techniqueId: string) => {
    setHeatmapDetailTechId(techniqueId);
  };

  const handleSelect = (id: string) => {
    const event = events.find((e) => e.id === id);
    if (event) setEditingEvent(event);
  };

  const handleSaveEdit = (data: Partial<TimelineEvent>) => {
    if (editingEvent) {
      onUpdateEvent(editingEvent.id, data);
      setEditingEvent(null);
    }
  };

  const handleSaveNew = (data: Partial<TimelineEvent>) => {
    onCreateEvent(data);
    setShowNewEvent(false);
  };

  const handleConfirmDelete = () => {
    if (deletingEventId) {
      onDeleteEvent(deletingEventId);
      setDeletingEventId(null);
      if (editingEvent?.id === deletingEventId) setEditingEvent(null);
    }
  };

  const colorModes: { key: HeatmapColorMode; label: string }[] = [
    { key: 'count', label: t('view.colorModeEvents') },
    { key: 'confidence', label: t('view.colorModeConfidence') },
    { key: 'actors', label: t('view.colorModeActors') },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-gray-800 shrink-0">
        <span className="text-sm font-medium text-gray-300 hidden sm:inline">
          {scopeLabel ? t('view.titleWithScope', { scope: scopeLabel, count: events.length }) : t('view.titleWithCount', { count: events.length })}
        </span>
        <span className="text-sm font-medium text-gray-300 sm:hidden">{events.length}</span>

        <div className="flex items-center gap-0.5 ml-2">
          <button
            onClick={() => setViewMode('feed')}
            className={cn('p-1 rounded', viewMode === 'feed' ? 'bg-gray-700 text-gray-200' : 'text-gray-500 hover:text-gray-300')}
            title={t('view.feedView')}
            aria-label={t('view.feedView')}
          >
            <List size={16} />
          </button>
          <button
            onClick={() => setViewMode('heatmap')}
            className={cn('p-1 rounded', viewMode === 'heatmap' ? 'bg-gray-700 text-gray-200' : 'text-gray-500 hover:text-gray-300')}
            title={t('view.attackHeatmap')}
            aria-label={t('view.attackHeatmap')}
          >
            <Grid3X3 size={16} />
          </button>
          <button
            onClick={() => setViewMode('report')}
            className={cn('p-1 rounded', viewMode === 'report' ? 'bg-gray-700 text-gray-200' : 'text-gray-500 hover:text-gray-300')}
            title={t('view.mitreReport')}
            aria-label={t('view.mitreReport')}
          >
            <BarChart3 size={16} />
          </button>
          <button
            onClick={() => setViewMode('gantt')}
            className={cn('p-1 rounded', viewMode === 'gantt' ? 'bg-gray-700 text-gray-200' : 'text-gray-500 hover:text-gray-300')}
            title={t('view.ganttChart')}
            aria-label={t('view.ganttChart')}
          >
            <GanttChart size={16} />
          </button>
          <button
            onClick={() => setViewMode('map')}
            className={cn('p-1 rounded', viewMode === 'map' ? 'bg-gray-700 text-gray-200' : 'text-gray-500 hover:text-gray-300')}
            title={t('view.mapView')}
            aria-label={t('view.mapView')}
          >
            <MapPin size={16} />
          </button>
        </div>

        {/* Color mode pills — heatmap only */}
        {viewMode === 'heatmap' && (
          <div className="flex items-center gap-0.5 ml-2">
            {colorModes.map((m) => (
              <button
                key={m.key}
                onClick={() => setHeatmapColorMode(m.key)}
                className={cn(
                  'px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors',
                  heatmapColorMode === m.key
                    ? 'bg-gray-600 text-gray-200'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-1 ml-2 flex-1 min-w-0 max-w-xs">
          <Search size={14} className="text-gray-500 shrink-0" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('view.searchPlaceholder')}
            className="bg-transparent border-none text-xs text-gray-300 placeholder-gray-600 focus:outline-none w-full min-w-0"
          />
        </div>

        <button
          onClick={() => setSortDir((d) => d === 'asc' ? 'desc' : 'asc')}
          className={cn('p-1 rounded text-gray-500 hover:text-gray-300', sortDir === 'asc' && 'bg-gray-700 text-gray-200')}
          title={sortDir === 'asc' ? t('view.sortOldestFirst') : t('view.sortNewestFirst')}
          aria-label={t('view.toggleSortDirection')}
        >
          <ArrowUpDown size={16} />
        </button>

        <button
          onClick={() => setShowStarredOnly(!showStarredOnly)}
          className={cn('p-1 rounded', showStarredOnly ? 'bg-yellow-400/20 text-yellow-400' : 'text-gray-500 hover:text-gray-300')}
          title={t('view.toggleStarredFilter')}
          aria-label={t('view.filterStarred')}
        >
          <Star size={16} fill={showStarredOnly ? 'currentColor' : 'none'} />
        </button>

        {/* Export / Import dropdown */}
        <ExportDropdown
          events={filteredEvents}
          selectedTimelineId={selectedTimelineId}
          timelines={timelines}
          onImportClick={() => setShowImportModal(true)}
        />

        <button
          onClick={() => setShowNewEvent(true)}
          className="ml-auto flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors"
          aria-label={t('view.newEventAria')}
        >
          <Plus size={14} />
          <span className="hidden sm:inline">{t('view.newEvent')}</span>
        </button>
      </div>

      {/* Event Type Filter Bar */}
      <EventTypeFilterBar
        selectedTypes={selectedEventTypes}
        onChange={setSelectedEventTypes}
      />

      {/* Date Range Slider */}
      <DateRangeSlider
        events={events}
        dateStart={dateStart}
        dateEnd={dateEnd}
        onChange={(start, end) => { setDateStart(start); setDateEnd(end); }}
      />

      {/* Scrollable content area */}
      {viewMode === 'gantt' ? (
        <div className="flex-1 overflow-hidden">
          <TimelineGantt
            events={filteredEvents}
            onSelect={handleSelect}
            onToggleStar={onToggleStar}
          />
        </div>
      ) : viewMode === 'map' ? (
        <div className="flex-1 overflow-hidden">
          <Suspense fallback={<div className="flex-1 flex items-center justify-center text-gray-500 text-sm">{t('view.loadingMap')}</div>}>
            <LazyTimelineMap
              events={filteredEvents}
              onSelect={handleSelect}
              onToggleStar={onToggleStar}
              onDelete={(id) => setDeletingEventId(id)}
              onCreateEventAtLocation={(lat, lng) => {
                setNewEventCoords({ lat, lng });
                setShowNewEvent(true);
              }}
            />
          </Suspense>
        </div>
      ) : (
        <div className={viewMode === 'feed' ? 'flex-1 overflow-hidden p-4' : 'flex-1 overflow-y-auto p-4'}>
          {viewMode === 'feed' ? (
            <TimelineFeed
              events={filteredEvents}
              onSelect={handleSelect}
              onToggleStar={onToggleStar}
              onDelete={(id) => setDeletingEventId(id)}
            />
          ) : viewMode === 'heatmap' ? (
            <MitreHeatmap
              events={filteredEvents}
              colorMode={heatmapColorMode}
              onTechniqueClick={handleTechniqueClick}
            />
          ) : (
            <MitreReport events={filteredEvents} />
          )}
        </div>
      )}

      {/* Edit Event Modal */}
      <Modal open={editingEvent !== null} onClose={() => setEditingEvent(null)} title={t('view.editEvent')} wide>
        {editingEvent && (
          <div>
            <TimelineEventForm
              event={editingEvent}
              folders={folders}
              allTags={allTags}
              onCreateTag={onCreateTag}
              onSave={handleSaveEdit}
              onCancel={() => setEditingEvent(null)}
              onUpdateEvent={onUpdateEvent}
            />
            <div className="mt-3 pt-3 border-t border-gray-700 flex items-center gap-2">
              {editingEvent.trashed && onRestoreEvent && (
                <button
                  type="button"
                  onClick={() => { onRestoreEvent(editingEvent.id); setEditingEvent(null); }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-green-500 hover:text-green-400 hover:bg-gray-800 text-sm transition-colors"
                  title={t('view.restore')}
                >
                  <RotateCcw size={16} />
                </button>
              )}
              {onTrashEvent && !editingEvent.trashed ? (
                <button
                  type="button"
                  onClick={() => { onTrashEvent(editingEvent.id); setEditingEvent(null); }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-red-500 hover:text-red-400 hover:bg-gray-800 text-sm transition-colors"
                  title={t('view.moveToTrash')}
                >
                  <Trash2 size={16} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setDeletingEventId(editingEvent.id)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-red-500 hover:text-red-400 hover:bg-gray-800 text-sm transition-colors"
                  title={t('view.deleteEvent')}
                  aria-label={t('view.deleteEvent')}
                >
                  <Trash2 size={16} />
                </button>
              )}
              {onToggleArchiveEvent && !editingEvent.trashed && (
                <button
                  type="button"
                  onClick={() => { onToggleArchiveEvent(editingEvent.id); setEditingEvent(null); }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-800 text-sm transition-colors"
                  title={editingEvent.archived ? t('view.unarchive') : t('view.archive')}
                >
                  {editingEvent.archived ? t('view.unarchive') : t('view.archive')}
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* New Event Modal */}
      <Modal open={showNewEvent} onClose={() => { setShowNewEvent(false); setNewEventCoords(null); }} title={t('view.createEvent')} wide>
        <TimelineEventForm
          folders={folders}
          allTags={allTags}
          onCreateTag={onCreateTag}
          onSave={(data) => { handleSaveNew(data); setNewEventCoords(null); }}
          onCancel={() => { setShowNewEvent(false); setNewEventCoords(null); }}
          defaultFolderId={selectedFolderId}
          defaultLatitude={newEventCoords?.lat}
          defaultLongitude={newEventCoords?.lng}
        />
      </Modal>

      {/* Heatmap Technique Detail Modal */}
      <Modal
        open={heatmapDetailTechId !== null}
        onClose={() => setHeatmapDetailTechId(null)}
        title={heatmapDetailTechId ? getTechniqueLabel(heatmapDetailTechId) : ''}
        wide
      >
        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          {heatmapDetailEvents.length === 0 ? (
            <p className="text-sm text-gray-500">{t('view.noEventsForTechnique')}</p>
          ) : (
            heatmapDetailEvents.map((ev) => (
              <TimelineEventCard
                key={ev.id}
                event={ev}
                onSelect={(id) => {
                  setHeatmapDetailTechId(null);
                  const event = filteredEvents.find((e) => e.id === id);
                  if (event) setEditingEvent(event);
                }}
                onToggleStar={onToggleStar}
                onDelete={(id) => setDeletingEventId(id)}
              />
            ))
          )}
        </div>
      </Modal>

      {/* Delete Confirm Dialog */}
      <ConfirmDialog
        open={deletingEventId !== null}
        onClose={() => setDeletingEventId(null)}
        onConfirm={handleConfirmDelete}
        title={t('view.deleteEvent')}
        message={t('view.deleteEventMessage')}
        confirmLabel={t('view.deleteEventConfirm')}
        danger
      />

      {/* Timeline Import Modal */}
      <TimelineImportModal
        open={showImportModal}
        onClose={() => setShowImportModal(false)}
        timelines={timelines}
        selectedTimelineId={selectedTimelineId}
        onComplete={() => { onTimelineReload?.(); onEventsReload?.(); }}
      />
    </div>
  );
}
