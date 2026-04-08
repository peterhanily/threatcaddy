import { useState, useEffect, useCallback } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { StandaloneIOC, IOCType, ConfidenceLevel, Folder, Tag, IOCRelationship, InvestigationMember, EntityComment } from '../../types';
import { IOC_TYPE_LABELS, CONFIDENCE_LEVELS, DEFAULT_CLS_LEVELS, DEFAULT_RELATIONSHIP_TYPES, IOC_STATUS_VALUES, IOC_STATUS_LABELS } from '../../types';
import { EntityComments } from '../Common/EntityComments';
import { EnrichmentLabels } from './EnrichmentLabels';
import { currentLocale } from '../../lib/utils';

interface StandaloneIOCFormProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: Partial<StandaloneIOC>) => void;
  folders: Folder[];
  defaultFolderId?: string;
  editingIOC?: StandaloneIOC;
  allTags?: Tag[];
  onUpdateIOC?: (id: string, updates: Partial<StandaloneIOC>) => void;
  investigationMembers?: InvestigationMember[];
}

const IOC_TYPES = Object.keys(IOC_TYPE_LABELS) as IOCType[];
const CONF_LEVELS = Object.keys(CONFIDENCE_LEVELS) as ConfidenceLevel[];
const IOC_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '\u2014 None \u2014' },
  ...IOC_STATUS_VALUES.map(v => ({ value: v, label: IOC_STATUS_LABELS[v] })),
];
const RELATIONSHIP_TYPE_KEYS = Object.keys(DEFAULT_RELATIONSHIP_TYPES);

