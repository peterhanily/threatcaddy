import { useState, useRef, useEffect, useMemo } from 'react';
import { Copy, Check, ChevronDown, ChevronRight, X, RotateCcw, Plus, ArrowRight } from 'lucide-react';
import type { IOCEntry, IOCType, ConfidenceLevel, IOCRelationship, IOCRelationshipDef } from '../../types';
import { CONFIDENCE_LEVELS, DEFAULT_IOC_SUBTYPES, DEFAULT_RELATIONSHIP_TYPES, IOC_TYPE_LABELS } from '../../types';
import { AttributionComboInput } from './AttributionComboInput';
import { getEffectiveClsLevels } from '../../lib/classification';
import { cn } from '../../lib/utils';

export interface ThreatIntelConfigProps {
  clsLevels?: string[];
  iocSubtypes?: Record<string, string[]>;
  relationshipTypes?: Record<string, IOCRelationshipDef>;
  iocStatuses?: string[];
}

interface IOCItemProps {
  ioc: IOCEntry;
  onUpdate: (id: string, updates: Partial<IOCEntry>) => void;
  onDismiss: (id: string) => void;
  onRestore: (id: string) => void;
  attributionActors?: string[];
  threatIntelConfig?: ThreatIntelConfigProps;
  allIOCs?: IOCEntry[];
}

function getSubtypesForType(type: IOCType, config?: Record<string, string[]>): string[] {
  const defaults = DEFAULT_IOC_SUBTYPES[type] || [];
  const custom = config?.[type] || [];
  return [...new Set([...defaults, ...custom])];
}

function getRelationshipTypesForSource(sourceType: IOCType, customDefs?: Record<string, IOCRelationshipDef>): Record<string, IOCRelationshipDef> {
  const merged: Record<string, IOCRelationshipDef> = { ...DEFAULT_RELATIONSHIP_TYPES };
  if (customDefs) {
    for (const [k, v] of Object.entries(customDefs)) merged[k] = v;
  }
  const filtered: Record<string, IOCRelationshipDef> = {};
  for (const [k, def] of Object.entries(merged)) {
    if (def.sourceTypes.length === 0 || def.sourceTypes.includes(sourceType)) {
      filtered[k] = def;
    }
  }
  return filtered;
}

function getValidTargetTypes(relType: string, allDefs: Record<string, IOCRelationshipDef>): IOCType[] {
  const def = allDefs[relType];
  if (!def || def.targetTypes.length === 0) return [];
  return def.targetTypes;
}

