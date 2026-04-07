import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../Common/Modal';
import { AttributionComboInput } from '../Analysis/AttributionComboInput';
import { parseIOCNodeId } from '../../lib/graph-data';
import type { GraphNode } from '../../lib/graph-data';
import type { Note, Task, TimelineEvent, IOCEntry, IOCType, ConfidenceLevel, Settings } from '../../types';
import { IOC_TYPE_LABELS, CONFIDENCE_LEVELS, DEFAULT_IOC_SUBTYPES } from '../../types';
import { getEffectiveClsLevels } from '../../lib/classification';

interface GraphIOCEditDialogProps {
  node: GraphNode;
  notes: Note[];
  tasks: Task[];
  timelineEvents: TimelineEvent[];
  settings: Settings;
  onUpdateNote: (id: string, updates: Partial<Note>) => void;
  onUpdateTask: (id: string, updates: Partial<Task>) => void;
  onUpdateEvent?: (id: string, updates: Partial<TimelineEvent>) => void;
  onClose: () => void;
}

interface IOCMatch {
  entityType: 'note' | 'task' | 'timeline-event';
  entityId: string;
  entityTitle: string;
  ioc: IOCEntry;
}

function getSubtypes(type: IOCType, custom?: Record<string, string[]>): string[] {
  const defaults = DEFAULT_IOC_SUBTYPES[type] || [];
  const extra = custom?.[type] || [];
  return [...new Set([...defaults, ...extra])];
}

