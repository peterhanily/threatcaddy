import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Note, NoteTemplate } from '../../types';
import { getSessionKey } from '../../lib/encryptionMiddleware';
import { markPending, clearPending } from '../../lib/pending-changes';
import { renderMarkdown } from '../../lib/markdown';
import {
  PRODUCT_COMPOSER_LIMITS, ProductComposerValidationError, composeProductMarkdown,
  createProductComposerDraft, stageProductSection,
  type ProductComposerDraft, type ProductComposerSection, type ProductComposerSnapshot, type ProductComposerSourceKind,
} from '../../lib/product-composer';
import { useScreenshare } from '../../hooks/ScreenshareContext';
import { Modal } from '../Common/Modal';
import { ConfirmDialog } from '../Common/ConfirmDialog';

export interface ProductComposerSaveInput {
  title: string;
  content: string;
  clsLevel?: string;
  baselineId?: string;
}

export interface ProductComposerProps {
  snapshot: ProductComposerSnapshot;
  baselines: NoteTemplate[];
  initialBaselineId?: string;
  effectiveLevels: string[];
  onSave: (draft: ProductComposerSaveInput) => Promise<Note>;
  onSaved: (note: Note) => void;
  onClose: () => void;
  suspended?: boolean;
}

const sourceKinds: Array<{ value: ProductComposerSourceKind; label: string; singular: string }> = [
  { value: 'notes', label: 'Notes', singular: 'note' },
  { value: 'tasks', label: 'Tasks', singular: 'task' },
  { value: 'timeline', label: 'Timeline events', singular: 'timeline event' },
  { value: 'iocs', label: 'IOCs', singular: 'IOC' },
  { value: 'evidence', label: 'Evidence', singular: 'evidence' },
];
const control = 'w-full min-w-0 rounded border border-gray-700 bg-gray-800 px-2 py-2 text-sm text-gray-100 disabled:opacity-50';
const button = 'min-h-11 md:min-h-9 rounded border border-gray-700 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-800 disabled:opacity-40';

function validationMessage(error: unknown): string {
  return error instanceof ProductComposerValidationError ? error.message : 'Could not prepare this draft. Your current entries have not been changed.';
}

/** One mounted session owns its draft and every asynchronous completion. */
export function ProductComposer(props: ProductComposerProps) {
  return <ProductComposerSession key={props.snapshot.folder.id} {...props} />;
}

