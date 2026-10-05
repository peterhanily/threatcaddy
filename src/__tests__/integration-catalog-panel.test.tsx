import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrationPanel } from '../components/Integrations/IntegrationPanel';
import { BUILTIN_INTEGRATIONS } from '../lib/builtin-integrations';
import type { CatalogEntry } from '../types/integration-types';

const mocks = vi.hoisted(() => ({ importTemplate: vi.fn(), createInstallation: vi.fn() }));
vi.mock('../hooks/useIntegrations', () => ({
  useIntegrations: () => ({
    templates: BUILTIN_INTEGRATIONS, installations: [], runs: [], loading: false,
    importTemplate: mocks.importTemplate, createInstallation: mocks.createInstallation,
    installTemplate: vi.fn(), updateInstallation: vi.fn(), deleteInstallation: vi.fn(),
  }),
}));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ connected: false }) }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));

const entry: CatalogEntry = {
  id: 'community-fixture', name: 'Fictional community entry', description: 'Test catalog entry',
  author: 'Test', category: 'utility', tags: [], icon: 'test', color: '#123456',
  version: '1.0.0', downloads: 0, templateUrl: 'https://example.test/template.json', sha256: '', updatedAt: '2026-10-05',
};

async function openCatalog() {
  render(<IntegrationPanel />);
  fireEvent.click(screen.getByRole('button', { name: /^Catalog/ }));
  await screen.findByRole('button', { name: 'Load community catalog' });
}

describe('community catalog availability', () => {
  const request = vi.fn<typeof fetch>();
  beforeEach(() => {
    request.mockReset();
    mocks.importTemplate.mockReset();
    mocks.createInstallation.mockReset();
    localStorage.removeItem('threatcaddy-integration-catalog');
    vi.stubGlobal('fetch', request);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps packaged integrations and custom import available without automatic remote requests', async () => {
    await openCatalog();
    expect(request).not.toHaveBeenCalled();
    expect(screen.getByText('VirusTotal IP Lookup')).toBeVisible();
    expect(screen.getByText(/community catalog is optional/i)).toBeVisible();
    const custom = JSON.stringify({ id: 'custom', name: 'Local custom template', steps: [], outputs: [] });
    fireEvent.change(screen.getByPlaceholderText('Or paste template JSON here...'), { target: { value: custom } });
    fireEvent.click(screen.getByRole('button', { name: 'Import from Paste' }));
    expect(mocks.importTemplate).toHaveBeenCalledWith(custom);
    expect(request).not.toHaveBeenCalled();
  });

  it('reports the unavailable publisher truthfully, then clears that status on a successful retry', async () => {
    request.mockResolvedValueOnce(new Response('', { status: 404 }));
    request.mockResolvedValueOnce(new Response(JSON.stringify({ entries: [entry] })));
    await openCatalog();
    fireEvent.click(screen.getByRole('button', { name: 'Load community catalog' }));
    expect(await screen.findByRole('status')).toHaveTextContent('HTTP 404');
    expect(screen.getByRole('status')).toHaveTextContent('Built-in integrations and custom imports remain available');
    expect(screen.queryByText('No community templates available yet.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry community catalog' }));
    expect(await screen.findByText(entry.name)).toBeVisible();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
  });

  it('shows saved entries with a stale/offline warning and preserves them through a failed retry', async () => {
    localStorage.setItem('threatcaddy-integration-catalog', JSON.stringify({ entries: [entry], fetchedAt: 1 }));
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await openCatalog();
    fireEvent.click(screen.getByRole('button', { name: 'Load community catalog' }));
    expect(await screen.findByText(entry.name)).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('You are offline');
    expect(screen.getByRole('status')).toHaveTextContent('may be out of date');
    expect(request).not.toHaveBeenCalled();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    request.mockRejectedValueOnce(new TypeError('Offline'));
    fireEvent.click(screen.getByRole('button', { name: 'Retry community catalog' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('could not be reached'));
    expect(screen.getByText(entry.name)).toBeVisible();
    expect(JSON.parse(localStorage.getItem('threatcaddy-integration-catalog') ?? '{}').entries).toEqual([entry]);
  });

  it('prevents overlapping refreshes and leaves valid empty success distinguishable from failure', async () => {
    let finish!: (response: Response) => void;
    request.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    await openCatalog();
    const load = screen.getByRole('button', { name: 'Load community catalog' });
    fireEvent.click(load);
    fireEvent.click(load);
    expect(request).toHaveBeenCalledOnce();
    expect(load).toBeDisabled();
    await act(async () => finish(new Response(JSON.stringify({ entries: [] }))));
    expect(screen.getByText('No community templates available yet.')).toBeVisible();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