export function GraphIOCEditDialog({ node, notes, tasks, timelineEvents, settings, onUpdateNote, onUpdateTask, onUpdateEvent, onClose }: GraphIOCEditDialogProps) {
  const { t } = useTranslation('graph');
  const parsed = useMemo(() => parseIOCNodeId(node.id), [node.id]);

  // Find ALL matching IOCEntry instances across notes and tasks
  const matches = useMemo<IOCMatch[]>(() => {
    if (!parsed) return [];
    const results: IOCMatch[] = [];

    for (const note of notes) {
      if (note.trashed || !note.iocAnalysis?.iocs) continue;
      for (const ioc of note.iocAnalysis.iocs) {
        if (ioc.dismissed) continue;
        if (ioc.type === parsed.iocType && ioc.value.toLowerCase() === parsed.normalizedValue) {
          results.push({ entityType: 'note', entityId: note.id, entityTitle: note.title || 'Untitled', ioc });
        }
      }
    }

    for (const task of tasks) {
      if (!task.iocAnalysis?.iocs) continue;
      for (const ioc of task.iocAnalysis.iocs) {
        if (ioc.dismissed) continue;
        if (ioc.type === parsed.iocType && ioc.value.toLowerCase() === parsed.normalizedValue) {
          results.push({ entityType: 'task', entityId: task.id, entityTitle: task.title || 'Untitled', ioc });
        }
      }
    }

    for (const event of timelineEvents) {
      if (!event.iocAnalysis?.iocs) continue;
      for (const ioc of event.iocAnalysis.iocs) {
        if (ioc.dismissed) continue;
        if (ioc.type === parsed.iocType && ioc.value.toLowerCase() === parsed.normalizedValue) {
          results.push({ entityType: 'timeline-event', entityId: event.id, entityTitle: event.title || 'Untitled', ioc });
        }
      }
    }

    return results;
  }, [parsed, notes, tasks, timelineEvents]);

  // Seed form state from the first match
  const first = matches[0]?.ioc;

  const [confidence, setConfidence] = useState<ConfidenceLevel>(first?.confidence ?? 'low');
  const [analystNotes, setAnalystNotes] = useState(first?.analystNotes ?? '');
  const [attribution, setAttribution] = useState(first?.attribution ?? '');
  const [iocSubtype, setIocSubtype] = useState(first?.iocSubtype ?? '');
  const [iocStatus, setIocStatus] = useState(first?.iocStatus ?? '');
  const [clsLevel, setClsLevel] = useState(first?.clsLevel ?? '');

  const subtypes = useMemo(
    () => parsed ? getSubtypes(parsed.iocType, settings.tiIocSubtypes) : [],
    [parsed, settings.tiIocSubtypes],
  );

  const typeInfo = parsed ? IOC_TYPE_LABELS[parsed.iocType] : null;

  const handleSave = () => {
    const updates: Partial<IOCEntry> = {
      confidence,
      analystNotes: analystNotes || undefined,
      attribution: attribution || undefined,
      iocSubtype: iocSubtype || undefined,
      iocStatus: iocStatus || undefined,
      clsLevel: clsLevel || undefined,
    };

    // Group matches by entity to update each entity once
    const noteUpdates = new Map<string, IOCMatch[]>();
    const taskUpdates = new Map<string, IOCMatch[]>();
    const eventUpdates = new Map<string, IOCMatch[]>();
    for (const m of matches) {
      const map = m.entityType === 'note' ? noteUpdates : m.entityType === 'task' ? taskUpdates : eventUpdates;
      if (!map.has(m.entityId)) map.set(m.entityId, []);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      map.get(m.entityId)!.push(m);
    }

    for (const [noteId, noteMatches] of noteUpdates) {
      const note = notes.find((n) => n.id === noteId);
      if (!note?.iocAnalysis) continue;
      const updatedIOCs = note.iocAnalysis.iocs.map((ioc) => {
        const isMatch = noteMatches.some((m) => m.ioc.id === ioc.id);
        if (!isMatch) return ioc;
        return { ...ioc, ...updates };
      });
      onUpdateNote(noteId, { iocAnalysis: { ...note.iocAnalysis, iocs: updatedIOCs } });
    }

    for (const [taskId, taskMatches] of taskUpdates) {
      const task = tasks.find((t) => t.id === taskId);
      if (!task?.iocAnalysis) continue;
      const updatedIOCs = task.iocAnalysis.iocs.map((ioc) => {
        const isMatch = taskMatches.some((m) => m.ioc.id === ioc.id);
        if (!isMatch) return ioc;
        return { ...ioc, ...updates };
      });
      onUpdateTask(taskId, { iocAnalysis: { ...task.iocAnalysis, iocs: updatedIOCs } });
    }

    if (onUpdateEvent) {
      for (const [eventId, eventMatches] of eventUpdates) {
        const event = timelineEvents.find((e) => e.id === eventId);
        if (!event?.iocAnalysis) continue;
        const updatedIOCs = event.iocAnalysis.iocs.map((ioc) => {
          const isMatch = eventMatches.some((m) => m.ioc.id === ioc.id);
          if (!isMatch) return ioc;
          return { ...ioc, ...updates };
        });
        onUpdateEvent(eventId, { iocAnalysis: { ...event.iocAnalysis, iocs: updatedIOCs } });
      }
    }

    onClose();
  };

  if (!parsed || matches.length === 0) {
    return (
      <Modal open onClose={onClose} title={t('editDialog.editIOC')}>
        <p className="text-sm text-gray-400">{t('editDialog.noMatchingIOC')}</p>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title={t('editDialog.editIOCAttributes')}>
      <div className="space-y-4">
        {/* Read-only header */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            {typeInfo && (
              <span
                className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
                style={{ backgroundColor: typeInfo.color + '22', color: typeInfo.color }}
              >
                {typeInfo.label}
              </span>
            )}
            <span className="text-xs text-gray-500">
              {t('editDialog.instancesAcrossEntities', { instances: matches.length, instanceSuffix: matches.length !== 1 ? 's' : '', entities: new Set(matches.map((m) => m.entityId)).size, entitySuffix: new Set(matches.map((m) => m.entityId)).size === 1 ? 'y' : 'ies' })}
            </span>
          </div>
          <div className="font-mono text-sm text-gray-200 break-all bg-gray-800/50 rounded p-2">
            {parsed.normalizedValue}
          </div>
        </div>

        {/* Confidence */}
        <div>
          <label className="text-[10px] text-gray-500 uppercase tracking-wider">{t('editDialog.confidence')}</label>
          <select
            value={confidence}
            onChange={(e) => setConfidence(e.target.value as ConfidenceLevel)}
            className="w-full bg-gray-800/50 text-xs text-gray-300 rounded p-1.5 mt-0.5 focus:outline-none focus:ring-1 focus:ring-gray-600"
          >
            {(Object.entries(CONFIDENCE_LEVELS) as [ConfidenceLevel, { label: string }][]).map(([value, { label }]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        {/* Analyst Notes */}
        <div>
          <label className="text-[10px] text-gray-500 uppercase tracking-wider">{t('editDialog.analystNotes')}</label>
          <textarea
            value={analystNotes}
            onChange={(e) => setAnalystNotes(e.target.value)}
            className="w-full bg-gray-800/50 text-xs text-gray-300 rounded p-1.5 mt-0.5 focus:outline-none focus:ring-1 focus:ring-gray-600 resize-none"
            rows={3}
            placeholder={t('editDialog.addNotes')}
          />
        </div>

        {/* Attribution */}
        <div>
          <label className="text-[10px] text-gray-500 uppercase tracking-wider">{t('editDialog.attribution')}</label>
          <AttributionComboInput
            value={attribution}
            onChange={setAttribution}
            actors={settings.attributionActors ?? []}
          />
        </div>

        {/* IOC Subtype */}
        {subtypes.length > 0 && (
          <div>
            <label className="text-[10px] text-gray-500 uppercase tracking-wider">{t('editDialog.iocSubtype')}</label>
            <select
              value={iocSubtype}
              onChange={(e) => setIocSubtype(e.target.value)}
              className="w-full bg-gray-800/50 text-xs text-gray-300 rounded p-1.5 mt-0.5 focus:outline-none focus:ring-1 focus:ring-gray-600"
            >
              <option value="">—</option>
              {subtypes.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        )}

        {/* IOC Status */}
        {settings.tiIocStatuses && settings.tiIocStatuses.length > 0 && (
          <div>
            <label className="text-[10px] text-gray-500 uppercase tracking-wider">{t('editDialog.iocStatus')}</label>
            <select
              value={iocStatus}
              onChange={(e) => setIocStatus(e.target.value)}
              className="w-full bg-gray-800/50 text-xs text-gray-300 rounded p-1.5 mt-0.5 focus:outline-none focus:ring-1 focus:ring-gray-600"
            >
              <option value="">—</option>
              {settings.tiIocStatuses.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        )}

        {/* Classification Level */}
        <div>
          <label className="text-[10px] text-gray-500 uppercase tracking-wider">{t('editDialog.classificationLevel')}</label>
          <select
            value={clsLevel}
            onChange={(e) => setClsLevel(e.target.value)}
            className="w-full bg-gray-800/50 text-xs text-gray-300 rounded p-1.5 mt-0.5 focus:outline-none focus:ring-1 focus:ring-gray-600"
          >
            <option value="">—</option>
            {getEffectiveClsLevels(settings.tiClsLevels).map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>

        {/* Save / Cancel */}
        <div className="flex justify-end gap-2 pt-2 border-t border-gray-700">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors"
          >
            {t('common:cancel')}
          </button>
          <button
            onClick={handleSave}
            className="px-3 py-1.5 text-xs rounded-lg font-medium bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors"
          >
            {t('editDialog.saveToAllInstances')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
