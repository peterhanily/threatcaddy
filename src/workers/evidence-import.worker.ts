import { buildEvidenceItemDrafts, type EvidenceDraftOptions, type EvidenceFileSource } from '../lib/evidence-import';

// One worker handles one document; termination disposes of all parser state.
self.onmessage = async (event: MessageEvent<{ source: EvidenceFileSource; options: EvidenceDraftOptions }>) => {
  try {
    const drafts = await buildEvidenceItemDrafts(event.data.source, event.data.options);
    self.postMessage({ ok: true, drafts });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : 'Evidence extraction failed.' });
  }
};