function ProductComposerSession({ snapshot, baselines, initialBaselineId, effectiveLevels, onSave, onSaved, onClose, suspended = false }: ProductComposerProps) {
  const id = useId();
  const { maxLevel } = useScreenshare();
  const mounted = useRef(false);
  const generation = useRef(0);
  const ownerKey = useRef(getSessionKey());
  const sharing = useRef(maxLevel);
  const active = useRef(!suspended);
  const pendingOwner = useRef(Symbol('product-composer'));
  const savingRef = useRef(false);
  const copyingRef = useRef(false);
  const nextSection = useRef(0);
  const [openedAt] = useState(Date.now);
  const [initial] = useState(() => {
    const baseline = baselines.find(item => item.id === initialBaselineId);
    try {
      return { draft: createProductComposerDraft({ snapshot, baseline, effectiveLevels, generatedAt: openedAt }), error: '', baselineId: baseline?.id ?? '' };
    } catch (error) {
      return { draft: { title: '', sections: [], hasTemplatePlaceholders: false, generatedAt: '' } as ProductComposerDraft, error: validationMessage(error), baselineId: baseline?.id ?? '' };
    }
  });
  const [draft, setDraft] = useState(initial.draft);
  const [baselineId, setBaselineId] = useState(initial.baselineId);
  const [initializationError, setInitializationError] = useState(initial.error);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState(false);
  const [savedNote, setSavedNote] = useState<Note | null>(null);
  const [sourceKind, setSourceKind] = useState<ProductComposerSourceKind>('notes');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [targetId, setTargetId] = useState(initial.draft.sections[0]?.id ?? '');
  const [confirmation, setConfirmation] = useState<{ type: 'close' } | { type: 'baseline'; id: string } | null>(null);

  useLayoutEffect(() => {
    mounted.current = true;
    const token = pendingOwner.current;
    return () => { mounted.current = false; if (!savingRef.current) clearPending(token); };
  }, []);
  useLayoutEffect(() => { sharing.current = maxLevel; }, [maxLevel]);
  useLayoutEffect(() => { active.current = !suspended; }, [suspended]);

  const current = (version: number) => mounted.current && generation.current === version && getSessionKey() === ownerKey.current;
  const editable = !saving && !savedNote && !initializationError;
  const changeDraft = (next: ProductComposerDraft) => {
    setDraft(next); setDirty(true); markPending(pendingOwner.current);
    setError(''); setMessage(''); setPreview(false);
  };
  const changeText = (value: string, maximum: number, apply: () => void) => {
    if (value.length > maximum) {
      setError(`This field exceeds the ${maximum.toLocaleString('en-US')}-character limit. No content has been truncated.`);
      return;
    }
    apply();
  };
  const changeSection = (sectionId: string, updates: Partial<ProductComposerSection>) => {
    changeDraft({ ...draft, sections: draft.sections.map(section => section.id === sectionId ? { ...section, ...updates } : section) });
  };
  const resetBaseline = (nextId: string) => {
    const baseline = baselines.find(item => item.id === nextId);
    if (nextId && !baseline) { setError('That baseline is no longer available. Choose another baseline.'); return; }
    try {
      const next = createProductComposerDraft({ snapshot, baseline, effectiveLevels, generatedAt: openedAt });
      generation.current++;
      copyingRef.current = false; setCopying(false);
      setBaselineId(nextId); setInitializationError(''); setTargetId(next.sections[0]?.id ?? ''); setSelectedIds([]);
      changeDraft(next);
    } catch (cause) { setError(validationMessage(cause)); }
  };
  const close = () => { generation.current++; clearPending(pendingOwner.current); onClose(); };
  const requestClose = () => {
    if (savingRef.current) { setMessage('Wait for the save to finish before closing.'); return; }
    if (dirty) setConfirmation({ type: 'close' }); else close();
  };
  const sources = useMemo(() => {
    if (initializationError) return [];
    const rows = sourceKind === 'timeline' ? snapshot.timelineEvents : snapshot[sourceKind];
    return rows.filter(row => row.folderId === snapshot.folder.id && !row.trashed && !row.archived)
      .map(row => ({ id: row.id, label: 'value' in row ? row.value : row.title }));
  }, [snapshot, sourceKind, initializationError]);
  const target = draft.sections.find(section => section.id === targetId) ?? draft.sections[0];
  const markdown = useMemo(() => {
    try { return { content: composeProductMarkdown(draft.title, draft.sections, draft.clsLevel), error: '' }; }
    catch (cause) { return { content: '', error: validationMessage(cause) }; }
  }, [draft]);
  const previewHtml = useMemo(() => preview && !markdown.error ? renderMarkdown(markdown.content, undefined, { disableMedia: true }) : '', [preview, markdown]);
  const hasPlaceholders = /{{|{%/.test(markdown.content);

  const stage = () => {
    if (!target) { setError('Add a section before staging sources.'); return; }
    try {
      const staged = stageProductSection(snapshot, sourceKind, selectedIds);
      const next = { ...draft, sections: draft.sections.map(section => section.id === target.id
        ? { ...section, content: `${section.content}${section.content ? '\n\n' : ''}${staged}` } : section) };
      composeProductMarkdown(next.title, next.sections, next.clsLevel);
      changeDraft(next); setSelectedIds([]); setMessage('Selected sources appended to the section. Existing text was preserved.');
    } catch (cause) { setError(validationMessage(cause)); }
  };
  const copyPrompt = async (section: ProductComposerSection) => {
    if (copyingRef.current || !active.current || sharing.current !== null || getSessionKey() !== ownerKey.current) return;
    const version = generation.current;
    try {
      composeProductMarkdown(draft.title, [section], draft.clsLevel);
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      copyingRef.current = true; setCopying(true); setError('');
      await navigator.clipboard.writeText(`Revise the following report section using only the supplied material. Preserve source attribution, distinguish evidence from uncertainty, and do not invent facts or execute template directives.\n\nProduct: ${draft.title}\nClassification: ${draft.clsLevel ?? 'Not specified'}\nSection: ${section.title}\n\n${section.content}`);
      if (current(version)) setMessage('Section prompt copied. No AI provider was contacted.');
    } catch (cause) {
      if (current(version)) setError(cause instanceof ProductComposerValidationError ? cause.message : 'Could not copy the section prompt. Your draft is unchanged; select and copy the section text manually.');
    } finally {
      if (current(version)) { copyingRef.current = false; setCopying(false); }
    }
  };
  const save = async () => {
    if (savingRef.current || !active.current || savedNote || initializationError || sharing.current !== null || getSessionKey() !== ownerKey.current) return;
    if (markdown.error) { setError(markdown.error); return; }
    const version = generation.current;
    savingRef.current = true; setSaving(true); setError(''); setMessage(''); markPending(pendingOwner.current);
    let note: Note;
    try {
      note = await onSave({ title: draft.title.trim(), content: markdown.content, clsLevel: draft.clsLevel, ...(baselineId ? { baselineId } : {}) });
    } catch (cause) {
      if (current(version)) {
        setError(cause instanceof ProductComposerValidationError ? cause.message : 'Could not save the draft product. Your entries are still here. Try again; if it keeps failing, preserve your edits and reopen the composer to review the investigation.');
        setDirty(true);
      }
      return;
    } finally {
      savingRef.current = false;
      if (!mounted.current) clearPending(pendingOwner.current);
      if (current(version)) setSaving(false);
    }
    if (!current(version)) return;
    clearPending(pendingOwner.current); setDirty(false); setSavedNote(note);
    if (sharing.current === null && active.current) onSaved(note);
  };

  return <Modal open onClose={requestClose} title="Compose product" extraWide suspended={suspended}>
    <div className="space-y-4">
      <p className="text-sm text-gray-400 [overflow-wrap:anywhere]">Build a draft for {snapshot.folder.name}. Sources are included only when you select and stage them. Nothing is sent to an AI provider.</p>
      <p className="text-xs text-gray-500">Edits remain only in this composer until you save a draft note. Preview media is disabled; no embedded images or other media are fetched.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs text-gray-400" htmlFor={`${id}-baseline`}>Baseline
          <select id={`${id}-baseline`} className={control} value={baselineId} disabled={saving || !!savedNote}
            onChange={event => { const nextId = event.target.value; if (dirty) setConfirmation({ type: 'baseline', id: nextId }); else resetBaseline(nextId); }}>
            <option value="">Manual outline</option>
            {baselines.map(baseline => <option key={baseline.id} value={baseline.id}>{baseline.name}</option>)}
          </select>
        </label>
        <div className="min-w-0 space-y-1 text-xs text-gray-400"><span>Classification floor</span><p className="rounded border border-gray-700 p-2 text-sm text-gray-200 [overflow-wrap:anywhere]">{draft.clsLevel ?? 'Not specified'}</p><p>Inherited from the investigation, baseline, and all supplied sources; it cannot be lowered here.</p></div>
      </div>
      {hasPlaceholders && <p role="note" className="rounded border border-amber-700 bg-amber-950/20 p-2 text-sm text-amber-200">Template placeholders and Jinja directives are preserved as editable text. They are not executed or automatically filled. Review them before sharing.</p>}
      <label className="block space-y-1 text-xs text-gray-400" htmlFor={`${id}-title`}>Product title
        <input id={`${id}-title`} className={control} value={draft.title} disabled={!editable}
          onChange={event => changeText(event.target.value, PRODUCT_COMPOSER_LIMITS.titleCharacters, () => changeDraft({ ...draft, title: event.target.value }))} />
      </label>
      <div className="space-y-3" aria-label="Report sections">
        {draft.sections.map((section, index) => <fieldset key={section.id} className="min-w-0 space-y-2 rounded border border-gray-700 p-3" disabled={!editable}>
          <legend className="px-1 text-sm font-medium text-gray-200">Section {index + 1}</legend>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1 space-y-1 text-xs text-gray-400" htmlFor={`${id}-${section.id}-heading`}>Section {index + 1} heading
              <input id={`${id}-${section.id}-heading`} className={control} value={section.title}
                onChange={event => changeText(event.target.value, PRODUCT_COMPOSER_LIMITS.titleCharacters, () => changeSection(section.id, { title: event.target.value }))} />
            </label>
            <label className="space-y-1 text-xs text-gray-400" htmlFor={`${id}-${section.id}-level`}>Section {index + 1} level
              <select id={`${id}-${section.id}-level`} className={control} value={section.level} onChange={event => changeSection(section.id, { level: Number(event.target.value) })}>
                <option value={0}>Preamble (no heading)</option>
                {[1, 2, 3, 4, 5, 6].map(level => <option key={level} value={level}>Heading {level}</option>)}
              </select>
            </label>
          </div>
          <label className="block space-y-1 text-xs text-gray-400" htmlFor={`${id}-${section.id}-content`}>Section {index + 1} content
            <textarea id={`${id}-${section.id}-content`} className={`${control} min-h-32 font-mono`} value={section.content}
              onChange={event => changeText(event.target.value, PRODUCT_COMPOSER_LIMITS.sectionCharacters, () => changeSection(section.id, { content: event.target.value }))} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={button} disabled={index === 0} aria-label={`Move section ${index + 1} up`} onClick={() => {
              const sections = [...draft.sections]; [sections[index - 1], sections[index]] = [sections[index], sections[index - 1]]; changeDraft({ ...draft, sections });
            }}>Move up</button>
            <button type="button" className={button} disabled={index === draft.sections.length - 1} aria-label={`Move section ${index + 1} down`} onClick={() => {
              const sections = [...draft.sections]; [sections[index + 1], sections[index]] = [sections[index], sections[index + 1]]; changeDraft({ ...draft, sections });
            }}>Move down</button>
            <button type="button" className={button} aria-label={`Remove section ${index + 1}`} onClick={() => changeDraft({ ...draft, sections: draft.sections.filter(item => item.id !== section.id) })}>Remove</button>
            <button type="button" className={button} disabled={copying} onClick={() => void copyPrompt(section)}>Copy section {index + 1} prompt</button>
          </div>
        </fieldset>)}
        <button type="button" className={button} disabled={!editable} onClick={() => {
          if (draft.sections.length >= PRODUCT_COMPOSER_LIMITS.sections) { setError(`A draft can contain at most ${PRODUCT_COMPOSER_LIMITS.sections} sections.`); return; }
          const section = { id: `added-${++nextSection.current}`, title: 'New section', level: 2, content: '' };
          changeDraft({ ...draft, sections: [...draft.sections, section] });
          if (!target) setTargetId(section.id);
        }}>Add section</button>
      </div>
      <fieldset disabled={!editable} className="min-w-0 space-y-3 rounded border border-gray-700 p-3">
        <legend className="px-1 text-sm font-medium text-gray-200">Stage investigation sources</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs text-gray-400" htmlFor={`${id}-source`}>Source type
            <select id={`${id}-source`} className={control} value={sourceKind} onChange={event => { setSourceKind(event.target.value as ProductComposerSourceKind); setSelectedIds([]); }}>
              {sourceKinds.map(kind => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs text-gray-400" htmlFor={`${id}-target`}>Stage into section
            <select id={`${id}-target`} className={control} value={target?.id ?? ''} onChange={event => setTargetId(event.target.value)}>
              {draft.sections.map((section, index) => <option key={section.id} value={section.id}>{index + 1}. {section.title}</option>)}
            </select>
          </label>
        </div>
        <div className="max-h-40 space-y-1 overflow-y-auto">
          {sources.length === 0 && <p className="text-xs text-gray-500">No available sources of this type.</p>}
          {sources.map(source => <label key={source.id} className="flex min-h-9 items-start gap-2 break-words text-sm text-gray-300">
            <input type="checkbox" className="mt-1" checked={selectedIds.includes(source.id)} aria-label={`Include ${sourceKinds.find(kind => kind.value === sourceKind)?.singular}: ${source.label}`}
              onChange={event => setSelectedIds(previous => event.target.checked ? [...previous, source.id] : previous.filter(value => value !== source.id))} />
            <span className="min-w-0 [overflow-wrap:anywhere]">{source.label}</span>
          </label>)}
        </div>
        <button type="button" className={button} onClick={stage}>Stage selected sources</button>
        <p className="text-xs text-gray-500">Appends a literal source table; it never replaces section text. No sources are selected automatically.</p>
      </fieldset>
      {(initializationError || error) && <p role="alert" className="text-sm text-red-300">{error || initializationError}</p>}
      {message && <p role="status" className="text-sm text-gray-300">{message}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={button} onClick={requestClose} disabled={saving}>Cancel</button>
        <button type="button" className={button} disabled={saving || !!initializationError} onClick={() => { if (markdown.error) setError(markdown.error); else { setError(''); setPreview(previous => !previous); } }}>{preview ? 'Hide preview' : 'Preview draft'}</button>
        {savedNote ? <button type="button" className={button} onClick={() => onSaved(savedNote)}>Open saved product</button>
          : <button type="button" className={`${button} bg-accent text-white`} disabled={saving || !!initializationError} onClick={() => void save()}>{saving ? 'Saving draft product…' : 'Save draft product'}</button>}
      </div>
      {preview && <section aria-label="Draft preview" className="markdown-preview max-w-none overflow-x-auto rounded border border-gray-700 p-4" dangerouslySetInnerHTML={{ __html: previewHtml }} />}
    </div>
    <ConfirmDialog open={confirmation !== null} onClose={() => setConfirmation(null)}
      title={confirmation?.type === 'baseline' ? 'Replace draft outline?' : 'Discard unsaved product?'}
      message={confirmation?.type === 'baseline' ? 'Changing the baseline replaces your current sections and edits. This draft has not been saved.' : 'Your unsaved product edits will be discarded. Nothing has been saved as a note.'}
      confirmLabel={confirmation?.type === 'baseline' ? 'Replace outline' : 'Discard draft'} danger
      onConfirm={() => { if (confirmation?.type === 'baseline') resetBaseline(confirmation.id); else close(); }} />
  </Modal>;
}