export function IOCItem({ ioc, onUpdate, onDismiss, onRestore, attributionActors = [], threatIntelConfig, allIOCs = [] }: IOCItemProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [addingRelationship, setAddingRelationship] = useState(false);
  const [newRelType, setNewRelType] = useState('');
  const [newRelTarget, setNewRelTarget] = useState('');
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(ioc.value);
    setCopied(true);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1500);
  };

  // Migrate legacy relatedId/relationshipType to relationships on first render
  useEffect(() => {
    if (ioc.relatedId && ioc.relationshipType && (!ioc.relationships || ioc.relationships.length === 0)) {
      onUpdate(ioc.id, {
        relationships: [{ targetIOCId: ioc.relatedId, relationshipType: ioc.relationshipType }],
        relatedId: undefined,
        relationshipType: undefined,
      });
    }
  }, [ioc.id, ioc.relatedId, ioc.relationshipType, ioc.relationships, onUpdate]);

  const subtypes = useMemo(() => getSubtypesForType(ioc.type, threatIntelConfig?.iocSubtypes), [ioc.type, threatIntelConfig?.iocSubtypes]);

  const availableRelTypes = useMemo(() => getRelationshipTypesForSource(ioc.type, threatIntelConfig?.relationshipTypes), [ioc.type, threatIntelConfig?.relationshipTypes]);

  const relationshipTypes = threatIntelConfig?.relationshipTypes;
  const allRelDefs = useMemo(() => {
    const merged: Record<string, IOCRelationshipDef> = { ...DEFAULT_RELATIONSHIP_TYPES };
    if (relationshipTypes) {
      for (const [k, v] of Object.entries(relationshipTypes)) merged[k] = v;
    }
    return merged;
  }, [relationshipTypes]);

  const validTargets = useMemo(() => {
    if (!newRelType) return allIOCs.filter((o) => o.id !== ioc.id && !o.dismissed);
    const targetTypes = getValidTargetTypes(newRelType, allRelDefs);
    return allIOCs.filter((o) => o.id !== ioc.id && !o.dismissed && (targetTypes.length === 0 || targetTypes.includes(o.type)));
  }, [newRelType, allRelDefs, allIOCs, ioc.id]);

  const relationships = ioc.relationships || [];

  const addRelationship = () => {
    if (!newRelType || !newRelTarget) return;
    const updated: IOCRelationship[] = [...relationships, { targetIOCId: newRelTarget, relationshipType: newRelType }];
    onUpdate(ioc.id, { relationships: updated });
    setNewRelType('');
    setNewRelTarget('');
    setAddingRelationship(false);
  };

  const removeRelationship = (idx: number) => {
    const updated = relationships.filter((_, i) => i !== idx);
    onUpdate(ioc.id, { relationships: updated });
  };

  const confidenceColor = CONFIDENCE_LEVELS[ioc.confidence].color;

  return (
    <div className={cn('border border-gray-800 rounded-lg', ioc.dismissed && 'opacity-50')}>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-gray-500 hover:text-gray-300 shrink-0"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        <span className="font-mono text-xs text-gray-200 truncate flex-1" title={ioc.value}>
          {ioc.value}
        </span>

        <button
          onClick={handleCopy}
          className="text-gray-500 hover:text-gray-300 shrink-0"
          title="Copy value"
          aria-label="Copy IOC value"
        >
          {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
        </button>

        <select
          value={ioc.confidence}
          onChange={(e) => onUpdate(ioc.id, { confidence: e.target.value as ConfidenceLevel })}
          className="bg-gray-800 text-xs rounded px-1 py-0.5 border-0 focus:outline-none cursor-pointer"
          style={{ color: confidenceColor }}
          aria-label="Confidence level"
        >
          {(Object.entries(CONFIDENCE_LEVELS) as [ConfidenceLevel, { label: string }][]).map(([value, { label }]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>

        {ioc.dismissed ? (
          <button
            onClick={() => onRestore(ioc.id)}
            className="text-gray-500 hover:text-green-400 shrink-0"
            title="Restore"
            aria-label="Restore IOC"
          >
            <RotateCcw size={12} />
          </button>
        ) : (
          <button
            onClick={() => onDismiss(ioc.id)}
            className="text-gray-500 hover:text-red-400 shrink-0"
            title="Dismiss"
            aria-label="Dismiss IOC"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {expanded && (
        <div className="px-3 pb-2 space-y-2 border-t border-gray-800 pt-2">
          <div>
            <label className="text-[10px] text-gray-500 uppercase tracking-wider">Analyst Notes</label>
            <textarea
              value={ioc.analystNotes || ''}
              onChange={(e) => onUpdate(ioc.id, { analystNotes: e.target.value })}
              className="w-full bg-gray-800/50 text-xs text-gray-300 rounded p-1.5 mt-0.5 focus:outline-none focus:ring-1 focus:ring-gray-600 resize-none"
              rows={2}
              placeholder="Add notes..."
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-500 uppercase tracking-wider">Attribution</label>
            <AttributionComboInput
              value={ioc.attribution || ''}
              onChange={(v) => onUpdate(ioc.id, { attribution: v })}
              actors={attributionActors}
            />
          </div>
          {subtypes.length > 0 && (
            <div>
              <label className="text-[10px] text-gray-500 uppercase tracking-wider">IOC Subtype</label>
              <select
                value={ioc.iocSubtype || ''}
                onChange={(e) => onUpdate(ioc.id, { iocSubtype: e.target.value || undefined })}
                className="w-full bg-gray-800/50 text-xs text-gray-300 rounded p-1.5 mt-0.5 focus:outline-none focus:ring-1 focus:ring-gray-600"
              >
                <option value="">—</option>
                {subtypes.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          )}
          {threatIntelConfig?.iocStatuses && threatIntelConfig.iocStatuses.length > 0 && (
            <div>
              <label className="text-[10px] text-gray-500 uppercase tracking-wider">IOC Status</label>
              <select
                value={ioc.iocStatus || ''}
                onChange={(e) => onUpdate(ioc.id, { iocStatus: e.target.value || undefined })}
                className="w-full bg-gray-800/50 text-xs text-gray-300 rounded p-1.5 mt-0.5 focus:outline-none focus:ring-1 focus:ring-gray-600"
              >
                <option value="">—</option>
                {threatIntelConfig.iocStatuses.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="text-[10px] text-gray-500 uppercase tracking-wider">Classification Level</label>
            <select
              value={ioc.clsLevel || ''}
              onChange={(e) => onUpdate(ioc.id, { clsLevel: e.target.value || undefined })}
              className="w-full bg-gray-800/50 text-xs text-gray-300 rounded p-1.5 mt-0.5 focus:outline-none focus:ring-1 focus:ring-gray-600"
            >
              <option value="">—</option>
              {getEffectiveClsLevels(threatIntelConfig?.clsLevels).map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          {/* Relationships (many-to-many) */}
          <div>
            <label className="text-[10px] text-gray-500 uppercase tracking-wider">Relationships</label>
            {relationships.length > 0 && (
              <div className="space-y-1 mt-1">
                {relationships.map((rel, idx) => {
                  const target = allIOCs.find((o) => o.id === rel.targetIOCId);
                  const def = allRelDefs[rel.relationshipType];
                  return (
                    <div key={idx} className="flex items-center gap-1 text-xs">
                      <span className="text-accent truncate">{def?.label || rel.relationshipType}</span>
                      <ArrowRight size={10} className="text-gray-600 shrink-0" />
                      <span className="text-gray-300 truncate flex-1" title={target?.value}>
                        {target ? `${IOC_TYPE_LABELS[target.type].label}: ${target.value}` : rel.targetIOCId}
                      </span>
                      <button
                        onClick={() => removeRelationship(idx)}
                        className="text-gray-600 hover:text-red-400 shrink-0"
                        aria-label="Remove relationship"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {addingRelationship ? (
              <div className="mt-1 space-y-1">
                <select
                  value={newRelType}
                  onChange={(e) => { setNewRelType(e.target.value); setNewRelTarget(''); }}
                  className="w-full bg-gray-800/50 text-xs text-gray-300 rounded p-1.5 focus:outline-none focus:ring-1 focus:ring-gray-600"
                >
                  <option value="">Select type...</option>
                  {Object.entries(availableRelTypes).map(([k, d]) => (
                    <option key={k} value={k}>{d.label}</option>
                  ))}
                </select>
                {newRelType && (
                  <select
                    value={newRelTarget}
                    onChange={(e) => setNewRelTarget(e.target.value)}
                    className="w-full bg-gray-800/50 text-xs text-gray-300 rounded p-1.5 focus:outline-none focus:ring-1 focus:ring-gray-600"
                  >
                    <option value="">Select target IOC...</option>
                    {validTargets.map((t) => (
                      <option key={t.id} value={t.id}>{IOC_TYPE_LABELS[t.type].label}: {t.value}</option>
                    ))}
                  </select>
                )}
                <div className="flex gap-1">
                  <button
                    onClick={addRelationship}
                    disabled={!newRelType || !newRelTarget}
                    className="text-xs px-2 py-0.5 rounded bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-40"
                  >
                    Add
                  </button>
                  <button
                    onClick={() => { setAddingRelationship(false); setNewRelType(''); setNewRelTarget(''); }}
                    className="text-xs px-2 py-0.5 rounded text-gray-500 hover:text-gray-300"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAddingRelationship(true)}
                className="flex items-center gap-1 mt-1 text-xs text-gray-500 hover:text-accent"
              >
                <Plus size={10} /> Add Relationship
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
