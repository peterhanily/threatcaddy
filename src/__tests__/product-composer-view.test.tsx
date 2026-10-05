import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductComposer, type ProductComposerProps } from '../components/Products/ProductComposer';
import { ScreenshareContext } from '../hooks/ScreenshareContext';
import { hasPendingChanges } from '../lib/pending-changes';
import { PRODUCT_COMPOSER_LIMITS, type ProductComposerSnapshot } from '../lib/product-composer';
import { DEFAULT_CLS_LEVELS, type Note, type NoteTemplate } from '../types';

const encryption = vi.hoisted(() => ({ key: null as CryptoKey | null }));
vi.mock('../lib/encryptionMiddleware', () => ({ getSessionKey: () => encryption.key }));

const note = (id: string, content: string): Note => ({
  id, title: `Source ${id}`, content, folderId: 'case', clsLevel: 'TLP:RED', tags: [],
  pinned: false, trashed: false, archived: false, createdAt: 1, updatedAt: 1,
});
const saved = note('saved-product', 'Saved content');
const snapshot: ProductComposerSnapshot = {
  folder: { id: 'case', name: 'Fictional case', clsLevel: 'TLP:GREEN', order: 0, createdAt: 0 },
  notes: [note('selected', 'Chosen source body'), note('unselected', 'Unselected source body')],
  tasks: [], timelineEvents: [], iocs: [], evidence: [],
};
const baseline: NoteTemplate = {
  id: 'baseline', name: 'Fictional baseline', content: '# Report\n\n## Findings\n\nSeed {{ placeholder }}\n\n## Conclusion\n\nSecond section.',
  category: 'Product Baseline', source: 'user', clsLevel: 'TLP:AMBER', createdAt: 0, updatedAt: 0,
};
function properties(overrides: Partial<ProductComposerProps> = {}): ProductComposerProps {
  return { snapshot, baselines: [baseline], initialBaselineId: baseline.id, effectiveLevels: DEFAULT_CLS_LEVELS,
    onSave: vi.fn().mockResolvedValue(saved), onSaved: vi.fn(), onClose: vi.fn(), ...overrides };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
beforeEach(() => { encryption.key = null; });
afterEach(() => { vi.restoreAllMocks(); });

describe('ProductComposer local draft lifecycle', () => {
  it('stages only explicit sources, appends edits and saves the immutable classification floor without background writes', async () => {
    const user = userEvent.setup();
    const localWrite = vi.spyOn(Storage.prototype, 'setItem');
    const fetch = vi.spyOn(globalThis, 'fetch');
    const props = properties();
    render(<ProductComposer {...props} />);
    expect(screen.getByText('TLP:RED', { exact: true })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /classification/i })).not.toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('not executed');
    const content = screen.getByRole('textbox', { name: 'Section 1 content' });
    fireEvent.change(content, { target: { value: 'Analyst-authored text.' } });
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stage selected sources' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Select at least one');
    expect(content).toHaveValue('Analyst-authored text.');
    await user.click(screen.getByRole('checkbox', { name: 'Include note: Source selected' }));
    await user.click(screen.getByRole('button', { name: 'Stage selected sources' }));
    expect((content as HTMLTextAreaElement).value).toContain('Analyst-authored text.\n\n| ID');
    expect((content as HTMLTextAreaElement).value).toContain('Chosen source body');
    expect((content as HTMLTextAreaElement).value).not.toContain('Unselected source body');
    expect(props.onSave).not.toHaveBeenCalled();
    expect(localWrite).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save draft product' }));
    expect(props.onSave).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ title: 'Report', baselineId: baseline.id, clsLevel: 'TLP:RED' }));
    expect(props.onSaved).toHaveBeenCalledExactlyOnceWith(saved);
    expect(hasPendingChanges()).toBe(false);
  });

  it('supports section creation, order, level and removal without replacing other text', async () => {
    const user = userEvent.setup(); const props = properties();
    render(<ProductComposer {...props} />);
    await user.click(screen.getByRole('button', { name: 'Add section' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Section 3 content' }), { target: { value: 'New preserved text.' } });
    await user.click(screen.getByRole('button', { name: 'Move section 3 up' }));
    expect(screen.getByRole('textbox', { name: 'Section 2 content' })).toHaveValue('New preserved text.');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Section 2 level' }), '3');
    await user.click(screen.getByRole('button', { name: 'Remove section 1' }));
    await user.click(screen.getByRole('button', { name: 'Save draft product' }));
    const input = vi.mocked(props.onSave).mock.calls[0][0];
    expect(input.content).toContain('### New section\n\nNew preserved text.');
    expect(input.content.indexOf('New preserved text.')).toBeLessThan(input.content.indexOf('Second section.'));
    expect(input.content).not.toContain('Seed');
  });

  it('retains edits and pending ownership after a rejected save and blocks duplicate submits', async () => {
    const user = userEvent.setup(); const pending = deferred<Note>();
    const props = properties({ onSave: vi.fn(() => pending.promise) });
    const view = render(<ProductComposer {...props} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Section 1 content' }), { target: { value: 'Retained analysis' } });
    await user.dblClick(screen.getByRole('button', { name: 'Save draft product' }));
    expect(props.onSave).toHaveBeenCalledOnce();
    expect(screen.getByRole('textbox', { name: 'Section 1 content' })).toBeDisabled();
    await act(async () => { pending.reject(new Error('Sensitive provider detail fictional-secret')); });
    expect(screen.getByRole('alert')).toHaveTextContent('Your entries are still here');
    expect(screen.getByRole('alert')).not.toHaveTextContent('fictional-secret');
    expect(screen.getByRole('textbox', { name: 'Section 1 content' })).toHaveValue('Retained analysis');
    expect(screen.getByRole('button', { name: 'Save draft product' })).toBeEnabled();
    expect(props.onSaved).not.toHaveBeenCalled();
    expect(hasPendingChanges()).toBe(true);
    view.unmount(); expect(hasPendingChanges()).toBe(false);
  });

  it('does not navigate a replacement folder after an old save completes and retains pending protection until settlement', async () => {
    const user = userEvent.setup(); const pending = deferred<Note>();
    const props = properties({ onSave: vi.fn(() => pending.promise) });
    const view = render(<ProductComposer {...props} />);
    await user.click(screen.getByRole('button', { name: 'Save draft product' }));
    view.rerender(<ProductComposer {...props} initialBaselineId={undefined} snapshot={{ ...snapshot, folder: { ...snapshot.folder, id: 'next', name: 'Next case' }, notes: [] }} />);
    expect(screen.getByRole('textbox', { name: 'Product title' })).toHaveValue('Next case Product');
    expect(hasPendingChanges()).toBe(true);
    await act(async () => { pending.resolve(saved); });
    expect(props.onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Product title' })).toHaveValue('Next case Product');
    expect(hasPendingChanges()).toBe(false);
  });

  it('fences a save completion when the encryption session is cleared before unmount', async () => {
    const user = userEvent.setup(); const pending = deferred<Note>();
    encryption.key = {} as CryptoKey;
    const props = properties({ onSave: vi.fn(() => pending.promise) });
    const view = render(<ProductComposer {...props} />);
    await user.click(screen.getByRole('button', { name: 'Save draft product' }));
    encryption.key = null;
    await act(async () => { pending.resolve(saved); });
    expect(props.onSaved).not.toHaveBeenCalled();
    view.unmount(); expect(hasPendingChanges()).toBe(false);
  });

  it('requires confirmation before replacing or discarding an edited outline', async () => {
    const user = userEvent.setup(); const props = properties();
    const view = render(<ProductComposer {...props} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Section 1 content' }), { target: { value: 'Keep this draft' } });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Baseline' }), '');
    let confirmation = screen.getByRole('dialog', { name: 'Replace draft outline?' });
    await user.click(within(confirmation).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('textbox', { name: 'Section 1 content' })).toHaveValue('Keep this draft');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Baseline' }), '');
    confirmation = screen.getByRole('dialog', { name: 'Replace draft outline?' });
    await user.click(within(confirmation).getByRole('button', { name: 'Replace outline' }));
    expect(screen.getByRole('textbox', { name: 'Product title' })).toHaveValue('Fictional case Product');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    confirmation = screen.getByRole('dialog', { name: 'Discard unsaved product?' });
    expect(props.onClose).not.toHaveBeenCalled();
    await user.click(within(confirmation).getByRole('button', { name: 'Discard draft' }));
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(hasPendingChanges()).toBe(false);
    view.unmount();
  });

  it('reports clipboard errors without secret details and ignores a superseded copy result', async () => {
    const user = userEvent.setup(); const props = properties();
    const clipboard = vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('Sensitive fictional-secret'));
    render(<ProductComposer {...props} />);
    await user.click(screen.getByRole('button', { name: 'Copy section 1 prompt' }));
    expect(screen.getByRole('alert')).toHaveTextContent('copy the section text manually');
    expect(screen.getByRole('alert')).not.toHaveTextContent('fictional-secret');
    expect(props.onSave).not.toHaveBeenCalled();
    const pending = deferred<void>(); clipboard.mockReturnValueOnce(pending.promise);
    await user.click(screen.getByRole('button', { name: 'Copy section 1 prompt' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Baseline' }), '');
    await act(async () => { pending.reject(new Error('Old clipboard request failed')); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Section 1 content' })).toHaveValue('');
  });

  it('renders a local preview without active media and rejects oversized fields without truncation', async () => {
    const user = userEvent.setup(); render(<ProductComposer {...properties()} />);
    const content = screen.getByRole('textbox', { name: 'Section 1 content' });
    const text = 'Manual analysis. ![remote](https://composer-fixture.invalid/image.png) <video src="https://composer-fixture.invalid/video.mp4"></video>';
    fireEvent.change(content, { target: { value: text } });
    await user.click(screen.getByRole('button', { name: 'Preview draft' }));
    const preview = screen.getByRole('region', { name: 'Draft preview' });
    expect(preview).toHaveTextContent('Manual analysis.');
    expect(preview.querySelector('img, video, audio, source, iframe, object, embed')).toBeNull();
    fireEvent.change(content, { target: { value: 'x'.repeat(PRODUCT_COMPOSER_LIMITS.sectionCharacters + 1) } });
    expect(screen.getByRole('alert')).toHaveTextContent('No content has been truncated');
    expect(content).toHaveValue(text);
  });

  it('rejects an oversized initial snapshot without rendering its source collection', () => {
    const notes = Array.from({ length: PRODUCT_COMPOSER_LIMITS.sourceItems + 1 }, (_, index) => note(`bulk-${index}`, 'Fictional fixture'));
    render(<ProductComposer {...properties({ snapshot: { ...snapshot, notes } })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('at most 2000 source items');
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Save draft product' })).toBeDisabled();
  });

  it('preserves the draft during screensharing and defers opening a completed save until explicit action', async () => {
    const user = userEvent.setup(); const pending = deferred<Note>();
    const props = properties({ onSave: vi.fn(() => pending.promise) });
    const ui = (maxLevel: string | null) => <ScreenshareContext.Provider value={{ maxLevel, effectiveLevels: DEFAULT_CLS_LEVELS }}><ProductComposer {...props} /></ScreenshareContext.Provider>;
    const view = render(ui(null));
    fireEvent.change(screen.getByRole('textbox', { name: 'Section 1 content' }), { target: { value: 'Retained private edit' } });
    view.rerender(ui('TLP:CLEAR'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    view.rerender(ui(null));
    expect(screen.getByRole('textbox', { name: 'Section 1 content' })).toHaveValue('Retained private edit');
    await user.click(screen.getByRole('button', { name: 'Save draft product' }));
    view.rerender(ui('TLP:CLEAR'));
    await act(async () => { pending.resolve(saved); });
    expect(props.onSaved).not.toHaveBeenCalled();
    expect(hasPendingChanges()).toBe(false);
    view.rerender(ui(null));
    await user.click(screen.getByRole('button', { name: 'Open saved product' }));
    expect(props.onSaved).toHaveBeenCalledExactlyOnceWith(saved);
    expect(props.onSave).toHaveBeenCalledOnce();
  });
});
