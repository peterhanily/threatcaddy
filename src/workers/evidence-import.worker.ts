import { buildEvidenceItemDrafts, type EvidenceDraftOptions, type EvidenceFileSource } from '../lib/evidence-import';
import { EvidenceImportError } from '../lib/evidence-import-limits';

// One worker handles one document; termination disposes of all parser state.
// Errors cross as a code plus English fallback text; the page translates them.
self.onmessage = async (event: MessageEvent<{ source: EvidenceFileSource; options: EvidenceDraftOptions }>) => {
  try {
    const drafts = await buildEvidenceItemDrafts(event.data.source, event.data.options);
    self.postMessage({ ok: true, drafts });
  } catch (error) {
    self.postMessage({
      ok: false,
      code: error instanceof EvidenceImportError ? error.code : 'extractionFailed',
      error: error instanceof Error ? error.message : 'Evidence extraction failed.',
    });
  }
};
