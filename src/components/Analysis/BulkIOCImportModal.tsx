import { useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { StandaloneIOC, IOCType, ConfidenceLevel, Folder, Tag } from '../../types';
import { IOC_TYPE_LABELS, CONFIDENCE_LEVELS } from '../../types';

const MAX_IOCS = 500;

const CONF_LEVELS = Object.keys(CONFIDENCE_LEVELS) as ConfidenceLevel[];

function detectIOCType(value: string): IOCType | 'other' {
  const trimmed = value.trim();
  if (!trimmed) return 'other';

  // CVE
  if (/^CVE-/i.test(trimmed)) return 'cve';

  // URL
  if (/^https?:\/\//i.test(trimmed)) return 'url';

  // Email
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return 'email';

  // SHA256 (64 hex chars)
  if (/^[a-fA-F0-9]{64}$/.test(trimmed)) return 'sha256';

  // SHA1 (40 hex chars)
  if (/^[a-fA-F0-9]{40}$/.test(trimmed)) return 'sha1';

  // MD5 (32 hex chars)
  if (/^[a-fA-F0-9]{32}$/.test(trimmed)) return 'md5';

  // IPv4
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(trimmed)) return 'ipv4';

  // IPv6 (simplified: contains at least 2 colons, hex chars)
  if (/^[0-9a-fA-F:]+$/.test(trimmed) && (trimmed.match(/:/g) || []).length >= 2) return 'ipv6';

  // Domain
  if (/^[a-zA-Z0-9]([a-zA-Z0-9-]*\.)+[a-zA-Z]{2,}$/.test(trimmed)) return 'domain';

  return 'other';
}

interface ParsedIOC {
  value: string;
  detectedType: IOCType | 'other';
  confidence: ConfidenceLevel;
}

interface ImportResults {
  created: number;
  skipped: number;
  failed: number;
}

interface BulkIOCImportModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (data: Partial<StandaloneIOC>) => Promise<StandaloneIOC>;
  existingIOCs: StandaloneIOC[];
  folders: Folder[];
  allTags?: Tag[];
  defaultFolderId?: string;
}