export function StandaloneIOCForm({ open, onClose, onSubmit, folders, defaultFolderId, editingIOC, allTags = [], onUpdateIOC, investigationMembers }: StandaloneIOCFormProps) {
  const { t } = useTranslation('analysis');
  const [type, setType] = useState<IOCType>('ipv4');
  const [value, setValue] = useState('');
  const [confidence, setConfidence] = useState<ConfidenceLevel>('medium');
  const [analystNotes, setAnalystNotes] = useState('');
  const [attribution, setAttribution] = useState('');
  const [folderId, setFolderId] = useState(defaultFolderId || '');
  const [iocSubtype, setIocSubtype] = useState('');
  const [iocStatus, setIocStatus] = useState('');
  const [clsLevel, setClsLevel] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [relationships, setRelationships] = useState<IOCRelationship[]>([]);
  const [showAddRel, setShowAddRel] = useState(false);
  const [newRelType, setNewRelType] = useState(RELATIONSHIP_TYPE_KEYS[0]);
  const [newRelTarget, setNewRelTarget] = useState('');
  const [assigneeId, setAssigneeId] = useState('');

  const isEditMode = !!editingIOC;
  const comments = editingIOC?.comments ?? [];

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (open) {
      if (editingIOC) {
        setType(editingIOC.type);
        setValue(editingIOC.value);
        setConfidence(editingIOC.confidence);
        setAnalystNotes(editingIOC.analystNotes || '');
        setAttribution(editingIOC.attribution || '');
        setFolderId(editingIOC.folderId || '');
        setIocSubtype(editingIOC.iocSubtype || '');
        setIocStatus(editingIOC.iocStatus || '');
        setClsLevel(editingIOC.clsLevel || '');
        setTags(editingIOC.tags || []);
        setRelationships(editingIOC.relationships || []);
        setAssigneeId(editingIOC.assigneeId || '');
      } else {
        setType('ipv4');
        setValue('');
        setConfidence('medium');
        setAnalystNotes('');
        setAttribution('');
        setFolderId(defaultFolderId || '');
        setIocSubtype('');
        setIocStatus('');
        setClsLevel('');
        setTags([]);
        setRelationships([]);
        setAssigneeId('');
      }
      setTagInput('');
      setShowAddRel(false);
      setNewRelType(RELATIONSHIP_TYPE_KEYS[0]);
      setNewRelTarget('');
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, editingIOC, defaultFolderId]);

  // Close on Escape key
  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open, handleEscape]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    const selectedMember = investigationMembers?.find((m) => m.userId === assigneeId);
    onSubmit({
      ...editingIOC,
      type,
      value: value.trim(),
      confidence,
      analystNotes: analystNotes.trim() || undefined,
      attribution: attribution.trim() || undefined,
      folderId: folderId || undefined,
      iocSubtype: iocSubtype.trim() || undefined,
      iocStatus: iocStatus || undefined,
      clsLevel: clsLevel || undefined,
      tags,
      relationships: relationships.length > 0 ? relationships : undefined,
      assigneeId: assigneeId || undefined,
      assigneeName: selectedMember?.displayName || undefined,
    });
    onClose();
  };

  const addTag = (name: string) => {
    const trimmed = name.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
    }
    setTagInput('');
  };

  const removeTag = (name: string) => {
    setTags(tags.filter((t) => t !== name));
  };

  const addRelationship = () => {
    if (!newRelTarget.trim()) return;
    setRelationships([...relationships, { targetIOCId: newRelTarget.trim(), relationshipType: newRelType }]);
    setNewRelTarget('');
    setShowAddRel(false);
  };

  const removeRelationship = (index: number) => {
    setRelationships(relationships.filter((_, i) => i !== index));
  };

  const tagSuggestions = allTags
    .map((t) => t.name)
    .filter((n) => n.toLowerCase().includes(tagInput.toLowerCase()) && !tags.includes(n));

  const selectCls = 'w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-accent';
  const inputCls = 'w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-accent';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <form
        onSubmit={handleSubmit}
        className="relative bg-gray-900 border border-gray-700 rounded-lg shadow-xl w-full max-w-lg p-5 space-y-3 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-200">{editingIOC ? t('iocForm.editTitle') : t('iocForm.createTitle')}</h3>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-gray-800 text-gray-500">
            <X size={16} />
          </button>
        </div>

        {/* Row 1: Type + Confidence */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">{t('iocForm.typeLabel')}</label>
            <select value={type} onChange={(e) => setType(e.target.value as IOCType)} className={selectCls}>
              {IOC_TYPES.map((t) => (
                <option key={t} value={t}>{IOC_TYPE_LABELS[t].label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">{t('iocForm.confidenceLabel')}</label>
            <select value={confidence} onChange={(e) => setConfidence(e.target.value as ConfidenceLevel)} className={selectCls}>
              {CONF_LEVELS.map((c) => (
                <option key={c} value={c}>{CONFIDENCE_LEVELS[c].label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Value */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">{t('iocForm.valueLabel')}<span className="text-red-400 ml-0.5">*</span></label>
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t('iocForm.valuePlaceholder')}
            className={`${inputCls} font-mono`}
          />
        </div>

        {/* Row 3: Subtype + Status */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">{t('iocForm.subtypeLabel')}</label>
            <input
              value={iocSubtype}
              onChange={(e) => setIocSubtype(e.target.value)}
              placeholder={t('iocForm.subtypePlaceholder')}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">{t('iocForm.statusLabel')}</label>
            <select value={iocStatus} onChange={(e) => setIocStatus(e.target.value)} className={selectCls}>
              {IOC_STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Row 4: Attribution + Classification */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">{t('iocForm.attributionLabel')}</label>
            <input
              value={attribution}
              onChange={(e) => setAttribution(e.target.value)}
              placeholder={t('iocForm.attributionPlaceholder')}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">{t('iocForm.classificationLabel')}</label>
            <select value={clsLevel} onChange={(e) => setClsLevel(e.target.value)} className={selectCls}>
              <option value="">{t('iocForm.classificationNone')}</option>
              {DEFAULT_CLS_LEVELS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Investigation + Assignee */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">{t('iocForm.investigationLabel')}</label>
            <select value={folderId} onChange={(e) => setFolderId(e.target.value)} className={selectCls}>
              <option value="">{t('iocForm.noInvestigation')}</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
          {investigationMembers && investigationMembers.length > 0 && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">{t('iocForm.assigneeLabel')}</label>
              <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={selectCls}>
                <option value="">{t('iocForm.unassigned')}</option>
                {investigationMembers.map((m) => (
                  <option key={m.userId} value={m.userId}>{m.displayName}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Tags */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">{t('iocForm.tagsLabel')}</label>
          <div className="flex flex-wrap gap-1 mb-1.5">
            {tags.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-800 text-xs text-gray-300 border border-gray-700">
                {t}
                <button type="button" onClick={() => removeTag(t)} className="text-gray-500 hover:text-gray-300">
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
          <div className="relative">
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); addTag(tagInput); }
              }}
              placeholder={t('iocForm.tagPlaceholder')}
              className={inputCls}
            />
            {tagInput && tagSuggestions.length > 0 && (
              <div className="absolute z-10 top-full mt-1 w-full bg-gray-800 border border-gray-700 rounded shadow-lg max-h-28 overflow-y-auto">
                {tagSuggestions.slice(0, 6).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => addTag(s)}
                    className="w-full text-left px-2 py-1 text-xs text-gray-300 hover:bg-gray-700"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Relationships */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">{t('iocForm.relationshipsLabel')}</label>
          {relationships.length > 0 && (
            <div className="space-y-1 mb-1.5">
              {relationships.map((rel, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-400 border border-blue-800/40">
                    {DEFAULT_RELATIONSHIP_TYPES[rel.relationshipType]?.label || rel.relationshipType}
                  </span>
                  <span className="text-xs text-gray-300 font-mono truncate">{rel.targetIOCId}</span>
                  <button type="button" onClick={() => removeRelationship(i)} className="ml-auto p-0.5 text-gray-600 hover:text-red-400">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {showAddRel ? (
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <select value={newRelType} onChange={(e) => setNewRelType(e.target.value)} className={`${selectCls} text-xs`}>
                  {RELATIONSHIP_TYPE_KEYS.map((k) => (
                    <option key={k} value={k}>{DEFAULT_RELATIONSHIP_TYPES[k].label}</option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <input
                  value={newRelTarget}
                  onChange={(e) => setNewRelTarget(e.target.value)}
                  placeholder={t('iocForm.targetPlaceholder')}
                  className={`${inputCls} text-xs font-mono`}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRelationship(); } }}
                />
              </div>
              <button type="button" onClick={addRelationship} className="px-2 py-1.5 text-xs rounded bg-accent/15 text-accent hover:bg-accent/25">{t('common:add')}</button>
              <button type="button" onClick={() => setShowAddRel(false)} className="px-2 py-1.5 text-xs rounded text-gray-500 hover:text-gray-300">{t('common:cancel')}</button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowAddRel(true)}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-accent"
            >
              <Plus size={12} /> {t('iocForm.addRelationship')}
            </button>
          )}
        </div>

        {/* Analyst Notes */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">{t('iocForm.analystNotesLabel')}</label>
          <textarea
            value={analystNotes}
            onChange={(e) => setAnalystNotes(e.target.value)}
            rows={2}
            placeholder={t('iocForm.analystNotesPlaceholder')}
            className={`${inputCls} resize-none`}
          />
        </div>

        {/* Enrichment Labels (edit mode only) */}
        {isEditMode && editingIOC?.enrichment && Object.keys(editingIOC.enrichment).length > 0 && (
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              {t('iocForm.enrichmentLabelsLabel')}
              <span className="ml-1 text-[9px] text-gray-600 font-normal">{t('iocForm.enrichmentLabelsExperimental')}</span>
            </label>
            <EnrichmentLabels enrichment={editingIOC.enrichment} compact={false} />
          </div>
        )}

        {/* Enrichment History (edit mode only) */}
        {isEditMode && editingIOC?.enrichment && Object.keys(editingIOC.enrichment).length > 0 && (
          <div>
            <label className="block text-xs text-gray-400 mb-1">{t('iocForm.enrichmentHistoryLabel')}</label>
            <div className="space-y-2">
              {Object.entries(editingIOC.enrichment).map(([provider, snapshots]) => (
                <div key={provider} className="bg-gray-800/50 border border-gray-700 rounded p-2">
                  <div className="text-xs font-medium text-gray-300 mb-1">{provider}</div>
                  <div className="space-y-1">
                    {(snapshots as Array<Record<string, unknown>>).map((snap, i, arr) => {
                      const prev = arr[i + 1] as Record<string, unknown> | undefined;
                      const ts = snap.ts as number | undefined;
                      return (
                        <div key={i} className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] border-l-2 border-gray-700 pl-2">
                          {ts && (
                            <span className="text-gray-500 w-full">
                              {new Date(ts).toLocaleString(currentLocale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                          {Object.entries(snap)
                            .filter(([k]) => k !== 'ts')
                            .map(([key, val]) => {
                              const display = val === null || val === undefined ? '--' : String(val);
                              const prevVal = prev?.[key];
                              const changed = prev !== undefined && prevVal !== undefined && String(prevVal) !== String(val);
                              return (
                                <span key={key} className="text-gray-400">
                                  <span className="text-gray-500">{key}:</span>{' '}
                                  <span className={changed ? 'text-amber-400' : ''}>{display}</span>
                                  {changed && (
                                    <span className="text-gray-600 ml-0.5">({t('iocForm.prevValue', { value: String(prevVal) })})</span>
                                  )}
                                </span>
                              );
                            })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Comments section (edit mode only) */}
        {isEditMode && editingIOC && onUpdateIOC && (
          <EntityComments
            comments={comments}
            onUpdate={(updated: EntityComment[]) => onUpdateIOC(editingIOC.id, { comments: updated })}
          />
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800"
          >
            {t('common:cancel')}
          </button>
          <button
            type="submit"
            disabled={!value.trim()}
            className="px-3 py-1.5 text-sm rounded-lg bg-accent/15 text-accent hover:bg-accent/25 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {editingIOC ? t('iocForm.saveButton') : t('iocForm.createButton')}
          </button>
        </div>
      </form>
    </div>
  );
}
