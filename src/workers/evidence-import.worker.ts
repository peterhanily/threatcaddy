import { buildEvidenceItemDrafts, type EvidenceDraftOptions } from '../lib/evidence-import';

// One worker handles one document; termination disposes of all parser state.
self.onmessage = async (event: MessageEvent<{ file: File; options: EvidenceDraftOptions }>) => {
  try {
    const drafts = await buildEvidenceItemDrafts(event.data.file, event.data.options);
    self.postMessage({ ok: true, drafts });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : 'Evidence extraction failed.' });
  }
};
