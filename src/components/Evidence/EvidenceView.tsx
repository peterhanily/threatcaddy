import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import Papa from 'papaparse';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  CopyX,
  Eye,
  FileImage,
  FileSearch,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  Plus,
  Search,
  Table2,
  Upload,
  X,
} from 'lucide-react';
import type { EvidenceItem } from '../../types';
import { cn, formatDate } from '../../lib/utils';
import { formatBytes } from '../../lib/file-handler';
import { EVIDENCE_ACCEPT, findDuplicateEvidenceItemIds, MAX_EVIDENCE_IMPORT_FILES } from '../../lib/evidence-import';
import {
  extractEvidenceTableIOCCandidates,
  renderEvidenceTableIOCCandidatesText,
  type EvidenceTableIOCCandidate,
} from '../../lib/evidence-ioc-candidates';

interface EvidenceViewProps {
  folderId?: string;
  folderName?: string;
  items: EvidenceItem[];
  onImportFiles: (files: File[]) => Promise<EvidenceItem[]>;
  onDeduplicate?: () => Promise<number>;
  onCreateTableIOCs?: (item: EvidenceItem, candidates: EvidenceTableIOCCandidate[]) => Promise<number>;
  onOpenChat: () => void;
  onAnalyzeImage?: (item: EvidenceItem) => void;
}

interface MetadataRow {
  label: string;
  value?: string;
}

interface TableEvidence {
  title: string;
  headers: string[];
  rows: string[][];
  totalRows: number;
  columnCount: number;
}

interface CompiledInspectSearch {
  query: string;
  terms: string[];
  matches: (text: string) => boolean;
}

interface SearchEntryPreview {
  text: string;
  matchCount: number;
  totalCount: number;
}

interface ReadableEvidencePreview {
  text: string;
  truncated: boolean;
  lowConfidence: boolean;
  hiddenNoisyText: boolean;
  totalLines: number;
  shownLines: number;
}

type SearchNode =
  | { type: 'term'; value: string }
  | { type: 'and' | 'or'; left: SearchNode; right: SearchNode };

type SearchToken =
  | { type: 'term'; value: string }
  | { type: 'and' | 'or' | 'lparen' | 'rparen' };

const TABLE_PREVIEW_ROWS = 120;
const TABLE_PREVIEW_COLUMNS = 12;
const TABLE_PREVIEW_LIMITS = [50, 120, 500];
const TABLE_PARSE_MAX_LINES = 1500;
const TABLE_PARSE_MAX_CHARS = 250_000;
const RAW_INSPECT_MAX_CHARS = 120_000;
const SEARCH_CONTENT_MAX_CHARS = 200_000;
const MAX_HIGHLIGHT_MATCHES = 300;
const INSPECT_SEARCH_DEBOUNCE_MS = 800;
const MIN_INSPECT_SEARCH_CHARS = 2;
const VALID_RASTER_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/avif']);

