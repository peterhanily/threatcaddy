import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrationPanel } from '../components/Integrations/IntegrationPanel';
import { BUILTIN_INTEGRATIONS } from '../lib/builtin-integrations';

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

async function openCatalog() {
  render(<IntegrationPanel />);
  fireEvent.click(screen.getByRole('button', { name: /^Catalog/ }));
  await screen.findByRole('button', { name: 'Import JSON File' });
}

describe('integration catalog', () => {
  const request = vi.fn<typeof fetch>();
  beforeEach(() => {
    request.mockReset();
    mocks.importTemplate.mockReset();
    mocks.createInstallation.mockReset();
    vi.stubGlobal('fetch', request);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('offers packaged integrations and custom import, and fetches no remote catalog', async () => {
    await openCatalog();
    expect(request).not.toHaveBeenCalled();
    expect(screen.getByText('VirusTotal IP Lookup')).toBeVisible();
    // SITE-10: the community catalog's repository was never published.
    expect(screen.queryByText(/community (?:catalog|templates)/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /community catalog/i })).not.toBeInTheDocument();
    const custom = JSON.stringify({ id: 'custom', name: 'Local custom template', steps: [], outputs: [] });
    fireEvent.change(screen.getByPlaceholderText('Or paste template JSON here...'), { target: { value: custom } });
    fireEvent.click(screen.getByRole('button', { name: 'Import from Paste' }));
    expect(mocks.importTemplate).toHaveBeenCalledWith(custom);
    expect(request).not.toHaveBeenCalled();
    await screen.findByText('Template imported as a separate copy. Configure it before running.');
  });

  it('awaits import persistence, prevents a duplicate submission and retains the draft on failure', async () => {
    let reject!: (error: Error) => void;
    mocks.importTemplate.mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    await openCatalog();
    const draft = screen.getByPlaceholderText('Or paste template JSON here...');
    fireEvent.change(draft, { target: { value: '{"name":"Fictional draft"}' } });
    const submit = screen.getByRole('button', { name: 'Import from Paste' });
    fireEvent.click(submit); fireEvent.click(submit);
    expect(mocks.importTemplate).toHaveBeenCalledOnce();
    expect(submit).toBeDisabled();
    expect(draft).toHaveValue('{"name":"Fictional draft"}');
    await act(async () => reject(new Error('Synthetic storage unavailable')));
    expect(screen.getByRole('alert')).toHaveTextContent('Synthetic storage unavailable');
    expect(draft).toHaveValue('{"name":"Fictional draft"}');
    expect(submit).toBeEnabled();
  });

  it('does not clear newer pasted edits when an earlier import commits', async () => {
    let finish!: () => void;
    mocks.importTemplate.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    await openCatalog();
    const draft = screen.getByPlaceholderText('Or paste template JSON here...');
    fireEvent.change(draft, { target: { value: '{"name":"First"}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import from Paste' }));
    fireEvent.change(draft, { target: { value: '{"name":"Newer unsaved draft"}' } });
    await act(async () => finish());
    expect(draft).toHaveValue('{"name":"Newer unsaved draft"}');
    expect(screen.getByRole('status')).toHaveTextContent('Template imported');
  });

  it('catches asynchronous file import rejection and allows selecting the same file again', async () => {
    mocks.importTemplate.mockRejectedValueOnce(new Error('Synthetic validation failure'));
    await openCatalog();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['{"name":"Fictional file"}'], 'fixture.json', { type: 'application/json' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic validation failure');
    expect(input).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Import JSON File' })).toBeEnabled();
    mocks.importTemplate.mockResolvedValueOnce(undefined);
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByRole('status')).toHaveTextContent('Template imported');
    expect(mocks.importTemplate).toHaveBeenCalledTimes(2);
  });
});
