import { useState, useMemo } from 'react';
import { X, Check, Merge } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { StandaloneIOC, ConfidenceLevel } from '../../types';
import { IOC_TYPE_LABELS, CONFIDENCE_LEVELS } from '../../types';

interface IOCDeduplicatorProps {
  open: boolean;
  onClose: () => void;
  iocs: StandaloneIOC[];
  onUpdate: (id: string, updates: Partial<StandaloneIOC>) => void;
  onDelete: (id: string) => void;
}

interface DuplicateGroup {
  key: string;
  normalizedValue: string;
  type: string;
  iocs: StandaloneIOC[];
}

const CONFIDENCE_ORDER: Record<string, number> = { low: 0, medium: 1, high: 2, confirmed: 3 };

function normalizeValue(value: string, type: string): string {
  let v = value.trim().toLowerCase();
  if (type === 'domain') {
    v = v.replace(/\.+$/, '');
  }
  if (type === 'url') {
    v = v.replace(/^https?:\/\//, '');
    v = v.replace(/\/+$/, '');
  }
  return v;
}

function findDuplicateGroups(iocs: StandaloneIOC[]): DuplicateGroup[] {
  const map = new Map<string, StandaloneIOC[]>();

  for (const ioc of iocs) {
    if (ioc.trashed) continue;
    const normalized = normalizeValue(ioc.value, ioc.type);
    const key = `${ioc.type}:${normalized}`;
    const group = map.get(key) || [];
    group.push(ioc);
    map.set(key, group);
  }

  return Array.from(map.entries())
    .filter(([, group]) => group.length > 1)
    .map(([key, iocs]) => ({
      key,
      normalizedValue: normalizeValue(iocs[0].value, iocs[0].type),
      type: iocs[0].type,
      iocs,
    }))
    .sort((a, b) => b.iocs.length - a.iocs.length);
}

export function IOCDeduplicator({ open, onClose, iocs, onUpdate, onDelete }: IOCDeduplicatorProps) {
  const { t } = useTranslation('analysis');
  const duplicateGroups = useMemo(() => findDuplicateGroups(iocs), [iocs]);
  const [mergedGroups, setMergedGroups] = useState<Set<string>>(new Set());
  const [selectedKeepers, setSelectedKeepers] = useState<Map<string, string>>(new Map());

  const totalDuplicates = duplicateGroups.reduce((sum, g) => sum + g.iocs.length - 1, 0);
  const remainingGroups = duplicateGroups.filter(g => !mergedGroups.has(g.key));

  const selectKeeper = (groupKey: string, iocId: string) => {
    setSelectedKeepers(prev => new Map(prev).set(groupKey, iocId));
  };

  const getKeeperId = (group: DuplicateGroup): string => {
    const explicit = selectedKeepers.get(group.key);
    if (explicit) return explicit;
    // Default: pick highest confidence
    const sorted = [...group.iocs].sort(
      (a, b) => (CONFIDENCE_ORDER[b.confidence] ?? 0) - (CONFIDENCE_ORDER[a.confidence] ?? 0)
    );
    return sorted[0].id;
  };

  const mergeGroup = (group: DuplicateGroup) => {
    const keeperId = getKeeperId(group);
    const keeper = group.iocs.find(i => i.id === keeperId)!;
    const others = group.iocs.filter(i => i.id !== keeperId);

    // Merge tags
    const allTags = new Set(keeper.tags);
    for (const other of others) {
      for (const tag of other.tags) allTags.add(tag);
    }

    // Merge relationships
    const allRelationships = [...(keeper.relationships || [])];
    const relKeys = new Set(allRelationships.map(r => `${r.targetIOCId}:${r.relationshipType}`));
    for (const other of others) {
      for (const rel of other.relationships || []) {
        const key = `${rel.targetIOCId}:${rel.relationshipType}`;
        if (!relKeys.has(key)) {
          allRelationships.push(rel);
          relKeys.add(key);
        }
      }
    }

    // Merge analyst notes
    const allNotes = [keeper.analystNotes, ...others.map(o => o.analystNotes)].filter(Boolean).join('\n---\n');

    // Use highest confidence
    let bestConfidence = keeper.confidence;
    for (const other of others) {
      if ((CONFIDENCE_ORDER[other.confidence] ?? 0) > (CONFIDENCE_ORDER[bestConfidence] ?? 0)) {
        bestConfidence = other.confidence as ConfidenceLevel;
      }
    }

    // Merge linked IDs
    const linkedNoteIds = [...new Set([...(keeper.linkedNoteIds || []), ...others.flatMap(o => o.linkedNoteIds || [])])];
    const linkedTaskIds = [...new Set([...(keeper.linkedTaskIds || []), ...others.flatMap(o => o.linkedTaskIds || [])])];
    const linkedTimelineEventIds = [...new Set([...(keeper.linkedTimelineEventIds || []), ...others.flatMap(o => o.linkedTimelineEventIds || [])])];

    // Update the keeper
    onUpdate(keeperId, {
      tags: [...allTags],
      relationships: allRelationships,
      analystNotes: allNotes || undefined,
      confidence: bestConfidence,
      linkedNoteIds: linkedNoteIds.length > 0 ? linkedNoteIds : undefined,
      linkedTaskIds: linkedTaskIds.length > 0 ? linkedTaskIds : undefined,
      linkedTimelineEventIds: linkedTimelineEventIds.length > 0 ? linkedTimelineEventIds : undefined,
    });

    // Delete duplicates
    for (const other of others) {
      onDelete(other.id);
    }

    setMergedGroups(prev => new Set(prev).add(group.key));
  };

  const mergeAll = () => {
    for (const group of remainingGroups) {
      mergeGroup(group);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-gray-900 rounded-xl shadow-2xl border border-gray-700 w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div>
            <h2 className="text-lg font-semibold text-gray-100">{t('dedup.title')}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {t('dedup.summary', { groups: duplicateGroups.length, groupPlural: duplicateGroups.length !== 1 ? 's' : '', total: totalDuplicates, totalPlural: totalDuplicates !== 1 ? 's' : '' })}
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-gray-200">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          {duplicateGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-600">
              <Check size={36} className="mb-3 text-green-500" />
              <p className="text-lg font-medium text-gray-300">{t('dedup.noDuplicatesTitle')}</p>
              <p className="text-sm mt-1">{t('dedup.noDuplicatesHint')}</p>
            </div>
          ) : (
            <>
              {remainingGroups.length > 0 && (
                <div className="flex justify-end">
                  <button
                    onClick={mergeAll}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/15 text-accent hover:bg-accent/25 text-xs font-medium"
                  >
                    <Merge size={14} />
                    {t('dedup.mergeAll', { count: remainingGroups.length })}
                  </button>
                </div>
              )}

              {duplicateGroups.map(group => {
                const isMerged = mergedGroups.has(group.key);
                const typeInfo = IOC_TYPE_LABELS[group.type as keyof typeof IOC_TYPE_LABELS];
                const keeperId = getKeeperId(group);

                return (
                  <div
                    key={group.key}
                    className={`rounded-lg border ${isMerged ? 'border-green-800/50 bg-green-900/10' : 'border-gray-700'} p-3`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: typeInfo?.color + '22', color: typeInfo?.color }}>
                          {typeInfo?.label || group.type}
                        </span>
                        <span className="text-sm font-mono text-gray-200 truncate max-w-[300px]">
                          {group.normalizedValue}
                        </span>
                        <span className="text-[10px] text-gray-500">
                          {group.iocs.length} copies
                        </span>
                      </div>
                      {isMerged ? (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-900/30 text-green-400 border border-green-800/50">
                          Merged
                        </span>
                      ) : (
                        <button
                          onClick={() => mergeGroup(group)}
                          className="flex items-center gap-1 px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-xs text-gray-300"
                        >
                          <Merge size={12} />
                          Merge
                        </button>
                      )}
                    </div>

                    {!isMerged && (
                      <div className="space-y-1">
                        {group.iocs.map(ioc => {
                          const confInfo = CONFIDENCE_LEVELS[ioc.confidence as ConfidenceLevel] || { label: ioc.confidence, color: '#6b7280' };
                          const isKeeper = ioc.id === keeperId;
                          return (
                            <div
                              key={ioc.id}
                              className={`flex items-center gap-2 px-2 py-1 rounded text-xs ${
                                isKeeper ? 'bg-accent/10 border border-accent/30' : 'bg-gray-800/50'
                              }`}
                            >
                              <button
                                onClick={() => selectKeeper(group.key, ioc.id)}
                                className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                                  isKeeper ? 'border-accent bg-accent' : 'border-gray-600 hover:border-gray-400'
                                }`}
                              >
                                {isKeeper && <Check size={10} className="text-white" />}
                              </button>
                              <span className="font-mono text-gray-300 truncate flex-1">{ioc.value}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: confInfo.color + '22', color: confInfo.color }}>
                                {confInfo.label}
                              </span>
                              {ioc.tags.length > 0 && (
                                <span className="text-[10px] text-gray-500">{ioc.tags.length} tags</span>
                              )}
                              {isKeeper && <span className="text-[10px] text-accent">Keep</span>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>

        <div className="flex justify-end p-4 border-t border-gray-700">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
