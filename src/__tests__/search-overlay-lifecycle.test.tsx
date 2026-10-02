import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SearchOverlay } from '../components/Search/SearchOverlay';
import type { EvidenceItem } from '../types';

const workers = vi.hoisted(() => [] as { postMessage: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn>; onerror?: (event: Event) => void }[]);
vi.mock('../workers/search.worker?worker', () => ({ default: class {
  postMessage = vi.fn(); terminate = vi.fn(); onerror?: (event: Event) => void;
  constructor() { workers.push(this); }
} }));
vi.mock('../hooks/useSavedSearches', () => ({ useSavedSearches: () => ({ searches: [], saveSearch: vi.fn(), deleteSearch: vi.fn(), renameSearch: vi.fn(), clearAll: vi.fn() }) }));
const evidence: EvidenceItem = { id: 'exhibit', title: 'Prepared exhibit', fileName: 'receipt.txt', fileType: 'text', size: 20, content: 'Extracted receipt', extractionStatus: 'extracted', importedAt: 1, chunkIndex: 0, chunkCount: 1, tags: [], archived: false, trashed: false, createdAt: 1, updatedAt: 1 };
const props = { notes: [], tasks: [], clipsFolderId: undefined, onClose: vi.fn(), onNavigateToNote: vi.fn(), onNavigateToTask: vi.fn(), evidenceItems: [evidence], onNavigateToEvidence: vi.fn() };
beforeEach(() => { workers.length = 0; vi.clearAllMocks(); Element.prototype.scrollIntoView = vi.fn(); });
afterEach(cleanup);

it('does no worker/index work while closed, sends projected data only while open and disposes on close', () => {
  const view = render(<SearchOverlay {...props} open={false} />);
  expect(workers).toHaveLength(0);
  view.rerender(<SearchOverlay {...props} evidenceItems={[{ ...evidence, imageData: 'BINARY_FIXTURE' }]} open={false} />);
  expect(workers).toHaveLength(0);
  view.rerender(<SearchOverlay {...props} evidenceItems={[{ ...evidence, imageData: 'BINARY_FIXTURE' }]} open />);
  expect(workers).toHaveLength(1);
  expect(JSON.stringify(workers[0].postMessage.mock.calls)).not.toContain('BINARY_FIXTURE');
  view.rerender(<SearchOverlay {...props} open={false} />);
  expect(workers[0].terminate).toHaveBeenCalledOnce();
});

it('shows evidence results after a deferred worker error and navigates the evidence result', async () => {
  render(<SearchOverlay {...props} open />);
  fireEvent.change(screen.getByPlaceholderText(/Search notes/), { target: { value: 'receipt' } });
  await waitFor(() => expect(workers[0].postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'query', query: expect.objectContaining({ raw: 'receipt' }) })));
  act(() => workers[0].onerror?.(new Event('error')));
  fireEvent.click(await screen.findByRole('button', { name: 'Evidence: Prepared exhibit' }));
  expect(props.onNavigateToEvidence).toHaveBeenCalledWith('exhibit');
  expect(props.onNavigateToTask).not.toHaveBeenCalled(); expect(props.onClose).toHaveBeenCalledOnce();
});
