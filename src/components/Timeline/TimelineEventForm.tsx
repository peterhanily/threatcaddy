import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import type { TimelineEvent, TimelineEventType, ConfidenceLevel, Folder, Tag, IOCTarget, IOCAnalysis, IOCType, EntityComment } from '../../types';
import { TIMELINE_EVENT_TYPE_LABELS, CONFIDENCE_LEVELS } from '../../types';
import { TagInput } from '../Common/TagInput';
import { AttributionComboInput } from '../Analysis/AttributionComboInput';
import { IOCPanel } from '../Analysis/IOCPanel';
import { MitreComboInput } from './MitreComboInput';
import { EntityComments } from '../Common/EntityComments';
import { extractIOCs, mergeIOCAnalysis } from '../../lib/ioc-extractor';
import { getEffectiveClsLevels } from '../../lib/classification';
import { useSettings } from '../../hooks/useSettings';
import { useAutoIOCExtraction } from '../../hooks/useAutoIOCExtraction';
import { cn } from '../../lib/utils';

interface TimelineEventFormProps {
  event?: TimelineEvent;
  folders: Folder[];
  allTags: Tag[];
  onCreateTag: (name: string) => Promise<Tag>;
  onSave: (data: Partial<TimelineEvent>) => void;
  onCancel: () => void;
  onUpdateEvent?: (id: string, updates: Partial<TimelineEvent>) => void;
  defaultFolderId?: string;
  defaultLatitude?: number;
  defaultLongitude?: number;
}

