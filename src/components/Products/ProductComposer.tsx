import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { useTranslation } from 'react-i18next';

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

const sourceKinds: ProductComposerSourceKind[] = ['notes', 'tasks', 'timeline', 'iocs', 'evidence'];
const control = 'w-full min-w-0 rounded border border-gray-700 bg-gray-800 px-2 py-2 text-sm text-gray-100 disabled:opacity-50';
const button = 'min-h-11 md:min-h-9 rounded border border-gray-700 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-800 disabled:opacity-40';

/** One mounted session owns its draft and every asynchronous completion. */
export function ProductComposer(props: ProductComposerProps) {
  return <ProductComposerSession key={props.snapshot.folder.id} {...props} />;
}

function ProductComposerSession({ snapshot, baselines, initialBaselineId, effectiveLevels, onSave, onSaved, onClose, suspended = false }: ProductComposerProps) {
  const { t, i18n } = useTranslation('products');
  const validationMessage = useCallback((cause: unknown, fallback = 'composer.prepareFailed'): string => cause instanceof ProductComposerValidationError
    ? t(`composer.validation.${cause.messageKey}`, { ...cause.values,
      ...(typeof cause.values.maximum === 'number' ? { maximum: cause.values.maximum.toLocaleString(i18n.resolvedLanguage) } : {}),
      ...(typeof cause.values.field === 'string' ? { field: t(`composer.validationFields.${cause.values.field}`, { defaultValue: cause.values.field }) } : {}),
      defaultValue: cause.message }) : t(fallback), [t, i18n.resolvedLanguage]);
  const draftLabels = () => ({ productTitle: t('composer.defaultTitle', { investigation: snapshot.folder.name }), draft: t('composer.defaultSection'), introduction: t('composer.introduction') });
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
      return { draft: createProductComposerDraft({ snapshot, baseline, effectiveLevels, generatedAt: openedAt, labels: draftLabels() }), error: '', baselineId: baseline?.id ?? '' };
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
      setError(t('composer.fieldLimit', { maximum: maximum.toLocaleString(i18n.resolvedLanguage) }));
      return;
    }
    apply();
  };
  const changeSection = (sectionId: string, updates: Partial<ProductComposerSection>) => {
    changeDraft({ ...draft, sections: draft.sections.map(section => section.id === sectionId ? { ...section, ...updates } : section) });
  };
  const resetBaseline = (nextId: string) => {
    const baseline = baselines.find(item => item.id === nextId);
    if (nextId && !baseline) { setError(t('composer.baselineUnavailable')); return; }
    try {
      const next = createProductComposerDraft({ snapshot, baseline, effectiveLevels, generatedAt: openedAt, labels: draftLabels() });
      generation.current++;
      copyingRef.current = false; setCopying(false);
      setBaselineId(nextId); setInitializationError(''); setTargetId(next.sections[0]?.id ?? ''); setSelectedIds([]);
      changeDraft(next);
    } catch (cause) { setError(validationMessage(cause)); }
  };
  const close = () => { generation.current++; clearPending(pendingOwner.current); onClose(); };
  const requestClose = () => {
    if (savingRef.current) { setMessage(t('composer.waitForSave')); return; }
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
  }, [draft, validationMessage]);
  const previewHtml = useMemo(() => preview && !markdown.error ? renderMarkdown(markdown.content, undefined, { disableMedia: true }) : '', [preview, markdown]);
  const hasPlaceholders = /{{|{%/.test(markdown.content);

  const stage = () => {
    if (!target) { setError(t('composer.addSectionFirst')); return; }
    try {
      const staged = stageProductSection(snapshot, sourceKind, selectedIds);
      const next = { ...draft, sections: draft.sections.map(section => section.id === target.id
        ? { ...section, content: `${section.content}${section.content ? '\n\n' : ''}${staged}` } : section) };
      composeProductMarkdown(next.title, next.sections, next.clsLevel);
      changeDraft(next); setSelectedIds([]); setMessage(t('composer.staged'));
    } catch (cause) { setError(validationMessage(cause)); }
  };
  const copyPrompt = async (section: ProductComposerSection) => {
    if (copyingRef.current || !active.current || sharing.current !== null || getSessionKey() !== ownerKey.current) return;
    const version = generation.current;
    try {
      composeProductMarkdown(draft.title, [section], draft.clsLevel);
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      copyingRef.current = true; setCopying(true); setError('');
      await navigator.clipboard.writeText(t('composer.prompt', { title: draft.title, classification: draft.clsLevel ?? t('composer.notSpecified'), section: section.title, content: section.content }));
      if (current(version)) setMessage(t('composer.promptCopied'));
    } catch (cause) {
      if (current(version)) setError(validationMessage(cause, 'composer.copyFailed'));
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
        setError(validationMessage(cause, 'composer.saveFailed'));
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

  return <Modal open onClose={requestClose} title={t('composer.title')} extraWide suspended={suspended}>
    <div className="space-y-4">
      <p className="text-sm text-gray-400 [overflow-wrap:anywhere]">{t('composer.description', { investigation: snapshot.folder.name })}</p>
      <p className="text-xs text-gray-500">{t('composer.localDraft')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs text-gray-400" htmlFor={`${id}-baseline`}>{t('composer.baseline')}
          <select id={`${id}-baseline`} className={control} value={baselineId} disabled={saving || !!savedNote}
            onChange={event => { const nextId = event.target.value; if (dirty) setConfirmation({ type: 'baseline', id: nextId }); else resetBaseline(nextId); }}>
            <option value="">{t('composer.manualOutline')}</option>
            {baselines.map(baseline => <option key={baseline.id} value={baseline.id}>{baseline.name}</option>)}
          </select>
        </label>
        <div className="min-w-0 space-y-1 text-xs text-gray-400"><span>{t('composer.classificationFloor')}</span><p className="rounded border border-gray-700 p-2 text-sm text-gray-200 [overflow-wrap:anywhere]">{draft.clsLevel ?? t('composer.notSpecified')}</p><p>{t('composer.classificationHelp')}</p></div>
      </div>
      {hasPlaceholders && <p role="note" className="rounded border border-amber-700 bg-amber-950/20 p-2 text-sm text-amber-200">{t('composer.placeholders')}</p>}
      <label className="block space-y-1 text-xs text-gray-400" htmlFor={`${id}-title`}>{t('composer.productTitle')}
        <input id={`${id}-title`} className={control} value={draft.title} disabled={!editable}
          onChange={event => changeText(event.target.value, PRODUCT_COMPOSER_LIMITS.titleCharacters, () => changeDraft({ ...draft, title: event.target.value }))} />
      </label>
      <div className="space-y-3" aria-label={t('composer.sections')}>
        {draft.sections.map((section, index) => <fieldset key={section.id} className="min-w-0 space-y-2 rounded border border-gray-700 p-3" disabled={!editable}>
          <legend className="px-1 text-sm font-medium text-gray-200">{t('composer.section', { number: index + 1 })}</legend>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1 space-y-1 text-xs text-gray-400" htmlFor={`${id}-${section.id}-heading`}>{t('composer.sectionHeading', { number: index + 1 })}
              <input id={`${id}-${section.id}-heading`} className={control} value={section.title}
                onChange={event => changeText(event.target.value, PRODUCT_COMPOSER_LIMITS.titleCharacters, () => changeSection(section.id, { title: event.target.value }))} />
            </label>
            <label className="space-y-1 text-xs text-gray-400" htmlFor={`${id}-${section.id}-level`}>{t('composer.sectionLevel', { number: index + 1 })}
              <select id={`${id}-${section.id}-level`} className={control} value={section.level} onChange={event => changeSection(section.id, { level: Number(event.target.value) })}>
                <option value={0}>{t('composer.preamble')}</option>
                {[1, 2, 3, 4, 5, 6].map(level => <option key={level} value={level}>{t('composer.heading', { level })}</option>)}
              </select>
            </label>
          </div>
          <label className="block space-y-1 text-xs text-gray-400" htmlFor={`${id}-${section.id}-content`}>{t('composer.sectionContent', { number: index + 1 })}
            <textarea id={`${id}-${section.id}-content`} className={`${control} min-h-32 font-mono`} value={section.content}
              onChange={event => changeText(event.target.value, PRODUCT_COMPOSER_LIMITS.sectionCharacters, () => changeSection(section.id, { content: event.target.value }))} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={button} disabled={index === 0} aria-label={t('composer.moveUpLabel', { number: index + 1 })} onClick={() => {
              const sections = [...draft.sections]; [sections[index - 1], sections[index]] = [sections[index], sections[index - 1]]; changeDraft({ ...draft, sections });
            }}>{t('composer.moveUp')}</button>
            <button type="button" className={button} disabled={index === draft.sections.length - 1} aria-label={t('composer.moveDownLabel', { number: index + 1 })} onClick={() => {
              const sections = [...draft.sections]; [sections[index + 1], sections[index]] = [sections[index], sections[index + 1]]; changeDraft({ ...draft, sections });
            }}>{t('composer.moveDown')}</button>
            <button type="button" className={button} aria-label={t('composer.removeLabel', { number: index + 1 })} onClick={() => changeDraft({ ...draft, sections: draft.sections.filter(item => item.id !== section.id) })}>{t('composer.remove')}</button>
            <button type="button" className={button} disabled={copying} onClick={() => void copyPrompt(section)}>{t('composer.copyPrompt', { number: index + 1 })}</button>
          </div>
        </fieldset>)}
        <button type="button" className={button} disabled={!editable} onClick={() => {
          if (draft.sections.length >= PRODUCT_COMPOSER_LIMITS.sections) { setError(t('composer.validation.sectionCount', { maximum: PRODUCT_COMPOSER_LIMITS.sections })); return; }
          const section = { id: `added-${++nextSection.current}`, title: t('composer.newSection'), level: 2, content: '' };
          changeDraft({ ...draft, sections: [...draft.sections, section] });
          if (!target) setTargetId(section.id);
        }}>{t('composer.addSection')}</button>
      </div>
      <fieldset disabled={!editable} className="min-w-0 space-y-3 rounded border border-gray-700 p-3">
        <legend className="px-1 text-sm font-medium text-gray-200">{t('composer.stageSources')}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs text-gray-400" htmlFor={`${id}-source`}>{t('composer.sourceType')}
            <select id={`${id}-source`} className={control} value={sourceKind} onChange={event => { setSourceKind(event.target.value as ProductComposerSourceKind); setSelectedIds([]); }}>
              {sourceKinds.map(kind => <option key={kind} value={kind}>{t(`composer.sourceKinds.${kind}`)}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs text-gray-400" htmlFor={`${id}-target`}>{t('composer.stageInto')}
            <select id={`${id}-target`} className={control} value={target?.id ?? ''} onChange={event => setTargetId(event.target.value)}>
              {draft.sections.map((section, index) => <option key={section.id} value={section.id}>{index + 1}. {section.title}</option>)}
            </select>
          </label>
        </div>
        <div className="max-h-40 space-y-1 overflow-y-auto">
          {sources.length === 0 && <p className="text-xs text-gray-500">{t('composer.noSources')}</p>}
          {sources.map(source => <label key={source.id} className="flex min-h-9 items-start gap-2 break-words text-sm text-gray-300">
            <input type="checkbox" className="mt-1" checked={selectedIds.includes(source.id)} aria-label={t(`composer.include.${sourceKind}`, { name: source.label })}
              onChange={event => setSelectedIds(previous => event.target.checked ? [...previous, source.id] : previous.filter(value => value !== source.id))} />
            <span className="min-w-0 [overflow-wrap:anywhere]">{source.label}</span>
          </label>)}
        </div>
        <button type="button" className={button} onClick={stage}>{t('composer.stageSelected')}</button>
        <p className="text-xs text-gray-500">{t('composer.stagingHelp')}</p>
      </fieldset>
      {(initializationError || error) && <p role="alert" className="text-sm text-red-300">{error || initializationError}</p>}
      {message && <p role="status" className="text-sm text-gray-300">{message}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={button} onClick={requestClose} disabled={saving}>{t('common:cancel')}</button>
        <button type="button" className={button} disabled={saving || !!initializationError} onClick={() => { if (markdown.error) setError(markdown.error); else { setError(''); setPreview(previous => !previous); } }}>{t(preview ? 'composer.hidePreview' : 'composer.previewDraft')}</button>
        {savedNote ? <button type="button" className={button} onClick={() => onSaved(savedNote)}>{t('composer.openSaved')}</button>
          : <button type="button" className={`${button} bg-accent text-white`} disabled={saving || !!initializationError} onClick={() => void save()}>{t(saving ? 'composer.saving' : 'composer.save')}</button>}
      </div>
      {preview && <section aria-label={t('composer.preview')} className="markdown-preview max-w-none overflow-x-auto rounded border border-gray-700 p-4" dangerouslySetInnerHTML={{ __html: previewHtml }} />}
    </div>
    <ConfirmDialog open={confirmation !== null} onClose={() => setConfirmation(null)}
      title={t(confirmation?.type === 'baseline' ? 'composer.replaceTitle' : 'composer.discardTitle')}
      message={t(confirmation?.type === 'baseline' ? 'composer.replaceMessage' : 'composer.discardMessage')}
      confirmLabel={t(confirmation?.type === 'baseline' ? 'composer.replace' : 'composer.discard')} danger
      onConfirm={() => { if (confirmation?.type === 'baseline') resetBaseline(confirmation.id); else close(); }} />
  </Modal>;
}
