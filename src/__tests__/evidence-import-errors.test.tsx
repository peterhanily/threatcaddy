import { fireEvent, render, screen } from '@testing-library/react';
import { createInstance, type i18n as I18n } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { EvidenceView } from '../components/Evidence/EvidenceView';
import {
  EvidenceImportError, EvidenceImportLimitError, evidenceImportErrorParams, isEvidenceImportErrorCode, type EvidenceImportErrorCode,
} from '../lib/evidence-import-limits';
import evidenceEn from '../../public/locales/en/evidence.json';
import evidenceJa from '../../public/locales/ja/evidence.json';
import commonEn from '../../public/locales/en/common.json';
import commonJa from '../../public/locales/ja/common.json';

const catalogs = import.meta.glob<{ default: Record<string, string> }>('../../public/locales/*/evidence.json', { eager: true });
const CODES: EvidenceImportErrorCode[] = ['inputBytes', 'batchBytes', 'archiveEntries', 'archiveCompressedBytes', 'archiveSizeMismatch',
  'spreadsheetColumns', 'documentTimeout', 'batchTimeout', 'workerUnavailable', 'workerFailed', 'extractionFailed',
  'sessionChanged', 'contextChanged', 'destinationUnavailable', 'interrupted', 'notReady', 'screenshareActive', 'investigationArchived'];

async function locale(lng: string): Promise<I18n> {
  const instance = createInstance();
  await instance.init({
    lng, fallbackLng: 'en', defaultNS: 'evidence', interpolation: { escapeValue: false },
    resources: { en: { evidence: evidenceEn, common: commonEn }, ja: { evidence: evidenceJa, common: commonJa } },
  });
  return instance;
}

async function failImport(error: unknown, lng = 'ja') {
  const onImportFiles = vi.fn().mockRejectedValue(error);
  render(<I18nextProvider i18n={await locale(lng)}><EvidenceView folderId="case" items={[]} onImportFiles={onImportFiles} onOpenChat={() => {}} /></I18nextProvider>);
  const input = document.querySelector('input[type=file]');
  if (!input) throw new Error('Expected the evidence file picker');
  fireEvent.change(input, { target: { files: [new File(['x'], 'report.pdf')] } });
}

describe('evidence import error messages', () => {
  it('translates a limit error and names the file that stopped the batch', async () => {
    await failImport(new EvidenceImportLimitError('archiveSizeMismatch', { fileName: 'quarterly report.pdf' }));
    expect(await screen.findByText(`quarterly report.pdf：${evidenceJa['importError.archiveSizeMismatch']}`)).toBeVisible();
    expect(screen.queryByText(/compressed part/)).toBeNull();
  });

  it('translates errors whose class was lost crossing the worker boundary, with their limits', async () => {
    await failImport(Object.assign(new Error('Evidence import stopped: document parsing exceeded 10 seconds.'), { code: 'documentTimeout', fileName: 'slow.pdf' }));
    expect(await screen.findByText(`slow.pdf：${evidenceJa['importError.documentTimeout'].replace('{{seconds}}', '10')}`)).toBeVisible();
  });

  it('shows an import interrupted by the app as an interruption, not DOMException text', async () => {
    await failImport(new DOMException('signal is aborted without reason', 'AbortError'));
    expect(await screen.findByText(evidenceJa['importError.interrupted'])).toBeVisible();
    expect(screen.queryByText(/signal is aborted/)).toBeNull();
  });

  it('keeps file names as text', async () => {
    await failImport(new EvidenceImportError('extractionFailed', { fileName: '<img src=x onerror=alert(1)>.pdf' }), 'en');
    expect(await screen.findByText(`<img src=x onerror=alert(1)>.pdf: ${evidenceEn['importError.extractionFailed']}`)).toBeVisible();
    expect(document.querySelector('img')).toBeNull();
  });

  it('states the per-file and per-import size limits in the drop zone', async () => {
    render(<I18nextProvider i18n={await locale('en')}><EvidenceView folderId="case" items={[]} onImportFiles={vi.fn()} onOpenChat={() => {}} /></I18nextProvider>);
    expect(screen.getByText(/Up to 20 files and 50 MiB per import, 25 MiB per file\./)).toBeVisible();
  });

  it('has a complete translation for every error code in every locale', async () => {
    expect(Object.keys(catalogs)).toHaveLength(21);
    for (const [path, { default: catalog }] of Object.entries(catalogs)) {
      for (const code of CODES) {
        expect(isEvidenceImportErrorCode(code)).toBe(true);
        const text = catalog[`importError.${code}`];
        expect(text, `${path} importError.${code}`).toBeTruthy();
        const instance = createInstance();
        await instance.init({ lng: 'xx', resources: { xx: { translation: catalog } }, interpolation: { escapeValue: false } });
        expect(instance.t(`importError.${code}`, evidenceImportErrorParams(code)), `${path} ${code}`).not.toMatch(/\{\{|importError/);
      }
    }
  });
});