function toDatetimeLocal(ms: number): string {
  const d = new Date(ms);
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

function fromDatetimeLocal(str: string): number {
  return new Date(str).getTime();
}

const ALL_EVENT_TYPES = Object.keys(TIMELINE_EVENT_TYPE_LABELS) as TimelineEventType[];
const ALL_CONFIDENCE = Object.keys(CONFIDENCE_LEVELS) as ConfidenceLevel[];

export function TimelineEventForm({ event, folders, allTags, onCreateTag, onSave, onCancel, onUpdateEvent, defaultFolderId, defaultLatitude, defaultLongitude }: TimelineEventFormProps) {
  const { t } = useTranslation('timeline');
  const { settings } = useSettings();

  const [initialTs] = useState(() => Date.now());
  const [title, setTitle] = useState(event?.title || '');
  const [timestamp, setTimestamp] = useState(toDatetimeLocal(event?.timestamp || initialTs));
  const [timestampEnd, setTimestampEnd] = useState(event?.timestampEnd ? toDatetimeLocal(event.timestampEnd) : '');
  const [eventType, setEventType] = useState<TimelineEventType>(event?.eventType || 'other');
  const [confidence, setConfidence] = useState<ConfidenceLevel>(event?.confidence || 'low');
  const [source, setSource] = useState(event?.source || '');
  const [folderId, setFolderId] = useState(event?.folderId || defaultFolderId || '');
  const [actor, setActor] = useState(event?.actor || '');
  const [description, setDescription] = useState(event?.description || '');
  const [assets, setAssets] = useState(event?.assets.join(', ') || '');
  const [tags, setTags] = useState<string[]>(event?.tags || []);
  const [starred, setStarred] = useState(event?.starred || false);
  const [mitreAttackIds, setMitreAttackIds] = useState<string[]>(event?.mitreAttackIds || []);
  const [clsLevel, setClsLevel] = useState(event?.clsLevel || '');
  const [rawData, setRawData] = useState(event?.rawData || '');
  const [rawDataOpen, setRawDataOpen] = useState(false);
  const [showIOCPanel, setShowIOCPanel] = useState(false);
  const [latitude, setLatitude] = useState(event?.latitude?.toString() ?? defaultLatitude?.toString() ?? '');
  const [longitude, setLongitude] = useState(event?.longitude?.toString() ?? defaultLongitude?.toString() ?? '');
  const [locationOpen, setLocationOpen] = useState(!!(event?.latitude != null || defaultLatitude != null));
  const [titleError, setTitleError] = useState('');

  const isEditMode = !!event;
  const iocCount = event?.iocAnalysis?.iocs.filter((i) => !i.dismissed).length ?? 0;
  const eventComments = event?.comments ?? [];

  // Auto-extract IOCs on description changes (edit mode only)
  useAutoIOCExtraction({
    entityId: event?.id,
    content: description,
    existingAnalysis: event?.iocAnalysis,
    onUpdate: (id, updates) => onUpdateEvent?.(id, updates),
    enabled: isEditMode && !!onUpdateEvent && settings.tiAutoExtractEnabled !== false,
    enabledTypes: settings.tiEnabledIOCTypes,
    defaultConfidence: settings.tiDefaultConfidence,
    debounceMs: settings.tiAutoExtractDebounceMs,
  });

  useEffect(() => {
    if (event) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTitle(event.title);
      setTimestamp(toDatetimeLocal(event.timestamp));
      setTimestampEnd(event.timestampEnd ? toDatetimeLocal(event.timestampEnd) : '');
      setEventType(event.eventType);
      setConfidence(event.confidence);
      setSource(event.source);
      setFolderId(event.folderId || '');
      setActor(event.actor || '');
      setMitreAttackIds(event.mitreAttackIds || []);
      setDescription(event.description || '');
      setAssets(event.assets.join(', '));
      setTags(event.tags);
      setStarred(event.starred);
      setClsLevel(event.clsLevel || '');
      setRawData(event.rawData || '');
      setLatitude(event.latitude?.toString() ?? '');
      setLongitude(event.longitude?.toString() ?? '');
      setLocationOpen(event.latitude != null);
    }
  }, [event]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setTitleError(t('eventForm.titleRequired'));
      return;
    }
    setTitleError('');

    const parsedAssets = assets.split(',').map((s) => s.trim()).filter(Boolean);
    const parsedLat = latitude ? parseFloat(latitude) : undefined;
    const parsedLng = longitude ? parseFloat(longitude) : undefined;

    onSave({
      title: title.trim(),
      timestamp: fromDatetimeLocal(timestamp),
      timestampEnd: timestampEnd ? fromDatetimeLocal(timestampEnd) : undefined,
      eventType,
      confidence,
      source: source.trim(),
      folderId: folderId || undefined,
      actor: actor.trim() || undefined,
      description: description.trim() || undefined,
      assets: parsedAssets,
      tags,
      starred,
      clsLevel: clsLevel || undefined,
      rawData: rawData.trim() || undefined,
      latitude: parsedLat != null && isFinite(parsedLat) && parsedLat >= -90 && parsedLat <= 90 ? parsedLat : undefined,
      longitude: parsedLng != null && isFinite(parsedLng) && parsedLng >= -180 && parsedLng <= 180 ? parsedLng : undefined,
      // Preserve linked arrays on edit, default empty on create
      linkedIOCIds: event?.linkedIOCIds || [],
      linkedNoteIds: event?.linkedNoteIds || [],
      linkedTaskIds: event?.linkedTaskIds || [],
      mitreAttackIds,
    });
  };

  const inputClass = 'w-full bg-bg-deep border border-border-medium rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent';
  const labelClass = 'block text-xs font-medium text-text-muted mb-1';

  const iocTarget: IOCTarget | null = event ? {
    id: event.id,
    title,
    content: description,
    clsLevel: event.clsLevel,
    iocAnalysis: event.iocAnalysis,
    iocTypes: event.iocTypes,
  } : null;

  const handleIOCUpdate = (id: string, updates: { iocAnalysis?: IOCAnalysis; iocTypes?: IOCType[] }) => {
    if (onUpdateEvent) onUpdateEvent(id, updates);
  };

  return (
    <div className="flex gap-0">
    <form onSubmit={handleSubmit} className="space-y-4 flex-1 min-w-0">
      <div>
        <label className={labelClass} htmlFor="event-title">{t('eventForm.title')}</label>
        <input
          id="event-title"
          type="text"
          autoFocus
          maxLength={500}
          value={title}
          onChange={(e) => { setTitle(e.target.value); if (titleError) setTitleError(''); }}
          className={cn(inputClass, titleError && 'border-red-500')}
          placeholder={t('eventForm.titlePlaceholder')}
          aria-required="true"
          aria-invalid={!!titleError}
          aria-describedby={titleError ? 'event-title-error' : undefined}
        />
        {titleError && (
          <p id="event-title-error" className="text-xs text-red-400 mt-1">{titleError}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>{t('eventForm.timestamp')}</label>
          <input
            type="datetime-local"
            value={timestamp}
            onChange={(e) => setTimestamp(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>{t('eventForm.endTime')}</label>
          <input
            type="datetime-local"
            value={timestampEnd}
            onChange={(e) => setTimestampEnd(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>{t('eventForm.eventType')}</label>
          <select value={eventType} onChange={(e) => setEventType(e.target.value as TimelineEventType)} className={inputClass}>
            {ALL_EVENT_TYPES.map((et) => (
              <option key={et} value={et}>{TIMELINE_EVENT_TYPE_LABELS[et].label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>{t('eventForm.confidence')}</label>
          <select value={confidence} onChange={(e) => setConfidence(e.target.value as ConfidenceLevel)} className={inputClass}>
            {ALL_CONFIDENCE.map((c) => (
              <option key={c} value={c}>{CONFIDENCE_LEVELS[c].label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>{t('eventForm.classification')}</label>
          <select value={clsLevel} onChange={(e) => setClsLevel(e.target.value)} className={inputClass}>
            <option value="">{t('common:none')}</option>
            {getEffectiveClsLevels(settings.tiClsLevels).map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>{t('eventForm.source')}</label>
          <input
            type="text"
            maxLength={500}
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className={inputClass}
            placeholder={t('eventForm.sourcePlaceholder')}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>{t('eventForm.investigation')}</label>
          <select value={folderId} onChange={(e) => setFolderId(e.target.value)} className={inputClass}>
            <option value="">{t('eventForm.noInvestigation')}</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className={labelClass}>{t('eventForm.actor')}</label>
        <AttributionComboInput
          value={actor}
          onChange={setActor}
          actors={settings.attributionActors || []}
          placeholder={t('eventForm.actorPlaceholder')}
        />
      </div>

      <div>
        <label className={labelClass}>{t('eventForm.mitreAttackTechniques')}</label>
        <MitreComboInput value={mitreAttackIds} onChange={setMitreAttackIds} />
      </div>

      <div>
        <div className="flex items-center gap-2 mb-1">
          <label className="text-xs font-medium text-text-muted">{t('eventForm.descriptionMarkdown')}</label>
          {isEditMode && onUpdateEvent && (
            <button
              type="button"
              onClick={() => {
                if (!showIOCPanel) {
                  const fresh = extractIOCs(description);
                  const merged = mergeIOCAnalysis(event.iocAnalysis, fresh);
                  const iocTypes = [...new Set(merged.iocs.filter((i) => !i.dismissed).map((i) => i.type))];
                  onUpdateEvent(event.id, { iocAnalysis: merged, iocTypes });
                }
                setShowIOCPanel(!showIOCPanel);
              }}
              className={cn('p-1 rounded flex items-center gap-1', showIOCPanel ? 'bg-bg-active text-accent' : 'text-text-muted hover:text-text-secondary')}
              title={t('eventForm.iocAnalysis')}
              aria-label={t('eventForm.toggleIocAnalysis')}
            >
              <Search size={14} />
              {iocCount > 0 && (
                <span className="text-[10px] bg-accent/20 text-accent px-1 rounded-full">{iocCount}</span>
              )}
            </button>
          )}
        </div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={`${inputClass} h-24 resize-none note-editor`}
          placeholder={t('eventForm.descriptionPlaceholder')}
        />
      </div>

      <div>
        <label className={labelClass}>{t('eventForm.assets')}</label>
        <input
          type="text"
          maxLength={500}
          value={assets}
          onChange={(e) => setAssets(e.target.value)}
          className={inputClass}
          placeholder={t('eventForm.assetsPlaceholder')}
        />
      </div>

      <div>
        <label className={labelClass}>{t('eventForm.tags')}</label>
        <TagInput
          selectedTags={tags}
          allTags={allTags}
          onChange={setTags}
          onCreateTag={onCreateTag}
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="timeline-starred"
          checked={starred}
          onChange={(e) => setStarred(e.target.checked)}
          className="rounded border-border-medium bg-bg-deep text-accent focus:ring-accent"
        />
        <label htmlFor="timeline-starred" className="text-xs text-text-muted">{t('eventForm.starred')}</label>
      </div>

      {/* Location collapsible section */}
      <div>
        <button
          type="button"
          onClick={() => setLocationOpen(!locationOpen)}
          className="flex items-center gap-1 text-xs font-medium text-text-muted hover:text-text-secondary"
        >
          {locationOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {t('eventForm.location')}
        </button>
        {locationOpen && (
          <div className="grid grid-cols-2 gap-3 mt-1">
            <div>
              <label className={labelClass}>{t('eventForm.latitude')}</label>
              <input
                type="number"
                step="any"
                min={-90}
                max={90}
                value={latitude}
                onChange={(e) => setLatitude(e.target.value)}
                className={inputClass}
                placeholder={t('eventForm.latitudePlaceholder')}
              />
            </div>
            <div>
              <label className={labelClass}>{t('eventForm.longitude')}</label>
              <input
                type="number"
                step="any"
                min={-180}
                max={180}
                value={longitude}
                onChange={(e) => setLongitude(e.target.value)}
                className={inputClass}
                placeholder={t('eventForm.longitudePlaceholder')}
              />
            </div>
          </div>
        )}
      </div>

      {/* Raw Data collapsible section */}
      <div>
        <button
          type="button"
          onClick={() => setRawDataOpen(!rawDataOpen)}
          className="flex items-center gap-1 text-xs font-medium text-text-muted hover:text-text-secondary"
        >
          {rawDataOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {t('eventForm.rawData')}
        </button>
        {rawDataOpen && (
          <textarea
            value={rawData}
            onChange={(e) => setRawData(e.target.value)}
            className={`${inputClass} h-32 resize-none font-mono text-xs mt-1`}
            placeholder={t('eventForm.rawDataPlaceholder')}
          />
        )}
      </div>

      {/* Comments section (edit mode only) */}
      {isEditMode && event && onUpdateEvent && (
        <EntityComments
          comments={eventComments}
          onUpdate={(updated: EntityComment[]) => onUpdateEvent(event.id, { comments: updated })}
        />
      )}

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg bg-bg-active hover:bg-bg-hover text-text-primary text-sm transition-colors"
        >
          {t('common:cancel')}
        </button>
        <button
          type="submit"
          className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors"
        >
          {event ? t('eventForm.updateEvent') : t('eventForm.createEvent')}
        </button>
      </div>
    </form>

    {/* IOC Panel side panel */}
    {showIOCPanel && iocTarget && (
      <IOCPanel
        item={iocTarget}
        onUpdate={handleIOCUpdate}
        onClose={() => setShowIOCPanel(false)}
        attributionActors={settings.attributionActors}
        threatIntelConfig={{
          clsLevels: settings.tiClsLevels,
          iocSubtypes: settings.tiIocSubtypes,
          relationshipTypes: settings.tiRelationshipTypes,
          iocStatuses: settings.tiIocStatuses,
        }}
        tiExportConfig={{
          defaultClsLevel: settings.tiDefaultClsLevel,
          defaultReportSource: settings.tiDefaultReportSource,
        }}
      />
    )}
    </div>
  );
}
