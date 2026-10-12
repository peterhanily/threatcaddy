import { useState, useEffect, useCallback } from 'react';
import { nanoid } from 'nanoid';
import { db } from '../db';
import type { IntegrationTemplate, InstalledIntegration, IntegrationRun } from '../types/integration-types';
import { BUILTIN_INTEGRATIONS } from '../lib/builtin-integrations';
import { syncProxyAllowedDomains } from '../lib/integration-executor';
import { compileIntegrationPlan, INTEGRATION_LIMITS } from '../lib/integration-plan';

export function useIntegrations() {
  const [templates, setTemplates] = useState<IntegrationTemplate[]>([]);
  const [installations, setInstallations] = useState<InstalledIntegration[]>([]);
  const [runs, setRuns] = useState<IntegrationRun[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    const [dbTemplates, dbInstallations, dbRuns] = await Promise.all([
      db.integrationTemplates.toArray(),
      db.installedIntegrations.toArray(),
      db.integrationRuns.orderBy('createdAt').reverse().limit(100).toArray(),
    ]);

    // Merge builtins with DB templates; DB version wins on duplicate id
    const templateMap = new Map<string, IntegrationTemplate>();
    for (const t of BUILTIN_INTEGRATIONS) templateMap.set(t.id, t);
    for (const t of dbTemplates) templateMap.set(t.id, t);
    const allTemplates = Array.from(templateMap.values());
    setTemplates(allTemplates);

    // Sync allowed proxy domains to extension for defense-in-depth
    syncProxyAllowedDomains(allTemplates);

    setInstallations(dbInstallations);
    setRuns(dbRuns);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAll();
  }, [loadAll]);

  // --- Template management ---

  const installTemplate = useCallback(async (template: IntegrationTemplate) => {
    template = compileIntegrationPlan(template).template as unknown as IntegrationTemplate;
    if (BUILTIN_INTEGRATIONS.some(existing => existing.id === template.id)) {
      throw new Error('An integration with this ID already exists. Import a JSON copy to keep both definitions; existing definitions are not replaced.');
    }
    await db.transaction('rw', [db.integrationTemplates, db.installedIntegrations], async () => {
      if (await db.integrationTemplates.get(template.id) || await db.installedIntegrations.where('templateId').equals(template.id).count()) {
        throw new Error('An integration with this ID already exists. Import a JSON copy to keep both definitions; existing definitions are not replaced.');
      }
      await db.integrationTemplates.add(template);
    });
    setTemplates((prev) => {
      const filtered = prev.filter((t) => t.id !== template.id);
      return [...filtered, template];
    });
  }, []);

  const uninstallTemplate = useCallback(async (templateId: string) => {
    // Find installations for this template and delete them + their runs
    const relatedInstallations = await db.installedIntegrations
      .where('templateId')
      .equals(templateId)
      .toArray();
    const installationIds = relatedInstallations.map((i) => i.id);

    await db.transaction('rw', [db.integrationTemplates, db.installedIntegrations, db.integrationRuns], async () => {
      await db.integrationTemplates.delete(templateId);
      if (installationIds.length > 0) {
        await db.installedIntegrations.bulkDelete(installationIds);
        await db.integrationRuns
          .where('integrationId')
          .anyOf(installationIds)
          .delete();
      }
    });

    setTemplates((prev) => prev.filter((t) => t.id !== templateId));
    setInstallations((prev) => prev.filter((i) => i.templateId !== templateId));
    setRuns((prev) => prev.filter((r) => !installationIds.includes(r.integrationId)));
  }, []);

  const importTemplate = useCallback(async (json: string): Promise<IntegrationTemplate> => {
    if (json.length > INTEGRATION_LIMITS.templateBytes) throw new Error('Integration template exceeds the supported size limit');
    const parsed = JSON.parse(json) as IntegrationTemplate;

    const validated = compileIntegrationPlan(parsed).template as unknown as IntegrationTemplate;

    const template: IntegrationTemplate = {
      ...validated,
      id: nanoid(),
      source: 'user',
      createdAt: validated.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };

    await db.integrationTemplates.add(template);
    setTemplates((prev) => {
      const filtered = prev.filter((t) => t.id !== template.id);
      return [...filtered, template];
    });

    return template;
  }, []);

  // --- Installation management ---

  const createInstallation = useCallback(async (
    templateId: string,
    config: Record<string, unknown>,
  ): Promise<InstalledIntegration> => {
    const template = templates.find((t) => t.id === templateId);
    const now = Date.now();
    const installation: InstalledIntegration = {
      id: nanoid(),
      templateId,
      name: template?.name ?? 'Integration',
      enabled: true,
      config,
      scopeType: 'all',
      scopeFolderIds: [],
      runCount: 0,
      errorCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    await db.installedIntegrations.put(installation);
    setInstallations((prev) => [...prev, installation]);
    return installation;
  }, [templates]);

  const updateInstallation = useCallback(async (id: string, updates: Partial<InstalledIntegration>) => {
    const patched = { ...updates, updatedAt: Date.now() };
    await db.installedIntegrations.update(id, patched);
    setInstallations((prev) => prev.map((i) => (i.id === id ? { ...i, ...patched } : i)));
  }, []);

  const deleteInstallation = useCallback(async (id: string) => {
    await db.transaction('rw', [db.installedIntegrations, db.integrationRuns], async () => {
      await db.installedIntegrations.delete(id);
      await db.integrationRuns.where('integrationId').equals(id).delete();
    });

    setInstallations((prev) => prev.filter((i) => i.id !== id));
    setRuns((prev) => prev.filter((r) => r.integrationId !== id));
  }, []);

  // --- Run management ---

  const addRun = useCallback(async (run: IntegrationRun) => {
    await db.integrationRuns.put(run);

    // Update the installation's stats
    const updateFields: Partial<InstalledIntegration> = {
      lastRunAt: run.createdAt,
      updatedAt: Date.now(),
    };

    await db.installedIntegrations
      .where('id')
      .equals(run.integrationId)
      .modify((inst) => {
        inst.lastRunAt = run.createdAt;
        inst.runCount = (inst.runCount || 0) + 1;
        if (run.status === 'error') {
          inst.errorCount = (inst.errorCount || 0) + 1;
          inst.lastError = run.error;
        }
        inst.updatedAt = updateFields.updatedAt!;
      });

    setRuns((prev) => [run, ...prev].slice(0, 100));
    setInstallations((prev) =>
      prev.map((i) => {
        if (i.id !== run.integrationId) return i;
        return {
          ...i,
          lastRunAt: run.createdAt,
          runCount: (i.runCount || 0) + 1,
          errorCount: run.status === 'error' ? (i.errorCount || 0) + 1 : i.errorCount,
          lastError: run.status === 'error' ? run.error : i.lastError,
          updatedAt: Date.now(),
        };
      }),
    );
  }, []);

  const clearRuns = useCallback(async (integrationId: string) => {
    await db.integrationRuns.where('integrationId').equals(integrationId).delete();
    setRuns((prev) => prev.filter((r) => r.integrationId !== integrationId));
  }, []);

  // --- Helpers ---

  const getTemplateForInstallation = useCallback(
    (installationId: string): IntegrationTemplate | undefined => {
      const installation = installations.find((i) => i.id === installationId);
      if (!installation) return undefined;
      return templates.find((t) => t.id === installation.templateId);
    },
    [installations, templates],
  );

  const getInstallationsForIOCType = useCallback(
    (iocType: string): Array<{ installation: InstalledIntegration; template: IntegrationTemplate }> => {
      const results: Array<{ installation: InstalledIntegration; template: IntegrationTemplate }> = [];

      for (const installation of installations) {
        if (!installation.enabled) continue;

        const template = templates.find((t) => t.id === installation.templateId);
        if (!template) continue;

        const hasMatchingTrigger = template.triggers.some(
          (trigger) =>
            trigger.type === 'manual' &&
            (!trigger.iocTypes || trigger.iocTypes.length === 0 || trigger.iocTypes.includes(iocType as never)),
        );

        if (hasMatchingTrigger) {
          results.push({ installation, template });
        }
      }

      return results;
    },
    [installations, templates],
  );

  return {
    templates,
    installations,
    runs,
    installTemplate,
    uninstallTemplate,
    importTemplate,
    createInstallation,
    updateInstallation,
    deleteInstallation,
    addRun,
    clearRuns,
    getTemplateForInstallation,
    getInstallationsForIOCType,
    loading,
  };
}