export function BulkIOCImportModal({
  open,
  onClose,
  onCreate,
  existingIOCs,
  folders,
  allTags = [],
  defaultFolderId,
}: BulkIOCImportModalProps) {
  const [rawText, setRawText] = useState('');
  const [parsed, setParsed] = useState<ParsedIOC[]>([]);
  const [step, setStep] = useState<'input' | 'preview' | 'results'>('input');
  const [folderId, setFolderId] = useState(defaultFolderId || '');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<ImportResults | null>(null);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (open) {
      setRawText('');
      setParsed([]);
      setStep('input');
      setFolderId(defaultFolderId || '');
      setTags([]);
      setTagInput('');
      setImporting(false);
      setResults(null);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, defaultFolderId]);

  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open, handleEscape]);

  const { t } = useTranslation('analysis');

  if (!open) return null;

  const handleParse = () => {
    const lines = rawText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const unique = [...new Set(lines)];
    const limited = unique.slice(0, MAX_IOCS);

    const items: ParsedIOC[] = limited.map((value) => ({
      value,
      detectedType: detectIOCType(value),
      confidence: 'medium',
    }));

    setParsed(items);
    setStep('preview');
  };

  const updateParsedType = (index: number, type: IOCType | 'other') => {
    setParsed((prev) => prev.map((item, i) => (i === index ? { ...item, detectedType: type } : item)));
  };

  const updateParsedConfidence = (index: number, confidence: ConfidenceLevel) => {
    setParsed((prev) => prev.map((item, i) => (i === index ? { ...item, confidence } : item)));
  };

  const removeParsed = (index: number) => {
    setParsed((prev) => prev.filter((_, i) => i !== index));
  };

  const handleImport = async () => {
    setImporting(true);
    let created = 0;
    let skipped = 0;
    let failed = 0;

    // Build a set of existing type+value pairs for dedup
    const existingSet = new Set(existingIOCs.map((ioc) => `${ioc.type}::${ioc.value}`));

    // Filter out 'other' type items (cannot create without valid IOCType)
    const validItems = parsed.filter((item) => item.detectedType !== 'other');
    const otherCount = parsed.length - validItems.length;
    failed += otherCount;

    for (const item of validItems) {
      const key = `${item.detectedType}::${item.value}`;
      if (existingSet.has(key)) {
        skipped++;
        continue;
      }

      try {
        await onCreate({
          type: item.detectedType as IOCType,
          value: item.value,
          confidence: item.confidence,
          folderId: folderId || undefined,
          tags,
        });
        existingSet.add(key);
        created++;
      } catch {
        failed++;
      }
    }

    setResults({ created, skipped, failed });
    setStep('results');
    setImporting(false);
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

  const tagSuggestions = allTags
    .map((t) => t.name)
    .filter((n) => n.toLowerCase().includes(tagInput.toLowerCase()) && !tags.includes(n));

  const selectCls = 'bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-accent';
  const inputCls = 'w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-accent';

  const validCount = parsed.filter((p) => p.detectedType !== 'other').length;
  const otherCount = parsed.filter((p) => p.detectedType === 'other').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative bg-gray-900 border border-gray-700 rounded-lg shadow-xl w-full max-w-2xl p-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-200">
            {step === 'input' && t('bulkImport.inputTitle')}
            {step === 'preview' && t('bulkImport.previewTitle')}
            {step === 'results' && t('bulkImport.resultsTitle')}
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-800 text-gray-500">
            <X size={16} />
          </button>
        </div>

        {step === 'input' && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                {t('bulkImport.pasteLabel', { max: MAX_IOCS })}
              </label>
              <textarea
                autoFocus
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder={"192.168.1.1\nevil.com\nhttps://malware.example/payload\nCVE-2024-1234\nabc123abc123abc123abc123abc123ab"}
                className={`${inputCls} font-mono resize-none`}
                rows={10}
              />
            </div>

            {/* Default folder */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">{t('bulkImport.investigationLabel')}</label>
              <select value={folderId} onChange={(e) => setFolderId(e.target.value)} className={`${selectCls} w-full`}>
                <option value="">{t('bulkImport.noInvestigation')}</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>

            {/* Default tags */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">{t('bulkImport.tagsLabel')}</label>
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
                  placeholder={t('bulkImport.tagPlaceholder')}
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

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-sm rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800"
              >
                {t('common:cancel')}
              </button>
              <button
                onClick={handleParse}
                disabled={!rawText.trim()}
                className="px-3 py-1.5 text-sm rounded-lg bg-accent/15 text-accent hover:bg-accent/25 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('bulkImport.parseAndPreview')}
              </button>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-xs text-gray-400">
              <span>{t('bulkImport.parsedCount', { count: parsed.length })}</span>
              {otherCount > 0 && (
                <span className="text-yellow-500">{t('bulkImport.unrecognized', { count: otherCount })}</span>
              )}
            </div>

            {/* Preview table */}
            <div className="max-h-[50vh] overflow-y-auto border border-gray-800 rounded-lg">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-900 z-10">
                  <tr className="border-b border-gray-800">
                    <th className="text-left text-gray-500 font-medium py-2 px-2">{t('bulkImport.previewValue')}</th>
                    <th className="text-left text-gray-500 font-medium py-2 px-2 w-28">{t('bulkImport.previewType')}</th>
                    <th className="text-left text-gray-500 font-medium py-2 px-2 w-28">{t('bulkImport.previewConfidence')}</th>
                    <th className="text-right text-gray-500 font-medium py-2 px-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.map((item, i) => {
                    const typeInfo = item.detectedType !== 'other' ? IOC_TYPE_LABELS[item.detectedType] : null;
                    return (
                      <tr key={i} className="border-b border-gray-800/50 group">
                        <td className="py-1.5 px-2 text-gray-200 font-mono max-w-[280px] truncate">{item.value}</td>
                        <td className="py-1.5 px-2">
                          <select
                            value={item.detectedType}
                            onChange={(e) => updateParsedType(i, e.target.value as IOCType | 'other')}
                            className={selectCls}
                            style={typeInfo ? { color: typeInfo.color } : { color: '#6b7280' }}
                          >
                            <option value="other" style={{ color: '#6b7280' }}>{t('bulkImport.otherType')}</option>
                            {(Object.keys(IOC_TYPE_LABELS) as IOCType[]).map((t) => (
                              <option key={t} value={t} style={{ color: IOC_TYPE_LABELS[t].color }}>
                                {IOC_TYPE_LABELS[t].label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-1.5 px-2">
                          <select
                            value={item.confidence}
                            onChange={(e) => updateParsedConfidence(i, e.target.value as ConfidenceLevel)}
                            className={selectCls}
                          >
                            {CONF_LEVELS.map((c) => (
                              <option key={c} value={c}>{CONFIDENCE_LEVELS[c].label}</option>
                            ))}
                          </select>
                        </td>
                        <td className="py-1.5 px-2 text-right">
                          <button
                            onClick={() => removeParsed(i)}
                            className="p-0.5 rounded text-gray-600 hover:text-red-400 opacity-40 group-hover:opacity-100 group-focus-within:opacity-100"
                          >
                            <X size={12} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between items-center pt-1">
              <button
                onClick={() => setStep('input')}
                className="px-3 py-1.5 text-sm rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800"
              >
                {t('common:back')}
              </button>
              <button
                onClick={handleImport}
                disabled={importing || validCount === 0}
                className="px-3 py-1.5 text-sm rounded-lg bg-accent/15 text-accent hover:bg-accent/25 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importing ? t('bulkImport.importing') : t('bulkImport.importButton', { count: validCount })}
              </button>
            </div>
          </div>
        )}

        {step === 'results' && results && (
          <div className="space-y-4">
            <div className="space-y-2 text-sm">
              {results.created > 0 && (
                <div className="flex items-center gap-2 text-green-400">
                  <span className="w-2 h-2 rounded-full bg-green-400" />
                  {t('bulkImport.createdCount', { count: results.created })}
                </div>
              )}
              {results.skipped > 0 && (
                <div className="flex items-center gap-2 text-yellow-400">
                  <span className="w-2 h-2 rounded-full bg-yellow-400" />
                  {t('bulkImport.skippedCount', { count: results.skipped })}
                </div>
              )}
              {results.failed > 0 && (
                <div className="flex items-center gap-2 text-red-400">
                  <span className="w-2 h-2 rounded-full bg-red-400" />
                  {t('bulkImport.failedCount', { count: results.failed })}
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-sm rounded-lg bg-accent/15 text-accent hover:bg-accent/25 font-medium"
              >
                {t('common:done')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