export function EvidenceView({
  folderId,
  folderName,
  items,
  onImportFiles,
  onDeduplicate,
  onCreateTableIOCs,
  onOpenChat,
  onAnalyzeImage,
}: EvidenceViewProps) {
  const { t } = useTranslation('evidence');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inspectScrollRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deduping, setDeduping] = useState(false);
  const [creatingTableIOCs, setCreatingTableIOCs] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [evidenceQuery, setEvidenceQuery] = useState('');
  const [inspectQuery, setInspectQuery] = useState('');
  const [debouncedInspectQuery, setDebouncedInspectQuery] = useState('');
  const [inspectFilterMode, setInspectFilterMode] = useState(false);
  const [activeInspectHitIndex, setActiveInspectHitIndex] = useState(0);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [selectedTableIndex, setSelectedTableIndex] = useState(0);
  const [tableRowLimit, setTableRowLimit] = useState(TABLE_PREVIEW_ROWS);

  const visibleItems = useMemo(
    () => items
      .filter((item) => !item.trashed && !item.archived)
      .sort((a, b) => b.updatedAt - a.updatedAt),
    [items],
  );

  const filteredItems = useMemo(() => {
    const query = evidenceQuery.trim().toLowerCase();
    if (!query) return visibleItems;
    return visibleItems.filter((item) => evidenceSearchText(item).includes(query));
  }, [evidenceQuery, visibleItems]);

  const selectedItem = filteredItems.find((item) => item.id === selectedId) || filteredItems[0];
  const duplicateCount = useMemo(() => findDuplicateEvidenceItemIds(items, folderId).length, [folderId, items]);
  const metadataRows = useMemo(() => selectedItem ? buildMetadataRows(selectedItem, t) : [], [selectedItem, t]);
  const extractedText = selectedItem ? getExtractedText(selectedItem.content) : '';
  const tables = useMemo(() => selectedItem ? extractStructuredTables(selectedItem, t) : [], [selectedItem, t]);
  const tableIOCCandidates = useMemo(() => selectedItem ? extractEvidenceTableIOCCandidates(selectedItem.content) : [], [selectedItem]);
  const artifactSignals = useMemo(() => selectedItem ? buildArtifactSignals(selectedItem, t) : [], [selectedItem, t]);
  const rawInspect = useMemo(() => selectedItem ? capPreviewText(selectedItem.content, RAW_INSPECT_MAX_CHARS) : { text: '', truncated: false }, [selectedItem]);
  const readablePreview = useMemo(
    () => selectedItem ? buildReadableEvidencePreview(selectedItem, extractedText) : emptyReadablePreview(),
    [extractedText, selectedItem],
  );
  const compiledInspectSearch = useMemo(() => compileInspectSearch(debouncedInspectQuery), [debouncedInspectQuery]);
  const readableSearchPreview = useMemo(
    () => inspectFilterMode && compiledInspectSearch
      ? filterTextEntries(readablePreview.text, compiledInspectSearch)
      : { text: readablePreview.text, matchCount: 0, totalCount: 0 },
    [compiledInspectSearch, inspectFilterMode, readablePreview.text],
  );
  const rawInspectSearchPreview = useMemo(
    () => inspectFilterMode && compiledInspectSearch
      ? filterTextEntries(rawInspect.text, compiledInspectSearch)
      : { text: rawInspect.text, matchCount: 0, totalCount: 0 },
    [compiledInspectSearch, inspectFilterMode, rawInspect.text],
  );
  const activeTableIndex = tables.length > 0 ? Math.min(selectedTableIndex, tables.length - 1) : 0;
  const activeTable = tables[activeTableIndex];
  const tableRows = useMemo(() => {
    if (!activeTable) return [];
    const rows = inspectFilterMode && compiledInspectSearch
      ? activeTable.rows.filter((row) => compiledInspectSearch.matches(row.join(' ')))
      : activeTable.rows;
    return rows.slice(0, tableRowLimit);
  }, [activeTable, compiledInspectSearch, inspectFilterMode, tableRowLimit]);
  const shouldShowReadablePreview = Boolean(
    selectedItem &&
    selectedItem.fileType !== 'image' &&
    (readablePreview.text.trim() || readablePreview.lowConfidence) &&
    !activeTable,
  );
  const shouldHideRawLowConfidencePdf = Boolean(
    selectedItem?.fileType === 'pdf' &&
    readablePreview.lowConfidence &&
    shouldShowReadablePreview,
  );
  const inspectSearchText = useMemo(() => {
    if (!selectedItem) return '';
    if (activeTable) return renderVisibleTableText(activeTable.headers, tableRows, activeTable.columnCount);
    if (inspectFilterMode && compiledInspectSearch) {
      return shouldShowReadablePreview ? readableSearchPreview.text : rawInspectSearchPreview.text;
    }
    return readablePreview.text || rawInspect.text;
  }, [activeTable, compiledInspectSearch, inspectFilterMode, rawInspect.text, rawInspectSearchPreview.text, readablePreview.text, readableSearchPreview.text, selectedItem, shouldShowReadablePreview, tableRows]);
  const inspectMatches = selectedItem && compiledInspectSearch ? countSearchMatches(inspectSearchText, compiledInspectSearch) : 0;
  const inspectSearchPending = Boolean(
    normalizeInspectSearchQuery(inspectQuery) &&
    normalizeInspectSearchQuery(inspectQuery) !== debouncedInspectQuery,
  );

  useEffect(() => {
    const normalized = normalizeInspectSearchQuery(inspectQuery);
    if (!normalized) {
      setDebouncedInspectQuery('');
      return;
    }

    const timer = window.setTimeout(() => {
      setDebouncedInspectQuery(normalized);
    }, INSPECT_SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [inspectQuery]);

  useEffect(() => {
    setActiveInspectHitIndex(0);
  }, [debouncedInspectQuery, inspectFilterMode, selectedItem?.id, activeTableIndex]);

  useEffect(() => {
    if (inspectMatches > 0 && activeInspectHitIndex >= inspectMatches) {
      setActiveInspectHitIndex(0);
    }
  }, [activeInspectHitIndex, inspectMatches]);

  useEffect(() => {
    if (!compiledInspectSearch || inspectMatches === 0) return;
    const scrollToActiveHit = () => {
      const hits = Array.from(inspectScrollRef.current?.querySelectorAll<HTMLElement>('[data-evidence-inspect-hit="true"]') || []);
      hits.forEach((hit) => hit.removeAttribute('data-evidence-inspect-active'));
      if (hits.length === 0) return;
      const target = hits[Math.min(activeInspectHitIndex, hits.length - 1)];
      target.setAttribute('data-evidence-inspect-active', 'true');
      target.scrollIntoView({ block: 'center', inline: 'nearest' });
    };

    if (typeof window.requestAnimationFrame === 'function') {
      const frame = window.requestAnimationFrame(scrollToActiveHit);
      return () => {
        if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(frame);
      };
    }

    const timer = window.setTimeout(scrollToActiveHit, 0);
    return () => window.clearTimeout(timer);
  }, [activeInspectHitIndex, activeTableIndex, compiledInspectSearch, inspectMatches, selectedItem?.id, tableRowLimit]);

  const handleFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (!folderId || files.length === 0 || importing) return;
    if (files.length > MAX_EVIDENCE_IMPORT_FILES) {
      setError(t('toast.tooManyFiles', { count: MAX_EVIDENCE_IMPORT_FILES }));
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setImporting(true);
    setError(null);
    try {
      await onImportFiles(files);
    } catch (err) {
      console.error('Failed to import evidence:', err);
      setError(formatEvidenceImportError(err, t));
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeduplicate = async () => {
    if (!onDeduplicate || deduping) return;
    setDeduping(true);
    setError(null);
    try {
      await onDeduplicate();
    } catch (err) {
      console.error('Failed to deduplicate evidence:', err);
      setError(err instanceof Error ? err.message : t('toast.dedupeFailed'));
    } finally {
      setDeduping(false);
    }
  };

  const handleCreateTableIOCs = async () => {
    if (!selectedItem || !onCreateTableIOCs || tableIOCCandidates.length === 0 || creatingTableIOCs) return;
    setCreatingTableIOCs(true);
    setError(null);
    try {
      const created = await onCreateTableIOCs(selectedItem, tableIOCCandidates);
      setCopiedKey('table-iocs-created');
      window.setTimeout(() => setCopiedKey((current) => current === 'table-iocs-created' ? null : current), 1400);
      if (created === 0) setError(t('toast.noNewIocs'));
    } catch (err) {
      console.error('Failed to create table IOCs:', err);
      setError(err instanceof Error ? err.message : t('toast.tableIocsFailed'));
    } finally {
      setCreatingTableIOCs(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    if (event.dataTransfer.files.length) {
      void handleFiles(event.dataTransfer.files);
    }
  };

  const handleCopy = async (key: string, value: string) => {
    if (!value.trim()) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((current) => current === key ? null : current), 1400);
    } catch {
      setError(t('toast.clipboardFailed'));
    }
  };

  const handleInspectSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const normalized = normalizeInspectSearchQuery(inspectQuery);
    if (!normalized) return;
    if (normalized === debouncedInspectQuery && inspectMatches > 0) {
      handleInspectHitNavigation(event.shiftKey ? -1 : 1);
      return;
    }
    setDebouncedInspectQuery(normalized);
    setActiveInspectHitIndex(0);
  };

  const handleInspectHitNavigation = (direction: -1 | 1) => {
    if (!compiledInspectSearch || inspectMatches === 0) return;
    setActiveInspectHitIndex((current) => (current + direction + inspectMatches) % inspectMatches);
  };

  return (
    <div className="flex-1 overflow-hidden flex flex-col bg-bg-primary">
      <header className="shrink-0 border-b border-border-subtle px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <FileSearch size={20} className="text-accent-blue shrink-0" />
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-text-primary">{t('header.title')}</h1>
            <p className="text-xs text-text-muted truncate">
              {folderName ? folderName : t('header.selectInvestigation')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void handleDeduplicate()}
            disabled={!folderId || !onDeduplicate || importing || deduping}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border-subtle text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title={duplicateCount > 0 ? t('actions.duplicatesDetected', { count: duplicateCount }) : t('actions.deduplicateTitle')}
          >
            {deduping ? <Loader2 size={14} className="animate-spin" /> : <CopyX size={14} />}
            {t('actions.deduplicate')}
            {duplicateCount > 0 && <span className="rounded bg-accent-blue/15 px-1 text-[10px] text-accent-blue">{duplicateCount}</span>}
          </button>
          <button
            onClick={onOpenChat}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border-subtle text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            <MessageSquare size={14} />
            {t('actions.caddyAI')}
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!folderId || importing}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
              folderId && !importing
                ? 'bg-accent-blue text-white hover:bg-accent-blue/90'
                : 'bg-bg-raised text-text-muted cursor-not-allowed',
            )}
          >
            {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {importing ? t('actions.importing') : t('actions.import')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={EVIDENCE_ACCEPT}
            onChange={(event) => { if (event.target.files) void handleFiles(event.target.files); }}
            className="hidden"
          />
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4">
        {!folderId ? (
          <div className="h-full min-h-[320px] flex items-center justify-center">
            <div className="text-center max-w-sm">
              <FileSearch size={40} className="mx-auto mb-3 text-text-muted" />
              <h2 className="text-sm font-semibold text-text-primary">{t('empty.noInvestigation')}</h2>
              <p className="mt-1 text-xs text-text-muted">{t('empty.noInvestigationDesc')}</p>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-6xl space-y-4">
            <div
              onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); setDragging(true); }}
              onDragLeave={(event) => { event.stopPropagation(); setDragging(false); }}
              onDrop={handleDrop}
              className={cn(
                'border border-dashed rounded-lg px-4 py-5 flex flex-col sm:flex-row items-center gap-3 transition-colors',
                dragging ? 'border-accent-blue bg-accent-blue/10' : 'border-border-medium bg-bg-surface',
              )}
            >
              <div className="h-10 w-10 rounded-md bg-accent-blue/10 text-accent-blue flex items-center justify-center shrink-0">
                <Upload size={18} />
              </div>
              <div className="min-w-0 flex-1 text-center sm:text-start">
                <div className="text-sm font-medium text-text-primary">{t('dropzone.label')}</div>
                <div className="mt-0.5 text-xs text-text-muted">{t('dropzone.hint', { count: MAX_EVIDENCE_IMPORT_FILES })}</div>
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border-subtle text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-hover disabled:opacity-50 transition-colors"
              >
                {t('dropzone.browse')}
              </button>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <section>
              <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-xs font-semibold uppercase text-text-muted">{t('section.importedEvidence')}</h2>
                  <span className="text-xs text-text-muted">
                    {filteredItems.length === visibleItems.length ? visibleItems.length : `${filteredItems.length} / ${visibleItems.length}`}
                  </span>
                </div>
                <div className="relative w-full sm:w-72">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                  <input
                    value={evidenceQuery}
                    onChange={(event) => setEvidenceQuery(event.target.value)}
                    aria-label={t('search.ariaLabel')}
                    placeholder={t('search.placeholder')}
                    className="w-full rounded-md border border-border-subtle bg-bg-surface py-1.5 ps-8 pe-8 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue"
                  />
                  {evidenceQuery && (
                    <button
                      onClick={() => setEvidenceQuery('')}
                      aria-label={t('search.clear')}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-text-muted hover:text-text-primary hover:bg-bg-hover"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              </div>

              {visibleItems.length === 0 ? (
                <div className="rounded-lg border border-border-subtle bg-bg-surface p-8 text-center">
                  <FileText size={36} className="mx-auto mb-3 text-text-muted" />
                  <h3 className="text-sm font-semibold text-text-primary">{t('empty.noEvidence')}</h3>
                  <p className="mt-1 text-xs text-text-muted">{t('empty.noEvidenceDesc')}</p>
                </div>
              ) : (
                <div className="grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(380px,1.1fr)]">
                  <div className="space-y-2">
                    {filteredItems.length === 0 ? (
                      <div className="rounded-lg border border-border-subtle bg-bg-surface p-8 text-center">
                        <Search size={32} className="mx-auto mb-3 text-text-muted" />
                        <h3 className="text-sm font-semibold text-text-primary">{t('empty.noMatches')}</h3>
                        <p className="mt-1 text-xs text-text-muted">{t('empty.noMatchesDesc')}</p>
                      </div>
                    ) : filteredItems.map((item) => (
                      <article
                        key={item.id}
                        className={cn(
                          'rounded-lg border bg-bg-surface p-3 hover:border-border-medium transition-colors',
                          selectedItem?.id === item.id ? 'border-accent-blue/60' : 'border-border-subtle',
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <div className="h-9 w-9 rounded-md bg-bg-raised text-accent-blue flex items-center justify-center shrink-0">
                            {evidenceIcon(item)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-sm font-medium text-text-primary truncate max-w-full">{item.title}</h3>
                              <span className="text-[10px] rounded-full bg-accent-blue/10 text-accent-blue px-1.5 py-0.5">
                                {item.fileType}
                              </span>
                              {item.chunkCount > 1 && (
                                <span className="text-[10px] rounded-full bg-bg-raised text-text-muted px-1.5 py-0.5">
                                  {item.chunkIndex}/{item.chunkCount}
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-xs text-text-muted line-clamp-2">
                              {previewText(item.content, t)}
                            </p>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
                              <span>{formatDate(item.updatedAt)}</span>
                              <span>{item.fileName}</span>
                              {item.imageWidth && item.imageHeight && <span>{t('card.dimensions', { width: item.imageWidth, height: item.imageHeight })}</span>}
                            </div>
                          </div>
                          <button
                            onClick={() => {
                              setSelectedId(item.id);
                              setSelectedTableIndex(0);
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border-subtle text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors shrink-0"
                          >
                            <Eye size={12} />
                            {t('card.inspect')}
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>

                  {selectedItem && (
                    <aside className="rounded-lg border border-border-subtle bg-bg-surface min-h-[380px] max-h-[760px] overflow-hidden flex flex-col">
                      <div className="border-b border-border-subtle px-3 py-2 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="text-sm font-semibold text-text-primary truncate">{selectedItem.title}</h3>
                            <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-text-muted">
                              <span>{selectedItem.extractionStatus}</span>
                              <span>{formatBytes(selectedItem.size)}</span>
                              {selectedItem.linkedIOCIds && selectedItem.linkedIOCIds.length > 0 && (
                                <span>{t('inspect.iocCount', { count: selectedItem.linkedIOCIds.length })}</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => void handleCopy('metadata', renderMetadataText(selectedItem, t))}
                              aria-label={t('actions.copyMetadataAria')}
                              title={t('actions.copyMetadata')}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border-subtle text-text-secondary hover:text-text-primary hover:bg-bg-hover"
                            >
                              {copiedKey === 'metadata' ? <Check size={13} /> : <Copy size={13} />}
                            </button>
                            <button
                              onClick={() => void handleCopy('text', extractedText)}
                              aria-label={t('actions.copyTextAria')}
                              title={t('actions.copyText')}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border-subtle text-text-secondary hover:text-text-primary hover:bg-bg-hover"
                            >
                              {copiedKey === 'text' ? <Check size={13} /> : <FileText size={13} />}
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <div className="relative min-w-0 flex-1">
                            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                            <input
                              value={inspectQuery}
                              onChange={(event) => setInspectQuery(event.target.value)}
                              onKeyDown={handleInspectSearchKeyDown}
                              aria-label={t('inspectSearch.ariaLabel')}
                              placeholder={t('inspectSearch.placeholder')}
                              className="w-full rounded-md border border-border-subtle bg-bg-primary py-1.5 ps-8 pe-16 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue"
                            />
                            <span className="absolute right-8 top-1/2 -translate-y-1/2 text-[10px] text-text-muted">
                              {inspectSearchPending
                                ? '...'
                                : compiledInspectSearch && inspectMatches > 0
                                  ? `${Math.min(activeInspectHitIndex + 1, inspectMatches)}/${inspectMatches}`
                                  : '0'}
                            </span>
                            {inspectQuery && (
                              <button
                                onClick={() => setInspectQuery('')}
                                aria-label={t('inspectSearch.clear')}
                                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-text-muted hover:text-text-primary hover:bg-bg-hover"
                              >
                                <X size={12} />
                              </button>
                            )}
                          </div>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={inspectFilterMode}
                            aria-label={t('inspectSearch.filterAria')}
                            title={t('inspectSearch.filterTitle')}
                            onClick={() => setInspectFilterMode((current) => !current)}
                            className={cn(
                              'relative h-7 w-11 shrink-0 rounded-full border transition-colors',
                              inspectFilterMode
                                ? 'border-accent-blue/70 bg-accent-blue/25'
                                : 'border-border-subtle bg-bg-primary hover:bg-bg-hover',
                            )}
                          >
                            <span
                              className={cn(
                                'absolute left-1 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full transition-transform',
                                inspectFilterMode
                                  ? 'translate-x-5 bg-accent-blue'
                                  : 'translate-x-0 bg-text-muted',
                              )}
                            />
                          </button>
                          <div className="flex shrink-0 items-center gap-0.5">
                            <button
                              type="button"
                              onClick={() => handleInspectHitNavigation(-1)}
                              disabled={!compiledInspectSearch || inspectMatches === 0}
                              aria-label={t('inspectSearch.prevAria')}
                              title={t('inspectSearch.prevTitle')}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border-subtle text-text-secondary hover:text-text-primary hover:bg-bg-hover disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <ArrowUp size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleInspectHitNavigation(1)}
                              disabled={!compiledInspectSearch || inspectMatches === 0}
                              aria-label={t('inspectSearch.nextAria')}
                              title={t('inspectSearch.nextTitle')}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border-subtle text-text-secondary hover:text-text-primary hover:bg-bg-hover disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <ArrowDown size={13} />
                            </button>
                          </div>
                        </div>
                      </div>

                      <div ref={inspectScrollRef} className="flex-1 overflow-auto">
                        <section className="border-b border-border-subtle px-3 py-3">
                          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                            {metadataRows.map((row) => (
                              <div key={row.label} className="min-w-0">
                                <div className="text-[10px] uppercase text-text-muted">{row.label}</div>
                                <div className="mt-0.5 truncate text-xs text-text-secondary">{row.value || '-'}</div>
                              </div>
                            ))}
                          </div>
                        </section>

                        {selectedItem.fileType === 'image' && (
                          <section className="border-b border-border-subtle px-3 py-3 space-y-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 text-xs font-semibold text-text-primary">
                                <ImageIcon size={14} className="text-accent-blue" />
                                {t('image.details')}
                              </div>
                              <div className="flex items-center gap-1">
                                {hasRenderableImagePayload(selectedItem) && onAnalyzeImage && (
                                  <button
                                    onClick={() => onAnalyzeImage(selectedItem)}
                                    aria-label={t('image.analyzeAria')}
                                    className="inline-flex items-center gap-1.5 rounded-md border border-accent-blue/50 bg-accent-blue/10 px-2 py-1 text-[11px] text-accent-blue hover:bg-accent-blue/15"
                                  >
                                    <MessageSquare size={12} />
                                    {t('image.analyze')}
                                  </button>
                                )}
                                <button
                                  onClick={() => void handleCopy('image-prompt', buildImageAnalysisPrompt(selectedItem, t))}
                                  aria-label={t('image.copyPromptAria')}
                                  className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle px-2 py-1 text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-hover"
                                >
                                  {copiedKey === 'image-prompt' ? <Check size={12} /> : <Copy size={12} />}
                                  {t('image.prompt')}
                                </button>
                              </div>
                            </div>
                            {hasRenderableImagePayload(selectedItem) ? (
                              <div className="overflow-hidden rounded-md border border-border-subtle bg-bg-primary">
                                <img
                                  src={`data:${selectedItem.imageDataMimeType};base64,${selectedItem.imageData}`}
                                  alt={selectedItem.fileName}
                                  className="max-h-72 w-full object-contain"
                                />
                              </div>
                            ) : (
                              <div className="border border-border-subtle bg-bg-primary px-3 py-3 text-xs text-text-muted">
                                {t('image.noPayload')}
                              </div>
                            )}
                          </section>
                        )}

                        {activeTable && (
                          <section className="border-b border-border-subtle px-3 py-3 space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2 text-xs font-semibold text-text-primary">
                                <Table2 size={14} className="text-accent-blue" />
                                {t('table.preview')}
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[11px] text-text-muted">
                                  {t('table.rowsColumns', { shown: tableRows.length, total: activeTable.rows.length, columns: activeTable.columnCount })}
                                </span>
                                <select
                                  value={tableRowLimit}
                                  onChange={(event) => setTableRowLimit(Number(event.target.value))}
                                  aria-label={t('table.rowLimitAria')}
                                  className="h-7 rounded-md border border-border-subtle bg-bg-primary px-2 text-[11px] text-text-secondary outline-none focus:border-accent-blue"
                                >
                                  {TABLE_PREVIEW_LIMITS.map((limit) => (
                                    <option key={limit} value={limit}>{t('table.rowsOption', { count: limit })}</option>
                                  ))}
                                </select>
                                <button
                                  onClick={() => void handleCopy(`table-${activeTableIndex}`, renderTableText(activeTable))}
                                  aria-label={t('table.copyAria')}
                                  title={t('table.copyTitle')}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border-subtle text-text-secondary hover:text-text-primary hover:bg-bg-hover"
                                >
                                  {copiedKey === `table-${activeTableIndex}` ? <Check size={12} /> : <Copy size={12} />}
                                </button>
                              </div>
                            </div>
                            {tables.length > 1 && (
                              <div className="flex flex-wrap gap-1">
                                {tables.map((table, index) => (
                                  <button
                                    key={`${table.title}-${index}`}
                                    onClick={() => setSelectedTableIndex(index)}
                                    className={cn(
                                      'rounded-md border px-2 py-1 text-[11px] transition-colors',
                                      activeTableIndex === index
                                        ? 'border-accent-blue/60 bg-accent-blue/10 text-accent-blue'
                                        : 'border-border-subtle text-text-secondary hover:text-text-primary hover:bg-bg-hover',
                                    )}
                                  >
                                    {table.title}
                                  </button>
                                ))}
                              </div>
                            )}
                            <div className="max-h-80 overflow-auto border border-border-subtle bg-bg-primary">
                              <table className="min-w-full border-collapse text-left text-xs">
                                <thead className="sticky top-0 bg-bg-raised text-text-muted">
                                  <tr>
                                    {activeTable.headers.slice(0, TABLE_PREVIEW_COLUMNS).map((header, index) => (
                                      <th key={`${header}-${index}`} className="border-b border-border-subtle px-2 py-1.5 font-medium">
                                        {highlightText(header || t('table.columnFallback', { index: index + 1 }), compiledInspectSearch)}
                                      </th>
                                    ))}
                                    {activeTable.columnCount > TABLE_PREVIEW_COLUMNS && (
                                      <th className="border-b border-border-subtle px-2 py-1.5 font-medium">...</th>
                                    )}
                                  </tr>
                                </thead>
                                <tbody>
                                  {tableRows.length === 0 ? (
                                    <tr>
                                      <td className="px-2 py-3 text-text-muted" colSpan={Math.min(activeTable.columnCount, TABLE_PREVIEW_COLUMNS) || 1}>
                                        {inspectFilterMode ? t('table.noRowsMatch') : t('table.noRows')}
                                      </td>
                                    </tr>
                                  ) : tableRows.map((row, rowIndex) => (
                                    <tr key={rowIndex} className="border-b border-border-subtle/60 last:border-0">
                                      {normalizeRow(row, activeTable.columnCount).slice(0, TABLE_PREVIEW_COLUMNS).map((cell, cellIndex) => (
                                        <td key={`${rowIndex}-${cellIndex}`} className="max-w-60 px-2 py-1.5 align-top text-text-secondary">
                                          <span className="line-clamp-3 break-words">{highlightText(cell, compiledInspectSearch)}</span>
                                        </td>
                                      ))}
                                      {activeTable.columnCount > TABLE_PREVIEW_COLUMNS && (
                                        <td className="px-2 py-1.5 text-text-muted">...</td>
                                      )}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            {(activeTable.rows.length > tableRowLimit || tableRows.length === tableRowLimit) && (
                              <div className="text-[11px] text-text-muted">
                                {t('table.cappedAt', { count: tableRowLimit })}
                              </div>
                            )}
                          </section>
                        )}

                        {shouldShowReadablePreview && selectedItem && (
                          <section className="border-b border-border-subtle px-3 py-3 space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2 text-xs font-semibold text-text-primary">
                                <FileText size={14} className="text-accent-blue" />
                                {readablePreviewTitle(selectedItem, t)}
                              </div>
                              <button
                                onClick={() => void handleCopy('readable-preview', extractedText)}
                                aria-label={t('readable.copyAria')}
                                title={t('readable.copyTitle')}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border-subtle text-text-secondary hover:text-text-primary hover:bg-bg-hover"
                              >
                                {copiedKey === 'readable-preview' ? <Check size={12} /> : <Copy size={12} />}
                              </button>
                            </div>
                            {readablePreview.lowConfidence && (
                              <div className="rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-100">
                                {t('readable.lowConfidence')}
                              </div>
                            )}
                            <div className="space-y-3 text-xs leading-6 text-text-secondary">
                              {renderReadableTextPreview(
                                inspectFilterMode && compiledInspectSearch
                                  ? readableSearchPreview.text || t('readable.noMatchingLines')
                                  : readablePreview.text || t('readable.noCleanText'),
                                compiledInspectSearch,
                                inspectFilterMode || readablePreview.lowConfidence,
                                t,
                              )}
                            </div>
                            {inspectFilterMode && compiledInspectSearch && (
                              <div className="rounded-md border border-border-subtle bg-bg-primary px-3 py-2 text-[11px] text-text-muted">
                                {t('readable.visibleMatches', { matchCount: readableSearchPreview.matchCount, count: readableSearchPreview.totalCount })}
                              </div>
                            )}
                            {readablePreview.hiddenNoisyText && (
                              <div className="rounded-md border border-border-subtle bg-bg-primary px-3 py-2 text-[11px] text-text-muted">
                                {t('readable.hiddenNoisy', { count: readablePreview.shownLines, total: readablePreview.totalLines, totalS: readablePreview.totalLines === 1 ? '' : 's' })}
                              </div>
                            )}
                            {readablePreview.truncated && (
                              <div className="rounded-md border border-border-subtle bg-bg-primary px-3 py-2 text-[11px] text-text-muted">
                                {t('readable.truncated', { size: formatBytes(RAW_INSPECT_MAX_CHARS) })}
                              </div>
                            )}
                          </section>
                        )}

                        {artifactSignals.length > 0 && (
                          <section className="border-b border-border-subtle px-3 py-3 space-y-2">
                            <div className="flex items-center gap-2 text-xs font-semibold text-text-primary">
                              <FileSearch size={14} className="text-accent-blue" />
                              {t('signals.title')}
                            </div>
                            <div className="space-y-1">
                              {artifactSignals.map((signal, index) => (
                                <div key={index} className="rounded-md border border-border-subtle bg-bg-primary px-2 py-1.5 text-[11px] text-text-secondary">
                                  {signal}
                                </div>
                              ))}
                            </div>
                          </section>
                        )}

                        {tableIOCCandidates.length > 0 && (
                          <section className="border-b border-border-subtle px-3 py-3 space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2 text-xs font-semibold text-text-primary">
                                <Table2 size={14} className="text-accent-blue" />
                                {t('tableIOC.title')}
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => void handleCopy('table-iocs', renderEvidenceTableIOCCandidatesText(tableIOCCandidates))}
                                  aria-label={t('tableIOC.copyAria')}
                                  title={t('tableIOC.copyTitle')}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border-subtle text-text-secondary hover:text-text-primary hover:bg-bg-hover"
                                >
                                  {copiedKey === 'table-iocs' ? <Check size={12} /> : <Copy size={12} />}
                                </button>
                                {onCreateTableIOCs && (
                                  <button
                                    onClick={() => void handleCreateTableIOCs()}
                                    disabled={creatingTableIOCs}
                                    className="inline-flex items-center gap-1.5 rounded-md border border-accent-blue/50 bg-accent-blue/10 px-2 py-1 text-[11px] text-accent-blue hover:bg-accent-blue/15 disabled:opacity-60"
                                  >
                                    {creatingTableIOCs ? <Loader2 size={12} className="animate-spin" /> : copiedKey === 'table-iocs-created' ? <Check size={12} /> : <Plus size={12} />}
                                    {t('tableIOC.add')}
                                  </button>
                                )}
                              </div>
                            </div>
                            <div className="space-y-2">
                              {tableIOCCandidates.slice(0, 12).map((candidate) => (
                                <div key={`${candidate.type}:${candidate.value}`} className="rounded-md border border-border-subtle bg-bg-primary px-2 py-1.5">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="rounded bg-accent-blue/10 px-1.5 py-0.5 text-[10px] uppercase text-accent-blue">{candidate.type}</span>
                                    <code className="break-all text-xs text-text-primary">{candidate.value}</code>
                                  </div>
                                  <div className="mt-1 text-[11px] text-text-muted">
                                    {t('tableIOC.sourceRow', { source: candidate.sourceTable, row: candidate.rowIndex })}
                                  </div>
                                </div>
                              ))}
                              {tableIOCCandidates.length > 12 && (
                                <div className="text-[11px] text-text-muted">
                                  {t('tableIOC.showing', { count: tableIOCCandidates.length })}
                                </div>
                              )}
                            </div>
                          </section>
                        )}

                        {shouldHideRawLowConfidencePdf && !inspectFilterMode && (
                          <section className="px-3 py-3">
                            <div className="rounded-md border border-border-subtle bg-bg-primary px-3 py-2 text-[11px] leading-relaxed text-text-muted">
                              {t('raw.hiddenLowConfidence')}
                            </div>
                          </section>
                        )}

                        {!shouldHideRawLowConfidencePdf && !(inspectFilterMode && shouldShowReadablePreview) && (
                          <section className="px-3 py-3">
                            <div className="mb-2 text-xs font-semibold text-text-primary">{t('raw.title')}</div>
                            <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-text-secondary font-mono">
                              {highlightText(
                                inspectFilterMode && compiledInspectSearch
                                  ? rawInspectSearchPreview.text || t('raw.noMatchingLines')
                                  : rawInspect.text,
                                shouldShowReadablePreview ? null : compiledInspectSearch,
                              )}
                            </pre>
                            {inspectFilterMode && compiledInspectSearch && (
                              <div className="mt-3 rounded-md border border-border-subtle bg-bg-primary px-3 py-2 text-[11px] text-text-muted">
                                {t('raw.matches', { matchCount: rawInspectSearchPreview.matchCount, count: rawInspectSearchPreview.totalCount })}
                              </div>
                            )}
                            {rawInspect.truncated && (
                              <div className="mt-3 rounded-md border border-border-subtle bg-bg-primary px-3 py-2 text-[11px] text-text-muted">
                                {t('raw.truncated', { size: formatBytes(RAW_INSPECT_MAX_CHARS) })}
                              </div>
                            )}
                          </section>
                        )}
                      </div>
                    </aside>
                  )}
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

function evidenceIcon(item: EvidenceItem): ReactNode {
  if (item.fileType === 'image') return <FileImage size={16} />;
  if (item.fileType === 'xlsx' || item.fileType === 'xls' || item.fileType === 'spreadsheet') return <FileSpreadsheet size={16} />;
  return <FileText size={16} />;
}

function hasRenderableImagePayload(item: EvidenceItem): boolean {
  return Boolean(
    item.imageData &&
    item.imageDataMimeType &&
    VALID_RASTER_IMAGE_MIME_TYPES.has(item.imageDataMimeType.toLowerCase()),
  );
}

function evidenceSearchText(item: EvidenceItem): string {
  return [
    item.title,
    item.fileName,
    item.fileType,
    item.mimeType,
    item.extractionStatus,
    item.extractionWarning,
    item.tags.join(' '),
    item.content.slice(0, SEARCH_CONTENT_MAX_CHARS),
  ].filter(Boolean).join('\n').toLowerCase();
}

function previewText(markdown: string, t: TFunction): string {
  return markdown
    .replace(/^#.+$/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/[#>*_`-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 260) || t('preview.noText');
}

function buildMetadataRows(item: EvidenceItem, t: TFunction): MetadataRow[] {
  return [
    { label: t('meta.fileName'), value: item.fileName },
    { label: t('meta.fileType'), value: item.fileType.toUpperCase() },
    { label: t('meta.mime'), value: item.mimeType || item.imageDataMimeType },
    { label: t('meta.size'), value: formatBytes(item.size) },
    { label: t('meta.imported'), value: formatDate(item.importedAt) },
    { label: t('meta.modified'), value: item.lastModified ? formatDate(item.lastModified) : undefined },
    { label: t('meta.extraction'), value: item.extractionStatus },
    { label: t('meta.parts'), value: t('meta.partsValue', { index: item.chunkIndex || 1, total: item.chunkCount || 1 }) },
    { label: t('meta.imageDimensions'), value: item.imageWidth && item.imageHeight ? t('meta.imageDimensionsValue', { width: item.imageWidth, height: item.imageHeight }) : undefined },
    { label: t('meta.aspectRatio'), value: item.imageAspectRatio },
    { label: t('meta.pixels'), value: item.imagePixelCount ? item.imagePixelCount.toLocaleString() : undefined },
    { label: t('meta.previewPayload'), value: item.imageData ? t('meta.previewPayloadStored') : item.fileType === 'image' ? t('meta.previewPayloadMetadataOnly') : undefined },
  ].filter((row) => row.value !== undefined);
}

function renderMetadataText(item: EvidenceItem, t: TFunction): string {
  return buildMetadataRows(item, t)
    .map((row) => `${row.label}: ${row.value}`)
    .join('\n');
}

function renderTableText(table: TableEvidence): string {
  return [
    table.title,
    table.headers.join('\t'),
    ...table.rows.map((row) => normalizeRow(row, table.columnCount).join('\t')),
  ].join('\n');
}

function renderVisibleTableText(headers: string[], rows: string[][], columnCount: number): string {
  return [
    headers.join('\t'),
    ...rows.map((row) => normalizeRow(row, columnCount).join('\t')),
  ].join('\n');
}

function readablePreviewTitle(item: EvidenceItem, t: TFunction): string {
  if (item.fileType === 'pdf') return t('readable.titlePdf');
  if (item.fileType === 'rtf') return t('readable.titleRtf');
  if (item.fileType === 'doc' || item.fileType === 'docx') return t('readable.titleDocument');
  return t('readable.titleText');
}

function emptyReadablePreview(): ReadableEvidencePreview {
  return {
    text: '',
    truncated: false,
    lowConfidence: false,
    hiddenNoisyText: false,
    totalLines: 0,
    shownLines: 0,
  };
}

function buildReadableEvidencePreview(item: EvidenceItem, extractedText: string): ReadableEvidencePreview {
  const capped = capPreviewText(extractedText, RAW_INSPECT_MAX_CHARS);
  const lines = splitReadableLines(capped.text);
  if (!capped.text.trim()) return emptyReadablePreview();

  if (item.fileType === 'pdf' && looksLikeLowConfidencePdfText(capped.text)) {
    const cleanerLines = lines.filter(isCleanPdfPreviewLine);
    const cleanerText = cleanerLines.join('\n');
    return {
      text: cleanerText,
      truncated: capped.truncated,
      lowConfidence: true,
      hiddenNoisyText: cleanerLines.length < lines.length,
      totalLines: lines.length,
      shownLines: cleanerLines.length,
    };
  }

  return {
    text: capped.text,
    truncated: capped.truncated,
    lowConfidence: false,
    hiddenNoisyText: false,
    totalLines: lines.length,
    shownLines: lines.length,
  };
}

function renderReadableTextPreview(text: string, search: CompiledInspectSearch | null, preserveLines: boolean, t: TFunction): ReactNode[] {
  const blocks = buildReadableTextBlocks(text, preserveLines);
  if (blocks.length === 0) {
    return [(
      <p key="empty" className="text-xs leading-6 text-text-muted">
        {t('readable.noCleanText')}
      </p>
    )];
  }

  return blocks.map((block, index) => {
    if (block.kind === 'heading') {
      return (
        <h4 key={`${block.kind}-${index}`} className="pt-2 text-sm font-semibold leading-6 text-text-primary">
          {highlightText(block.text, search)}
        </h4>
      );
    }
    return (
      <p key={`${block.kind}-${index}`} className="break-words text-xs leading-6 text-text-secondary">
        {highlightText(block.text, search)}
      </p>
    );
  });
}

function buildReadableTextBlocks(text: string, preserveLines: boolean): Array<{ kind: 'heading' | 'paragraph'; text: string }> {
  const blocks: Array<{ kind: 'heading' | 'paragraph'; text: string }> = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    const value = paragraph.join(' ').replace(/\s+/g, ' ').trim();
    if (value) blocks.push({ kind: 'paragraph', text: value });
    paragraph = [];
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      continue;
    }

    const heading = normalizeReadableHeading(line);
    if (heading) {
      flushParagraph();
      blocks.push({ kind: 'heading', text: heading });
      continue;
    }

    if (preserveLines || looksLikeStandaloneEntry(line)) {
      flushParagraph();
      blocks.push({ kind: 'paragraph', text: line });
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return blocks;
}

function normalizeReadableHeading(line: string): string | null {
  const markdownHeading = line.match(/^#{1,6}\s+(.+)$/);
  const candidate = (markdownHeading?.[1] || line)
    .replace(/[:\uFF1A]\s*$/, '')
    .trim();
  if (!candidate || candidate.length > 90) return null;

  if (/^(executive summary|summary|overview|background|key findings|findings|assessment|analysis|recommendations|conclusion|timeline|indicators|iocs?)$/i.test(candidate)) {
    return candidate;
  }

  const words = candidate.split(/\s+/);
  if (words.length <= 8 && words.length > 1) {
    const titleWords = words.filter((word) => /^[A-Z][A-Za-z0-9/&-]*$/.test(word)).length;
    if (titleWords / words.length >= 0.65 && !/[.!?]$/.test(candidate)) return candidate;
  }

  if (candidate.length <= 36 && /^[A-Z0-9][A-Z0-9\s/&-]+$/.test(candidate) && /[A-Z]/.test(candidate)) {
    return candidate;
  }

  return null;
}

function looksLikeStandaloneEntry(line: string): boolean {
  return /^[-*\u2022]\s+/.test(line) ||
    /^\d+[.)]\s+/.test(line) ||
    /\t/.test(line) ||
    /\b(?:https?:\/\/|[a-z0-9.-]+\.[a-z]{2,}|(?:\d{1,3}\.){3}\d{1,3})\b/i.test(line);
}

function looksLikeLowConfidencePdfText(text: string): boolean {
  const lines = splitReadableLines(text);
  if (text.length < 120 || lines.length < 8) return false;

  const chars = Array.from(text);
  const nonAsciiRatio = chars.filter((char) => char.charCodeAt(0) > 127).length / Math.max(chars.length, 1);
  const shortLineRatio = lines.filter((line) => line.length <= 3).length / lines.length;
  const averageLineLength = lines.reduce((sum, line) => sum + line.length, 0) / lines.length;
  const noisyLineRatio = lines.filter((line) => !isCleanPdfPreviewLine(line)).length / lines.length;
  const words = text.match(/[A-Za-z][A-Za-z'-]{2,}/g) || [];
  const compactWords = words.filter((word) => word.length >= 4);

  return nonAsciiRatio > 0.12 ||
    noisyLineRatio > 0.38 ||
    (shortLineRatio > 0.32 && averageLineLength < 18) ||
    (chars.length > 300 && compactWords.length < 12);
}

function isCleanPdfPreviewLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  const chars = Array.from(trimmed);
  const nonAsciiRatio = chars.filter((char) => char.charCodeAt(0) > 127).length / Math.max(chars.length, 1);
  const symbolRatio = chars.filter((char) => !/[\p{L}\p{N}\s.,;:!?()[\]{}'"@/#%&*+=_|<>\u20AC\u00A3\u00A5\\/\-\u2013\u2014]/u.test(char)).length / Math.max(chars.length, 1);
  const words = trimmed.match(/[A-Za-z][A-Za-z'-]{2,}/g) || [];

  if (trimmed.length <= 3) return false;
  if (nonAsciiRatio > 0.18) return false;
  if (symbolRatio > 0.12) return false;
  if (/(.)\1{7,}/.test(trimmed)) return false;
  return trimmed.length >= 16 || words.length >= 2 || /\b(?:https?:\/\/|[a-z0-9.-]+\.[a-z]{2,}|(?:\d{1,3}\.){3}\d{1,3})\b/i.test(trimmed);
}

function splitReadableLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildArtifactSignals(item: EvidenceItem, t: TFunction): string[] {
  const signals: string[] = [];
  const warning = item.extractionWarning || '';
  const content = item.content || '';
  const extracted = getExtractedText(content);

  if (/chart|graph|media|embedded image|table/i.test(warning)) {
    signals.push(warning);
  }
  if (/encoded|garbled|OCR|vision/i.test(warning)) {
    signals.push(t('signals.readableIncomplete'));
  }
  if (item.fileType === 'pdf') {
    signals.push(t('signals.pdfPreview'));
    if (looksLikeLowConfidencePdfText(extracted)) {
      signals.push(t('signals.pdfLowConfidence'));
    }
    if (/chart|graph|figure|table|axis|legend/i.test(extracted)) {
      signals.push(t('signals.pdfVisualReferences'));
    }
  }
  if (/^##\s+Workbook Artifacts\b/im.test(content)) {
    signals.push(t('signals.workbookArtifacts'));
  }
  if ((item.fileType === 'xlsx' || item.fileType === 'xls') && !signals.some((signal) => /chart|workbook/i.test(signal))) {
    signals.push(t('signals.workbookCells'));
  }

  return [...new Set(signals)];
}

function getExtractedText(content: string): string {
  const parts = content.split(/\n## Extracted Text\b/i);
  if (parts.length < 2) return '';
  return parts.slice(1).join('\n## Extracted Text').trim();
}

function extractStructuredTables(item: EvidenceItem, t: TFunction): TableEvidence[] {
  const body = getExtractedText(item.content);
  if (!body || /^No (?:extracted|OCR)/i.test(body.trim())) return [];

  const sections = splitSheetSections(body, t);
  const shouldParse = ['xlsx', 'xls', 'spreadsheet'].includes(item.fileType) || hasTabularRows(body);
  if (!shouldParse) return [];

  const tableSections = sections.length > 0 ? sections : [{ title: item.fileType === 'spreadsheet' ? t('table.defaultTitle') : t('table.sheetTitle'), body }];
  return tableSections
    .map((section) => buildTableEvidence(section.title, section.body, item.fileName, t))
    .filter((table): table is TableEvidence => table !== null);
}

function splitSheetSections(body: string, t: TFunction): Array<{ title: string; body: string }> {
  const matches = Array.from(body.matchAll(/^##\s+(.+)$/gm));
  if (matches.length === 0) return [];
  return matches.map((match, index) => {
    const start = (match.index || 0) + match[0].length;
    const end = matches[index + 1]?.index ?? body.length;
    return {
      title: match[1]?.trim() || t('table.sheetFallback', { index: index + 1 }),
      body: body.slice(start, end).trim(),
    };
  });
}

function buildTableEvidence(title: string, body: string, fileName: string, t: TFunction): TableEvidence | null {
  const parsedRows = parseDelimitedRows(body, fileName);
  if (parsedRows.length === 0) return null;
  const columnCount = Math.max(...parsedRows.map((row) => row.length), 1);
  const hasHeader = parsedRows.length > 1;
  const headers = hasHeader
    ? normalizeRow(parsedRows[0], columnCount).map((header, index) => header || t('table.columnFallback', { index: index + 1 }))
    : Array.from({ length: columnCount }, (_, index) => t('table.columnFallback', { index: index + 1 }));
  const rows = hasHeader ? parsedRows.slice(1) : parsedRows;
  return {
    title,
    headers,
    rows,
    totalRows: parsedRows.length,
    columnCount,
  };
}

function parseDelimitedRows(body: string, fileName: string): string[][] {
  const capped = capPreviewText(body, TABLE_PARSE_MAX_CHARS).text;
  const lines = capped
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() && !line.trim().startsWith('#'))
    .slice(0, TABLE_PARSE_MAX_LINES);
  if (lines.length === 0) return [];

  const delimiter = chooseDelimiter(lines, fileName);
  const parsed = Papa.parse<string[]>(lines.join('\n'), {
    delimiter,
    skipEmptyLines: 'greedy',
  });
  return parsed.data
    .map((row) => row.map((cell) => String(cell ?? '').trim()))
    .filter((row) => row.length > 1 || row.some((cell) => cell.trim()));
}

function chooseDelimiter(lines: string[], fileName: string): ',' | '\t' {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv')) return ',';
  if (lower.endsWith('.tsv')) return '\t';
  const tabLines = lines.filter((line) => line.includes('\t')).length;
  const commaLines = lines.filter((line) => countUnquotedCommas(line) > 0).length;
  return tabLines >= commaLines ? '\t' : ',';
}

function countUnquotedCommas(line: string): number {
  let quoted = false;
  let count = 0;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === ',' && !quoted) {
      count += 1;
    }
  }

  return count;
}

function hasTabularRows(body: string): boolean {
  const lines = capPreviewText(body, TABLE_PARSE_MAX_CHARS).text.split('\n').filter((line) => line.trim());
  const tabRows = lines.filter((line) => line.includes('\t')).length;
  return tabRows >= 2;
}

function normalizeRow(row: string[], columns: number): string[] {
  return Array.from({ length: columns }, (_, index) => row[index] || '');
}

function normalizeInspectSearchQuery(query: string): string {
  const normalized = query.trim();
  return normalized.length >= MIN_INSPECT_SEARCH_CHARS ? normalized : '';
}

function compileInspectSearch(query: string): CompiledInspectSearch | null {
  const normalized = normalizeInspectSearchQuery(query);
  if (!normalized) return null;
  const parsed = parseSearchQuery(normalized) || { type: 'term' as const, value: normalized };
  const terms = uniqueSearchTerms(collectSearchTerms(parsed));
  return {
    query: normalized,
    terms: terms.length > 0 ? terms : [normalized],
    matches: (text: string) => evaluateSearchNode(parsed, text),
  };
}

function filterTextEntries(text: string, search: CompiledInspectSearch): SearchEntryPreview {
  const entries = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim());
  const matched = entries.filter((entry) => search.matches(entry));
  return {
    text: matched.join('\n'),
    matchCount: matched.length,
    totalCount: entries.length,
  };
}

function countSearchMatches(text: string, search: CompiledInspectSearch): number {
  const terms = normalizedHighlightTerms(search);
  if (terms.length === 0) return 0;
  const lower = text.toLowerCase();
  let count = 0;
  let cursor = 0;

  while (cursor < text.length && count < MAX_HIGHLIGHT_MATCHES) {
    const next = findNextSearchMatch(lower, terms, cursor);
    if (!next) break;
    count += 1;
    cursor = next.end;
  }

  return count;
}

function highlightText(text: string, search: CompiledInspectSearch | null): ReactNode {
  if (!search) return text;
  const terms = normalizedHighlightTerms(search);
  if (terms.length === 0) return text;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  while (cursor < text.length && key < MAX_HIGHLIGHT_MATCHES) {
    const match = findNextSearchMatch(lower, terms, cursor);
    if (!match) break;
    if (match.start > cursor) parts.push(text.slice(cursor, match.start));
    parts.push(
      <mark
        key={key}
        data-evidence-inspect-hit="true"
        className="rounded bg-amber-400/25 px-0.5 text-amber-100 scroll-mt-12 data-[evidence-inspect-active=true]:bg-amber-300/45 data-[evidence-inspect-active=true]:ring-1 data-[evidence-inspect-active=true]:ring-amber-200/80"
      >
        {text.slice(match.start, match.end)}
      </mark>,
    );
    key += 1;
    cursor = match.end;
  }

  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

function normalizedHighlightTerms(search: CompiledInspectSearch): string[] {
  return search.terms
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

function findNextSearchMatch(
  lowerText: string,
  lowerTerms: string[],
  start: number,
): { start: number; end: number } | null {
  let bestStart = -1;
  let bestTerm = '';

  for (const term of lowerTerms) {
    const index = lowerText.indexOf(term, start);
    if (index === -1) continue;
    if (bestStart === -1 || index < bestStart || (index === bestStart && term.length > bestTerm.length)) {
      bestStart = index;
      bestTerm = term;
    }
  }

  return bestStart === -1 ? null : { start: bestStart, end: bestStart + bestTerm.length };
}

function parseSearchQuery(query: string): SearchNode | null {
  const tokens = tokenizeSearchQuery(query);
  if (tokens.length === 0) return null;
  let index = 0;

  const peek = () => tokens[index];
  const match = (type: SearchToken['type']) => {
    if (tokens[index]?.type !== type) return false;
    index += 1;
    return true;
  };
  const isPrimaryStart = (token?: SearchToken) => token?.type === 'term' || token?.type === 'lparen';

  const parsePrimary = (): SearchNode | null => {
    const token = peek();
    if (!token) return null;
    if (token.type === 'term') {
      index += 1;
      return { type: 'term', value: token.value };
    }
    if (match('lparen')) {
      const node = parseOr();
      if (!node || !match('rparen')) return null;
      return node;
    }
    return null;
  };

  const parseAnd = (): SearchNode | null => {
    let node = parsePrimary();
    if (!node) return null;
    while (true) {
      if (match('and')) {
        const right = parsePrimary();
        if (!right) return null;
        node = { type: 'and', left: node, right };
        continue;
      }
      if (isPrimaryStart(peek())) {
        const right = parsePrimary();
        if (!right) return null;
        node = { type: 'and', left: node, right };
        continue;
      }
      break;
    }
    return node;
  };

  const parseOr = (): SearchNode | null => {
    let node = parseAnd();
    if (!node) return null;
    while (match('or')) {
      const right = parseAnd();
      if (!right) return null;
      node = { type: 'or', left: node, right };
    }
    return node;
  };

  const parsed = parseOr();
  return parsed && index === tokens.length ? parsed : null;
}

function tokenizeSearchQuery(query: string): SearchToken[] {
  const tokens: SearchToken[] = [];
  let index = 0;

  while (index < query.length) {
    const char = query[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === '(') {
      tokens.push({ type: 'lparen' });
      index += 1;
      continue;
    }
    if (char === ')') {
      tokens.push({ type: 'rparen' });
      index += 1;
      continue;
    }
    if (char === '"') {
      const end = query.indexOf('"', index + 1);
      if (end === -1) {
        tokens.push({ type: 'term', value: query.slice(index + 1).trim() });
        break;
      }
      tokens.push({ type: 'term', value: query.slice(index + 1, end).trim() });
      index = end + 1;
      continue;
    }

    let end = index;
    while (end < query.length && !/\s|[()]/.test(query[end])) end += 1;
    const value = query.slice(index, end).trim();
    const upper = value.toUpperCase();
    if (upper === 'AND') tokens.push({ type: 'and' });
    else if (upper === 'OR') tokens.push({ type: 'or' });
    else if (value) tokens.push({ type: 'term', value });
    index = end;
  }

  return tokens.filter((token) => token.type !== 'term' || Boolean(token.value));
}

function evaluateSearchNode(node: SearchNode, text: string): boolean {
  const lower = text.toLowerCase();
  if (node.type === 'term') return lower.includes(node.value.toLowerCase());
  if (node.type === 'and') return evaluateSearchNode(node.left, text) && evaluateSearchNode(node.right, text);
  return evaluateSearchNode(node.left, text) || evaluateSearchNode(node.right, text);
}

function collectSearchTerms(node: SearchNode): string[] {
  if (node.type === 'term') return [node.value];
  return [...collectSearchTerms(node.left), ...collectSearchTerms(node.right)];
}

function uniqueSearchTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const term of terms) {
    const trimmed = term.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    unique.push(trimmed);
  }
  return unique;
}

function capPreviewText(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

function formatEvidenceImportError(err: unknown, t: TFunction): string {
  const message = err instanceof Error ? err.message : t('toast.importFailed');
  if (/too much recursion|maximum call stack/i.test(message)) {
    return t('toast.importRecursion');
  }
  return message;
}

function buildImageAnalysisPrompt(item: EvidenceItem, t: TFunction): string {
  return [
    t('imagePrompt.intro', { fileName: item.fileName }),
    '',
    t('imagePrompt.instruction'),
    '',
    t('imagePrompt.metadataLabel'),
    renderMetadataText(item, t),
  ].join('\n');
}
