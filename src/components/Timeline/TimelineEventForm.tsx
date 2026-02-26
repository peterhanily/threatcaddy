import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Shield } from 'lucide-react';
import type { TimelineEvent, TimelineEventType, ConfidenceLevel, Folder, Tag, IOCTarget, IOCAnalysis, IOCType } from '../../types';
import { TIMELINE_EVENT_TYPE_LABELS, CONFIDENCE_LEVELS } from '../../types';
import { TagInput } from '../Common/TagInput';
import { AttributionComboInput } from '../Analysis/AttributionComboInput';
import { IOCPanel } from '../Analysis/IOCPanel';
import { MitreComboInput } from './MitreComboInput';
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

export function TimelineEventForm({ event, folders, allTags, onCreateTag, onSave, onCancel, onUpdateEvent }: TimelineEventFormProps) {
  const { settings } = useSettings();

  const [initialTs] = useState(() => Date.now());
  const [title, setTitle] = useState(event?.title || '');
  const [timestamp, setTimestamp] = useState(toDatetimeLocal(event?.timestamp || initialTs));
  const [timestampEnd, setTimestampEnd] = useState(event?.timestampEnd ? toDatetimeLocal(event.timestampEnd) : '');
  const [eventType, setEventType] = useState<TimelineEventType>(event?.eventType || 'other');
  const [confidence, setConfidence] = useState<ConfidenceLevel>(event?.confidence || 'low');
  const [source, setSource] = useState(event?.source || '');
  const [folderId, setFolderId] = useState(event?.folderId || '');
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

  const isEditMode = !!event;
  const iocCount = event?.iocAnalysis?.iocs.filter((i) => !i.dismissed).length ?? 0;

  // Auto-extract IOCs on description changes (edit mode only)
  useAutoIOCExtraction({
    entityId: event?.id,
    content: description,
    existingAnalysis: event?.iocAnalysis,
    onUpdate: (id, updates) => onUpdateEvent?.(id, updates),
    enabled: isEditMode && !!onUpdateEvent,
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
    }
  }, [event]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const parsedAssets = assets.split(',').map((s) => s.trim()).filter(Boolean);

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
      // Preserve linked arrays on edit, default empty on create
      linkedIOCIds: event?.linkedIOCIds || [],
      linkedNoteIds: event?.linkedNoteIds || [],
      linkedTaskIds: event?.linkedTaskIds || [],
      mitreAttackIds,
    });
  };

  const inputClass = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent';
  const labelClass = 'block text-xs font-medium text-gray-400 mb-1';

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
        <label className={labelClass}>Title</label>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={inputClass}
          placeholder="Event title..."
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Timestamp</label>
          <input
            type="datetime-local"
            value={timestamp}
            onChange={(e) => setTimestamp(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>End Time (optional)</label>
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
          <label className={labelClass}>Event Type</label>
          <select value={eventType} onChange={(e) => setEventType(e.target.value as TimelineEventType)} className={inputClass}>
            {ALL_EVENT_TYPES.map((t) => (
              <option key={t} value={t}>{TIMELINE_EVENT_TYPE_LABELS[t].label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Confidence</label>
          <select value={confidence} onChange={(e) => setConfidence(e.target.value as ConfidenceLevel)} className={inputClass}>
            {ALL_CONFIDENCE.map((c) => (
              <option key={c} value={c}>{CONFIDENCE_LEVELS[c].label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Classification</label>
          <select value={clsLevel} onChange={(e) => setClsLevel(e.target.value)} className={inputClass}>
            <option value="">None</option>
            {getEffectiveClsLevels(settings.tiClsLevels).map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Source</label>
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className={inputClass}
            placeholder="e.g. Firewall logs, EDR..."
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Investigation</label>
          <select value={folderId} onChange={(e) => setFolderId(e.target.value)} className={inputClass}>
            <option value="">No investigation</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className={labelClass}>Actor</label>
        <AttributionComboInput
          value={actor}
          onChange={setActor}
          actors={settings.attributionActors || []}
          placeholder="e.g. APT29, Lazarus Group..."
        />
      </div>

      <div>
        <label className={labelClass}>MITRE ATT&CK Techniques</label>
        <MitreComboInput value={mitreAttackIds} onChange={setMitreAttackIds} />
      </div>

      <div>
        <div className="flex items-center gap-2 mb-1">
          <label className="text-xs font-medium text-gray-400">Description (markdown)</label>
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
              className={cn('p-1 rounded flex items-center gap-1', showIOCPanel ? 'bg-gray-700 text-accent' : 'text-gray-500 hover:text-gray-300')}
              title="IOC Analysis"
              aria-label="Toggle IOC analysis"
            >
              <Shield size={14} />
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
          placeholder="Optional description..."
        />
      </div>

      <div>
        <label className={labelClass}>Assets (comma-separated)</label>
        <input
          value={assets}
          onChange={(e) => setAssets(e.target.value)}
          className={inputClass}
          placeholder="e.g. DC01, WEB-SRV-02, 10.0.0.5..."
        />
      </div>

      <div>
        <label className={labelClass}>Tags</label>
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
          className="rounded border-gray-600 bg-gray-800 text-accent focus:ring-accent"
        />
        <label htmlFor="timeline-starred" className="text-xs text-gray-400">Starred</label>
      </div>

      {/* Raw Data collapsible section */}
      <div>
        <button
          type="button"
          onClick={() => setRawDataOpen(!rawDataOpen)}
          className="flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-gray-300"
        >
          {rawDataOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          Raw Data
        </button>
        {rawDataOpen && (
          <textarea
            value={rawData}
            onChange={(e) => setRawData(e.target.value)}
            className={`${inputClass} h-32 resize-none font-mono text-xs mt-1`}
            placeholder="Paste raw log data, JSON, etc..."
          />
        )}
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors"
        >
          {event ? 'Update Event' : 'Create Event'}
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
