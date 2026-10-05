import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProductView } from '../components/Products/ProductView';
import type { Note, NoteTemplate } from '../types';
import { DEFAULT_CLS_LEVELS } from '../types';
import { ScreenshareContext } from '../hooks/ScreenshareContext';
import type { ProductComposerSnapshot } from '../lib/product-composer';

const product: Note = {
  id: 'product-1',
  title: 'Finished Intel Note',
  content: '# Finished Intel Note\n\n## Executive Summary\n\nCustomer-ready summary.\n\n| Type | Value |\n| --- | --- |\n| ip | 203.0.113.10 |',
  folderId: 'folder-1',
  tags: ['product', 'intel-note'],
  pinned: false,
  archived: false,
  trashed: false,
  createdAt: 1,
  updatedAt: 2,
};

const baseline: NoteTemplate = {
  id: 'baseline-1',
  name: 'Intelligence Note Baseline',
  content: '# {{ title }}\n\n## Executive Summary\n\n{{ executiveSummary }}',
  category: 'Product Baseline',
  source: 'builtin',
  icon: 'NOTE',
  description: 'Finished intelligence note structure.',
  tags: ['product-baseline', 'jinja'],
  createdAt: 0,
  updatedAt: 0,
};

describe('ProductView', () => {
  const snapshot: ProductComposerSnapshot = {
    folder: { id: 'folder-1', name: 'Fictional local investigation', order: 0, createdAt: 0, clsLevel: 'TLP:GREEN' },
    notes: [], tasks: [], timelineEvents: [], iocs: [], evidence: [],
  };

  it('requires an available local snapshot and saves through the supplied normal-note callback', async () => {
    const save = vi.fn().mockResolvedValue(product);
    const properties = { products: [product], baselines: [baseline], onOpenSourceNote: vi.fn(), onOpenChat: vi.fn(), onSaveDraft: save, effectiveClsLevels: DEFAULT_CLS_LEVELS };
    const { rerender } = render(<ProductView {...properties} />);
    expect(screen.getByRole('button', { name: 'Compose draft' })).toBeDisabled();
    rerender(<ProductView {...properties} composerSnapshot={snapshot} />);
    fireEvent.click(screen.getByRole('button', { name: 'Compose draft' }));
    const composer = screen.getByRole('dialog', { name: 'Compose product' });
    fireEvent.change(within(composer).getByRole('textbox', { name: 'Product title' }), { target: { value: 'Analyst reviewed draft' } });
    fireEvent.click(within(composer).getByRole('button', { name: 'Save draft product' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ title: 'Analyst reviewed draft', clsLevel: 'TLP:GREEN', baselineId: baseline.id }), snapshot, baseline);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Compose product' })).toBeNull());
  });

  it('retains the open draft when screenshare temporarily removes its presentation snapshot', () => {
    const properties = { products: [], baselines: [baseline], onOpenSourceNote: vi.fn(), onOpenChat: vi.fn(), onSaveDraft: vi.fn(), effectiveClsLevels: DEFAULT_CLS_LEVELS };
    const view = (maxLevel: string | null, available?: ProductComposerSnapshot) => <ScreenshareContext.Provider value={{ maxLevel, effectiveLevels: DEFAULT_CLS_LEVELS }}>
      <ProductView {...properties} composerSnapshot={available} />
    </ScreenshareContext.Provider>;
    const { rerender } = render(view(null, snapshot));
    fireEvent.click(screen.getByRole('button', { name: 'Compose draft' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Product title' }), { target: { value: 'Unsaved fictional analysis' } });
    rerender(view('TLP:CLEAR'));
    expect(screen.queryByRole('dialog', { name: 'Compose product' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Compose draft' })).toBeDisabled();
    rerender(view(null, snapshot));
    expect(screen.getByRole('textbox', { name: 'Product title' })).toHaveValue('Unsaved fictional analysis');
    expect(properties.onSaveDraft).not.toHaveBeenCalled();
  });

  it('does not mount media from saved product content in its preview', () => {
    const { container } = render(<ProductView products={[{ ...product, content: '# Report\n\n![Illustration](https://example.test/report.png)' }]}
      baselines={[]} onOpenSourceNote={vi.fn()} onOpenChat={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /preview product/i }));
    expect(container.querySelector('article img')).toBeNull();
    expect(screen.getByRole('dialog', { name: product.title })).toHaveTextContent('Report');
  });

  it('retains a dirty draft and nested confirmation while its owning view is suspended', () => {
    const sessionChange = vi.fn();
    const properties = { products: [], baselines: [baseline], composerSnapshot: snapshot,
      onOpenSourceNote: vi.fn(), onOpenChat: vi.fn(), onSaveDraft: vi.fn(), onComposerSessionChange: sessionChange };
    const view = (active: boolean) => <><button>Other view control</button><ProductView {...properties} active={active} /></>;
    const { rerender } = render(view(true));
    fireEvent.click(screen.getByRole('button', { name: 'Compose draft' }));
    const title = screen.getByRole('textbox', { name: 'Product title' });
    fireEvent.change(title, { target: { value: 'Retained local draft' } });
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Compose product' })).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog', { name: 'Discard unsaved product?' })).toBeVisible();
    expect(sessionChange).toHaveBeenCalledWith(snapshot.folder.id);

    rerender(view(false));
    expect(screen.queryAllByRole('dialog')).toHaveLength(0);
    expect(title).not.toBeVisible();
    expect(title).toHaveValue('Retained local draft');
    expect(document.body.style.overflow).not.toBe('hidden');
    const outside = screen.getByRole('button', { name: 'Other view control' });
    outside.focus();
    expect(outside).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(sessionChange).toHaveBeenCalledTimes(1);

    rerender(view(true));
    const confirmation = screen.getByRole('dialog', { name: 'Discard unsaved product?' });
    expect(confirmation).toBeVisible();
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('textbox', { name: 'Product title' })).toBe(title);
    expect(title).toHaveValue('Retained local draft');
    expect(properties.onSaveDraft).not.toHaveBeenCalled();
  });

  it('keeps the original owner and baseline when another investigation is presented', async () => {
    const save = vi.fn().mockResolvedValue(product);
    const properties = { products: [product], baselines: [baseline], onOpenSourceNote: vi.fn(), onOpenChat: vi.fn(), onSaveDraft: save };
    const { rerender } = render(<ProductView {...properties} composerSnapshot={snapshot} />);
    fireEvent.click(screen.getByRole('button', { name: 'Compose draft' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Product title' }), { target: { value: 'Original owner draft' } });
    const other = { ...snapshot, folder: { ...snapshot.folder, id: 'other-folder', name: 'Different investigation' } };
    rerender(<ProductView {...properties} baselines={[]} composerSnapshot={other} composerActive={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Compose draft' })).toBeDisabled();
    rerender(<ProductView {...properties} composerSnapshot={snapshot} />);
    expect(screen.getByRole('textbox', { name: 'Product title' })).toHaveValue('Original owner draft');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft product' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ title: 'Original owner draft' }), snapshot, baseline));
  });

  it('does not open a saved product in another view when an in-flight save completes', async () => {
    let finish!: (note: Note) => void;
    const save = vi.fn(() => new Promise<Note>(resolve => { finish = resolve; }));
    const sessionChange = vi.fn();
    const properties = { products: [product], baselines: [], composerSnapshot: snapshot,
      onOpenSourceNote: vi.fn(), onOpenChat: vi.fn(), onSaveDraft: save, onComposerSessionChange: sessionChange };
    const { rerender } = render(<ProductView {...properties} />);
    fireEvent.click(screen.getByRole('button', { name: 'Compose draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft product' }));
    rerender(<ProductView {...properties} active={false} />);
    finish(product);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open saved product', hidden: true })).toBeInTheDocument());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sessionChange).toHaveBeenCalledTimes(1);
    rerender(<ProductView {...properties} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open saved product' }));
    expect(screen.getByRole('dialog', { name: product.title })).toBeVisible();
    expect(sessionChange).toHaveBeenLastCalledWith(undefined);
    expect(save).toHaveBeenCalledOnce();
  });

  it('opens product baselines inside the products surface', () => {
    render(
      <ProductView
        folderName="Test Investigation"
        products={[product]}
        baselines={[baseline]}
        onOpenSourceNote={vi.fn()}
        onOpenChat={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /baselines/i }));

    const dialog = screen.getByRole('dialog', { name: /product baselines/i });
    expect(within(dialog).getAllByText('Intelligence Note Baseline').length).toBeGreaterThan(0);
    expect(within(dialog).getByText(/{{ executiveSummary }}/)).toBeInTheDocument();
  });

  it('opens a rendered product preview before source-note navigation', () => {
    const openSourceNote = vi.fn();
    render(
      <ProductView
        folderName="Test Investigation"
        products={[product]}
        baselines={[baseline]}
        onOpenSourceNote={openSourceNote}
        onOpenChat={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /preview product/i }));

    const dialog = screen.getByRole('dialog', { name: 'Finished Intel Note' });
    expect(openSourceNote).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('heading', { name: 'Executive Summary' })).toBeInTheDocument();
    expect(within(dialog).getByText('Customer-ready summary.')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: /^source$/i }));
    expect(openSourceNote).toHaveBeenCalledWith('product-1');
  });
});
