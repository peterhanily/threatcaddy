import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrationPanel } from '../components/Integrations/IntegrationPanel';
import type { IntegrationTemplate } from '../types/integration-types';

const mocks = vi.hoisted(() => ({
  installTemplate: vi.fn(), createInstallation: vi.fn(), addToast: vi.fn(), fetchTeamTemplates: vi.fn(),
}));
vi.mock('../hooks/useIntegrations', () => ({
  useIntegrations: () => ({
    templates: [], installations: [], runs: [], loading: false,
    importTemplate: vi.fn(), installTemplate: mocks.installTemplate, createInstallation: mocks.createInstallation,
    updateInstallation: vi.fn(), deleteInstallation: vi.fn(),
  }),
}));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ connected: true }) }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: mocks.addToast }) }));
vi.mock('../lib/server-api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/server-api')>(),
  fetchTeamTemplates: mocks.fetchTeamTemplates,
}));

const teamTemplate: IntegrationTemplate = {
  id: 'team-fixture', name: 'Fictional team lookup', schemaVersion: '1.0', version: '1', description: 'Shared by a teammate',
  author: 'Teammate', icon: '', color: '#123456', category: 'enrichment', tags: [], source: 'user', createdAt: 1, updatedAt: 1,
  triggers: [{ type: 'manual' }], configSchema: [], requiredDomains: ['intel.example.test', 'files.example.test'], steps: [], outputs: [],
};

describe('team template installation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchTeamTemplates.mockResolvedValue({ templates: [teamTemplate], skipped: 0 });
    mocks.installTemplate.mockResolvedValue(undefined);
    mocks.createInstallation.mockResolvedValue({ id: 'installed' });
  });

  it('installs a teammate template disabled and names the domains it would contact', async () => {
    render(<IntegrationPanel />);
    fireEvent.click(screen.getByRole('button', { name: /^Catalog/ }));
    await screen.findByText('Fictional team lookup');
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));

    await waitFor(() => expect(mocks.createInstallation).toHaveBeenCalledOnce());
    expect(mocks.installTemplate).toHaveBeenCalledWith(expect.objectContaining({ id: 'team-fixture', source: 'team' }), true);
    expect(mocks.createInstallation).toHaveBeenCalledWith('team-fixture', {}, { enabled: false });
    const [, message] = mocks.addToast.mock.calls.at(-1)!;
    expect(message).toContain('Fictional team lookup');
    expect(message).toContain('intel.example.test, files.example.test');
    expect(message).toMatch(/disabled/i);
  });
});
