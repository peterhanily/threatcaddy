import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Clipboard, Download, FileOutput, FilePenLine, FileText, Layers, Printer, Search, Settings2, Upload, X } from 'lucide-react';
import type { Note, NoteTemplate } from '../../types';
import { formatDate } from '../../lib/utils';
import { renderMarkdown } from '../../lib/markdown';
import { downloadFile } from '../../lib/export';
import { serializeProductBaselinePackage } from '../../lib/product-baselines';
import { arrayBufferToBase64, buildTemplateBackedDocxBlob, hasDocxTemplateAsset } from '../../lib/docx-template-renderer';
import { Modal } from '../Common/Modal';

interface ProductViewProps {
  folderName?: string;
  products: Note[];
  baselines: NoteTemplate[];
  onOpenSourceNote: (id: string) => void;
  onOpenChat: () => void;
  onImportBaseline?: (json: string, fileName: string) => Promise<NoteTemplate>;
  onUpdateBaseline?: (id: string, updates: Partial<NoteTemplate>) => Promise<void>;
}

export function ProductView({
  folderName,
  products,
  baselines,
  onOpenSourceNote,
  onOpenChat,
  onImportBaseline,
  onUpdateBaseline,
}: ProductViewProps) {
  const { t } = useTranslation('products');
  const [query, setQuery] = useState('');
  const [baselineManagerOpen, setBaselineManagerOpen] = useState(false);
  const [selectedBaselineId, setSelectedBaselineId] = useState<string | null>(baselines[0]?.id ?? null);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [baselineMessage, setBaselineMessage] = useState('');
  const [baselineError, setBaselineError] = useState('');
  const baselineInputRef = useRef<HTMLInputElement>(null);
  const docxTemplateInputRef = useRef<HTMLInputElement>(null);

  const filteredProducts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const activeProducts = products
      .filter((product) => !product.trashed && !product.archived)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    if (!normalized) return activeProducts;
    return activeProducts.filter((product) => [
      product.title,
      product.content,
      product.tags.join(' '),
    ].join('\n').toLowerCase().includes(normalized));
  }, [products, query]);

  const selectedBaseline = useMemo(
    () => baselines.find((baseline) => baseline.id === selectedBaselineId) || baselines[0],
    [baselines, selectedBaselineId],
  );

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedProductId) || null,
    [products, selectedProductId],
  );

  const selectedProductHtml = useMemo(
    () => selectedProduct ? renderMarkdown(selectedProduct.content) : '',
    [selectedProduct],
  );

  const selectedProductBaseline = useMemo(() => {
    if (!selectedProduct) return undefined;
    const baselineTag = selectedProduct.tags.find((tag) => tag.startsWith('baseline:'));
    const baselineId = baselineTag?.slice('baseline:'.length);
    if (!baselineId) return undefined;
    return baselines.find((baseline) => baseline.id === baselineId);
  }, [baselines, selectedProduct]);

  const handleDownloadMarkdown = () => {
    if (!selectedProduct) return;
    downloadFile(selectedProduct.content, `${safeFilename(selectedProduct.title)}.md`, 'text/markdown;charset=utf-8');
  };

  const handleDownloadBaselinePackage = () => {
    if (!selectedBaseline) return;
    downloadFile(
      serializeProductBaselinePackage(selectedBaseline),
      `${safeFilename(selectedBaseline.name)}.tc-product-baseline.json`,
      'application/json;charset=utf-8',
    );
  };

  const handleDownloadDocx = () => {
    if (!selectedProduct) return;
    try {
      const templateBacked = buildTemplateBackedDocxBlob(selectedProduct, selectedProductBaseline);
      downloadBlob(templateBacked || buildDocxBlob(selectedProduct.title, selectedProductHtml), `${safeFilename(selectedProduct.title)}.docx`);
    } catch (error) {
      setBaselineError(error instanceof Error ? error.message : t('baseline.docxRenderError'));
      downloadBlob(buildDocxBlob(selectedProduct.title, selectedProductHtml), `${safeFilename(selectedProduct.title)}.docx`);
    }
  };

  const handlePrintProduct = () => {
    if (!selectedProduct) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.open();
    printWindow.document.write(buildPrintableDocument(selectedProduct.title, selectedProductHtml));
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  const handleCopyBaselinePrompt = async (baseline: NoteTemplate) => {
    const prompt = t('manager.copyPromptText', { name: baseline.name });
    try {
      await navigator.clipboard?.writeText(prompt);
    } catch {
      // Clipboard access can be unavailable from file://; the preview still remains usable.
    }
  };

  const handleBaselineFileSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (baselineInputRef.current) baselineInputRef.current.value = '';
    if (!file || !onImportBaseline) return;
    setBaselineError('');
    setBaselineMessage('');
    try {
      const imported = await onImportBaseline(await file.text(), file.name);
      setSelectedBaselineId(imported.id);
      setBaselineManagerOpen(true);
      setBaselineMessage(t('baseline.importSuccess', { name: imported.name }));
    } catch (error) {
      setBaselineError(error instanceof Error ? error.message : t('baseline.importError'));
    }
  };

  const handleDocxTemplateFileSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (docxTemplateInputRef.current) docxTemplateInputRef.current.value = '';
    if (!file || !selectedBaseline || !selectedBaseline.productBaseline || !onUpdateBaseline) return;
    setBaselineError('');
    setBaselineMessage('');
    try {
      const assets = [
        ...(selectedBaseline.productBaseline.assets || []).filter((asset) => asset.role !== 'docx-template'),
        {
          name: file.name,
          role: 'docx-template' as const,
          mimeType: file.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          data: arrayBufferToBase64(await file.arrayBuffer()),
          notes: t('manager.docxTemplateNotes'),
        },
      ];
      await onUpdateBaseline(selectedBaseline.id, {
        productBaseline: {
          ...selectedBaseline.productBaseline,
          kind: 'docx-template',
          renderer: 'docx-template',
          visualFidelity: selectedBaseline.productBaseline.visualFidelity === 'word-template'
            ? 'word-template'
            : 'structural',
          assets,
        },
      });
      setBaselineMessage(t('baseline.docxAttachSuccess', { name: file.name }));
    } catch (error) {
      setBaselineError(error instanceof Error ? error.message : t('baseline.docxAttachError'));
    }
  };

  return (
    <div className="flex-1 overflow-hidden flex flex-col bg-bg-primary">
      <header className="shrink-0 border-b border-border-subtle px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <FileOutput size={20} className="text-accent-blue shrink-0" />
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-text-primary">{t('header.title')}</h1>
            <p className="text-xs text-text-muted truncate">
              {folderName ? folderName : t('header.subtitle')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onImportBaseline && (
            <label className="inline-flex cursor-pointer items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border-subtle text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors">
              <Upload size={14} />
              {t('header.importBaseline')}
              <input
                ref={baselineInputRef}
                type="file"
                accept=".json,.tc-product-baseline.json,application/json"
                onChange={handleBaselineFileSelect}
                className="hidden"
              />
            </label>
          )}
          <button
            onClick={() => setBaselineManagerOpen(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border-subtle text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            <Settings2 size={14} />
            {t('header.baselines')}
          </button>
          <button
            onClick={onOpenChat}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border-subtle text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            <Bot size={14} />
            {t('header.caddyAI')}
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-6xl space-y-4">
          <section className="rounded-lg border border-border-subtle bg-bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                  <Layers size={16} className="text-accent-blue" />
                  {t('baselines.title')}
                </div>
                <p className="mt-1 max-w-2xl text-xs text-text-muted">
                  {t('baselines.description')}
                </p>
              </div>
              <span className="rounded-md bg-accent-blue/10 px-2 py-1 text-xs text-accent-blue">
                {t('baselines.count', { count: baselines.length })}
              </span>
            </div>
            {(baselineMessage || baselineError) && (
              <p className={`mt-2 text-xs ${baselineError ? 'text-red-400' : 'text-green-400'}`}>
                {baselineError || baselineMessage}
              </p>
            )}
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {baselines.length === 0 ? (
                <div className="rounded-md border border-dashed border-border-subtle bg-bg-primary px-3 py-4 text-xs text-text-muted md:col-span-2">
                  {t('baselines.empty')}
                </div>
              ) : baselines.map((baseline) => (
                <article key={baseline.id} className="rounded-md border border-border-subtle bg-bg-primary px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-bg-raised px-1.5 py-0.5 text-[10px] text-text-muted">{baseline.icon || t('baselines.defaultIcon')}</span>
                    <h3 className="min-w-0 flex-1 truncate text-xs font-semibold text-text-primary">{baseline.name}</h3>
                    <button
                      onClick={() => {
                        setSelectedBaselineId(baseline.id);
                        setBaselineManagerOpen(true);
                      }}
                      className="rounded px-1.5 py-0.5 text-[10px] font-medium text-accent-blue hover:bg-accent-blue/10"
                    >
                      {t('baselines.preview')}
                    </button>
                  </div>
                  {baseline.description && (
                    <p className="mt-1 line-clamp-2 text-[11px] text-text-muted">{baseline.description}</p>
                  )}
                  {baseline.productBaseline && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      <span className="rounded bg-bg-raised px-1.5 py-0.5 text-[10px] text-text-muted">{baseline.productBaseline.productType}</span>
                      <span className="rounded bg-bg-raised px-1.5 py-0.5 text-[10px] text-text-muted">{baseline.productBaseline.visualFidelity}</span>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-semibold uppercase text-text-muted">{t('products.heading')}</h2>
                <span className="text-xs text-text-muted">
                  {filteredProducts.length === products.length ? products.length : `${filteredProducts.length} / ${products.length}`}
                </span>
              </div>
              <div className="relative w-full sm:w-72">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label={t('search.ariaLabel')}
                  placeholder={t('search.placeholder')}
                  className="w-full rounded-md border border-border-subtle bg-bg-surface py-1.5 ps-8 pe-8 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue"
                />
                {query && (
                  <button
                    onClick={() => setQuery('')}
                    aria-label={t('search.clearAriaLabel')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-text-muted hover:text-text-primary hover:bg-bg-hover"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>

            {products.length === 0 ? (
              <div className="rounded-lg border border-border-subtle bg-bg-surface p-8 text-center">
                <FileOutput size={36} className="mx-auto mb-3 text-text-muted" />
                <h3 className="text-sm font-semibold text-text-primary">{t('empty.noProducts')}</h3>
                <p className="mt-1 text-xs text-text-muted">{t('empty.noProductsDesc')}</p>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="rounded-lg border border-border-subtle bg-bg-surface p-8 text-center">
                <Search size={32} className="mx-auto mb-3 text-text-muted" />
                <h3 className="text-sm font-semibold text-text-primary">{t('empty.noMatch')}</h3>
                <p className="mt-1 text-xs text-text-muted">{t('empty.noMatchDesc')}</p>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {filteredProducts.map((product) => (
                  <article key={product.id} className="rounded-lg border border-border-subtle bg-bg-surface p-3 hover:border-border-medium transition-colors">
                    <div className="flex items-start gap-3">
                      <div className="h-9 w-9 rounded-md bg-bg-raised text-accent-blue flex items-center justify-center shrink-0">
                        <FileText size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="line-clamp-2 text-sm font-medium text-text-primary">{product.title}</h3>
                        <p className="mt-1 line-clamp-3 text-xs text-text-muted">{previewProduct(product.content, t('card.noPreview'))}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
                          <span>{formatDate(product.updatedAt)}</span>
                          {product.tags.filter((tag) => tag !== 'product').slice(0, 3).map((tag) => (
                            <span key={tag} className="rounded bg-bg-raised px-1.5 py-0.5">{tag}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setSelectedProductId(product.id)}
                        className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border-subtle px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
                      >
                        <FileText size={13} />
                        {t('card.previewProduct')}
                      </button>
                      <button
                        onClick={() => onOpenSourceNote(product.id)}
                        className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border-subtle px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
                      >
                        <FilePenLine size={13} />
                        {t('card.sourceNote')}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>

      <Modal
        open={baselineManagerOpen}
        onClose={() => setBaselineManagerOpen(false)}
        title={t('manager.title')}
        extraWide
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(220px,320px)_1fr]">
          <div className="space-y-2">
            {baselines.map((baseline) => (
              <button
                key={baseline.id}
                onClick={() => setSelectedBaselineId(baseline.id)}
                className={`w-full rounded-lg border p-3 text-left transition-colors ${selectedBaseline?.id === baseline.id ? 'border-accent-blue bg-accent-blue/10' : 'border-border-subtle bg-bg-surface hover:border-border-medium'}`}
              >
                <div className="flex items-center gap-2">
                  <span className="rounded bg-bg-raised px-1.5 py-0.5 text-[10px] text-text-muted">{baseline.icon || t('baselines.defaultIcon')}</span>
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-text-primary">{baseline.name}</span>
                </div>
                {baseline.description && (
                  <p className="mt-1 line-clamp-2 text-[11px] text-text-muted">{baseline.description}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-1">
                  <span className="rounded bg-bg-raised px-1.5 py-0.5 text-[10px] text-text-muted">{baseline.source}</span>
                  {baseline.tags?.slice(0, 3).map((tag) => (
                    <span key={tag} className="rounded bg-bg-raised px-1.5 py-0.5 text-[10px] text-text-muted">{tag}</span>
                  ))}
                </div>
              </button>
            ))}
          </div>
          <div className="min-w-0 rounded-lg border border-border-subtle bg-bg-surface">
            {selectedBaseline ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border-subtle p-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-text-primary">{selectedBaseline.name}</h3>
                    {selectedBaseline.description && (
                      <p className="mt-1 text-xs text-text-muted">{selectedBaseline.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedBaseline.productBaseline && onUpdateBaseline && (
                      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border-subtle px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-hover">
                        <Upload size={13} />
                        {t('manager.attachDocx')}
                        <input
                          ref={docxTemplateInputRef}
                          type="file"
                          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                          onChange={handleDocxTemplateFileSelect}
                          className="hidden"
                        />
                      </label>
                    )}
                    <button
                      onClick={() => handleCopyBaselinePrompt(selectedBaseline)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-hover"
                    >
                      <Clipboard size={13} />
                      {t('manager.copyPrompt')}
                    </button>
                    <button
                      onClick={handleDownloadBaselinePackage}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-hover"
                    >
                      <Download size={13} />
                      {t('manager.exportPackage')}
                    </button>
                    <button
                      onClick={onOpenChat}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-hover"
                    >
                      <Bot size={13} />
                      {t('header.caddyAI')}
                    </button>
                  </div>
                </div>
                <pre className="max-h-[58vh] overflow-auto whitespace-pre-wrap p-4 text-xs leading-6 text-text-secondary">
                  {selectedBaseline.content}
                </pre>
                {selectedBaseline.productBaseline && (
                  <div className="border-t border-border-subtle p-3 text-xs text-text-muted">
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded bg-bg-raised px-1.5 py-0.5">{selectedBaseline.productBaseline.productType}</span>
                      <span className="rounded bg-bg-raised px-1.5 py-0.5">{selectedBaseline.productBaseline.renderer}</span>
                      <span className="rounded bg-bg-raised px-1.5 py-0.5">{selectedBaseline.productBaseline.visualFidelity}</span>
                      {hasDocxTemplateAsset(selectedBaseline) && (
                        <span className="rounded bg-green-500/10 px-1.5 py-0.5 text-green-400">{t('manager.docxTemplateAttached')}</span>
                      )}
                    </div>
                    {selectedBaseline.productBaseline.sourceDocuments && selectedBaseline.productBaseline.sourceDocuments.length > 0 && (
                      <p className="mt-2">
                        {t('manager.baselineSources', { names: selectedBaseline.productBaseline.sourceDocuments.map((doc) => doc.name).join(', ') })}
                      </p>
                    )}
                    {selectedBaseline.productBaseline.testFixtures && selectedBaseline.productBaseline.testFixtures.length > 0 && (
                      <p className="mt-1">
                        {t('manager.testFixtures', { names: selectedBaseline.productBaseline.testFixtures.map((fixture) => fixture.name).join(', ') })}
                      </p>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="p-8 text-center text-sm text-text-muted">{t('manager.noBaselines')}</div>
            )}
          </div>
        </div>
      </Modal>

      <Modal
        open={selectedProduct !== null}
        onClose={() => setSelectedProductId(null)}
        title={selectedProduct?.title || t('preview.title')}
        extraWide
      >
        {selectedProduct && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-subtle bg-bg-surface px-3 py-2">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
                <span>{t('preview.updated', { date: formatDate(selectedProduct.updatedAt) })}</span>
                {selectedProduct.tags.filter((tag) => tag !== 'product').slice(0, 6).map((tag) => (
                  <span key={tag} className="rounded bg-bg-raised px-1.5 py-0.5">{tag}</span>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handleDownloadDocx}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-hover"
                >
                  <Download size={13} />
                  {t('preview.docx')}
                </button>
                <button
                  onClick={handleDownloadMarkdown}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-hover"
                >
                  <Download size={13} />
                  {t('preview.markdown')}
                </button>
                <button
                  onClick={handlePrintProduct}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-hover"
                >
                  <Printer size={13} />
                  {t('preview.print')}
                </button>
                <button
                  onClick={() => onOpenSourceNote(selectedProduct.id)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-hover"
                >
                  <FilePenLine size={13} />
                  {t('preview.source')}
                </button>
              </div>
            </div>
            <div className="max-h-[68vh] overflow-auto rounded-lg border border-border-subtle bg-gray-200 p-4">
              <article
                className="product-document markdown-preview mx-auto min-h-[11in] max-w-[8.5in] bg-white px-[0.7in] py-[0.65in] text-[12pt] text-gray-950 shadow-lg"
                dangerouslySetInnerHTML={{ __html: selectedProductHtml }}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function previewProduct(markdown: string, fallback: string): string {
  return markdown
    .replace(/^#.+$/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/[#>*_`|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 260) || fallback;
}

function safeFilename(value: string): string {
  const cleaned = value
    .trim()
    .split('')
    .map((char) => (char.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(char) ? '-' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .slice(0, 120);
  return cleaned || 'ThreatCaddy Product';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function buildDocxBlob(title: string, bodyHtml: string): Blob {
  const html = buildProductHtmlDocument(title, bodyHtml);
  const data = buildZip([
    {
      path: '[Content_Types].xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="html" ContentType="text/html"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    },
    {
      path: '_rels/.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    },
    {
      path: 'word/document.xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:altChunk r:id="rIdHtml"/>
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="936" w:right="1008" w:bottom="936" w:left="1008" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`,
    },
    {
      path: 'word/_rels/document.xml.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdHtml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/aFChunk" Target="afchunk.html"/>
</Relationships>`,
    },
    {
      path: 'word/afchunk.html',
      content: html,
    },
  ]);
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

function buildPrintableDocument(title: string, bodyHtml: string): string {
  return buildProductHtmlDocument(title, bodyHtml, '@page { size: letter; margin: 0.65in 0.7in; } body { margin: 0; }');
}

function buildProductHtmlDocument(title: string, bodyHtml: string, extraCss = ''): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    ${extraCss}
    body { font-family: Aptos, Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.45; color: #111827; }
    h1 { font-size: 20pt; border-bottom: 1px solid #9ca3af; padding-bottom: 4pt; }
    h2 { font-size: 15pt; margin-top: 18pt; }
    h3 { font-size: 12.5pt; margin-top: 14pt; }
    table { border-collapse: collapse; width: 100%; margin: 10pt 0; }
    th, td { border: 1px solid #9ca3af; padding: 5pt; text-align: left; vertical-align: top; }
    th { background: #e5e7eb; font-weight: 700; }
    code { background: #f3f4f6; padding: 1pt 3pt; font-family: Consolas, monospace; }
  </style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

function buildZip(files: Array<{ path: string; content: string }>): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.path);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, 0, true);
    local.set(name, 30);
    localParts.push(local, data);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centralParts.push(central);

    offset += local.length + data.length;
  }

  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true);

  return concatUint8Arrays([...localParts, ...centralParts, end]);
}

function concatUint8Arrays(parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

const CRC32_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  return value >>> 0;
});

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
