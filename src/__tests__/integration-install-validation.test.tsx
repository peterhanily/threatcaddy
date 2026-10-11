import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { useIntegrations } from '../hooks/useIntegrations';
import { BUILTIN_INTEGRATIONS } from '../lib/builtin-integrations';
import type { IntegrationTemplate } from '../types/integration-types';

const definition: IntegrationTemplate = { id: 'synthetic-definition', name: 'Synthetic definition', schemaVersion: '1.0', version: '1', description: '', author: '',
  icon: '', color: '', category: 'utility', tags: [], source: 'user', createdAt: 1, updatedAt: 1,
  triggers: [{ type: 'manual' }], configSchema: [], requiredDomains: [], steps: [], outputs: [] };
beforeEach(async () => { await db.integrationTemplates.clear(); await db.installedIntegrations.clear(); });
afterEach(async () => { await db.integrationTemplates.clear(); await db.installedIntegrations.clear(); });

describe('integration installation validation', () => {
  it('retains the existing record when an imported or catalog replacement has invalid shape', async () => {
    await db.integrationTemplates.put(definition);
    const { result, unmount } = renderHook(useIntegrations);
    await waitFor(() => expect(result.current.loading).toBe(false));
    const invalid = { ...definition, name: 'Must not replace', outputs: {} };
    await act(async () => {
      await expect(result.current.importTemplate(JSON.stringify(invalid))).rejects.toThrow('outputs');
      await expect(result.current.installTemplate(invalid as unknown as IntegrationTemplate)).rejects.toThrow('outputs');
    });
    expect(await db.integrationTemplates.get(definition.id)).toEqual(definition);
    unmount();
  });
  it('accepts an exported definition without runtime timestamps and assigns local provenance', async () => {
    const { result, unmount } = renderHook(useIntegrations);
    await waitFor(() => expect(result.current.loading).toBe(false));
    const portable = Object.fromEntries(Object.entries(definition).filter(([key]) => key !== 'createdAt' && key !== 'updatedAt'));
    await act(async () => { await result.current.importTemplate(JSON.stringify({ ...portable, source: 'community' })); });
    const [imported] = await db.integrationTemplates.toArray();
    expect(imported).toMatchObject({ ...portable, id: expect.any(String), source: 'user', createdAt: expect.any(Number), updatedAt: expect.any(Number) });
    expect(imported.id).not.toBe(definition.id);
    unmount();
  });
  it('imports a fresh copy and refuses catalog/team replacement without changing existing credentials', async () => {
    await db.integrationTemplates.put(definition);
    const installed = { id: 'synthetic-installation', templateId: definition.id, name: 'Existing', enabled: true,
      config: { token: 'fictional-not-a-real-secret' }, scopeType: 'all' as const, scopeFolderIds: [], runCount: 2, errorCount: 0, createdAt: 1, updatedAt: 1 };
    await db.installedIntegrations.put(installed);
    const { result, unmount } = renderHook(useIntegrations);
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await expect(result.current.installTemplate({ ...definition, name: 'Replacement' })).rejects.toThrow('already exists');
      const imported = await result.current.importTemplate(JSON.stringify({ ...definition, name: 'New copy' }));
      expect(imported.id).not.toBe(definition.id);
    });
    expect(await db.integrationTemplates.get(definition.id)).toEqual(definition);
    expect(await db.installedIntegrations.get(installed.id)).toEqual(installed);
    expect(await db.integrationTemplates.count()).toBe(2);
    unmount();
  });
  it('refuses builtin and retained-installation identifiers before adding a definition', async () => {
    const builtin = BUILTIN_INTEGRATIONS[0];
    if (!builtin) throw new Error('Expected a builtin fixture');
    await db.installedIntegrations.put({ id: 'retained-installation', templateId: definition.id, name: 'Retained', enabled: false,
      config: {}, scopeType: 'all', scopeFolderIds: [], runCount: 0, errorCount: 0, createdAt: 1, updatedAt: 1 });
    const { result, unmount } = renderHook(useIntegrations);
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await expect(result.current.installTemplate({ ...definition, id: builtin.id })).rejects.toThrow('already exists');
      await expect(result.current.installTemplate(definition)).rejects.toThrow('already exists');
    });
    expect(await db.integrationTemplates.count()).toBe(0);
    expect(await db.installedIntegrations.count()).toBe(1);
    unmount();
  });
  it('serializes concurrent catalog installs without replacing the winner', async () => {
    const { result, unmount } = renderHook(useIntegrations);
    await waitFor(() => expect(result.current.loading).toBe(false));
    let outcomes: PromiseSettledResult<void>[] = [];
    await act(async () => {
      outcomes = await Promise.allSettled([
        result.current.installTemplate({ ...definition, name: 'First copy' }),
        result.current.installTemplate({ ...definition, name: 'Second copy' }),
      ]);
    });
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(1);
    expect(await db.integrationTemplates.count()).toBe(1);
    expect(await db.integrationTemplates.get(definition.id)).toMatchObject({ name: 'First copy' });
    unmount();
  });
});
