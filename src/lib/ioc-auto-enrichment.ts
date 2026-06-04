import { nanoid } from 'nanoid';
import { db } from '../db';
import { IntegrationExecutor, type ExecutionOptions } from './integration-executor';
import type { StandaloneIOC } from '../types';
import type { InstalledIntegration, IntegrationRun, IntegrationTemplate } from '../types/integration-types';
import { persistIOCIntegrationUpdate } from './ioc-enrichment-persistence';

const SUPPORTED_VT_TYPES = new Set(['ipv4', 'ipv6', 'domain', 'md5', 'sha1', 'sha256']);
const VT_TEMPLATE_IDS = new Set(['vt-ip-lookup', 'vt-domain-lookup', 'vt-hash-lookup']);
const AUTO_TAG_PREFIX = 'auto-enrich:vt:';
type AutoEnrichStatus = 'queued' | 'checked' | 'error' | 'skipped';

export interface AutoEnrichOptions {
  maxIOCs?: number;
  investigation?: { id: string; name: string };
  getInstallationsForIOCType: (type: string) => Array<{ installation: InstalledIntegration; template: IntegrationTemplate }>;
  addRun: (run: IntegrationRun) => Promise<void>;
  executionOptions?: ExecutionOptions;
  onComplete?: (stats: { queued: number; enriched: number; errors: number; skipped: number; missingIntegration: number }) => void;
}

function isRunnableIOC(ioc: StandaloneIOC): boolean {
  return Boolean(ioc.id && ioc.value?.trim() && SUPPORTED_VT_TYPES.has(ioc.type));
}

function nextTags(existing: string[] | undefined, status: AutoEnrichStatus): string[] {
  const preserved = (existing || []).filter((tag) => !tag.startsWith(AUTO_TAG_PREFIX));
  return [...preserved, `${AUTO_TAG_PREFIX}${status}`];
}

async function mergeIOCUpdate(id: string, fields: Record<string, unknown>): Promise<void> {
  const existing = await db.standaloneIOCs.get(id);
  if (!existing) return;
  await persistIOCIntegrationUpdate({
    ioc: { id, value: existing.value, type: existing.type, confidence: existing.confidence },
    fields,
    folderId: existing.folderId,
    tags: nextTags(existing.tags, 'checked'),
  });
}

async function markQueued(ioc: StandaloneIOC): Promise<void> {
  await db.standaloneIOCs.update(ioc.id, {
    tags: nextTags(ioc.tags, 'queued'),
    updatedAt: Date.now(),
  });
}

async function markError(ioc: StandaloneIOC): Promise<void> {
  const latest = await db.standaloneIOCs.get(ioc.id);
  await db.standaloneIOCs.update(ioc.id, {
    tags: nextTags(latest?.tags || ioc.tags, 'error'),
    updatedAt: Date.now(),
  });
}

async function markSkipped(ioc: StandaloneIOC): Promise<void> {
  const latest = await db.standaloneIOCs.get(ioc.id);
  await db.standaloneIOCs.update(ioc.id, {
    tags: nextTags(latest?.tags || ioc.tags, 'skipped'),
    updatedAt: Date.now(),
  });
}

// Stamp the final 'checked' status, replacing the tag set so the earlier
// 'queued' marker can't linger (persistIOCIntegrationUpdate unions tags, and a
// successful run may not emit an update-ioc step at all).
async function markChecked(ioc: StandaloneIOC): Promise<void> {
  const latest = await db.standaloneIOCs.get(ioc.id);
  await db.standaloneIOCs.update(ioc.id, {
    tags: nextTags(latest?.tags || ioc.tags, 'checked'),
    updatedAt: Date.now(),
  });
}

export async function autoEnrichImportedIOCs(
  iocs: StandaloneIOC[],
  options: AutoEnrichOptions,
): Promise<{ queued: number; enriched: number; errors: number; skipped: number; missingIntegration: number }> {
  const maxIOCs = Math.max(1, options.maxIOCs ?? 50);
  const candidates = iocs
    .filter(isRunnableIOC)
    .filter((ioc) => !ioc.enrichment?.virusTotal?.length)
    .slice(0, maxIOCs);

  const stats = {
    queued: candidates.length,
    enriched: 0,
    errors: 0,
    skipped: Math.max(0, iocs.length - candidates.length),
    missingIntegration: 0,
  };

  if (candidates.length === 0) {
    options.onComplete?.(stats);
    return stats;
  }

  const executor = new IntegrationExecutor();

  for (const ioc of candidates) {
    const vtIntegrations = options
      .getInstallationsForIOCType(ioc.type)
      .filter(({ template }) => VT_TEMPLATE_IDS.has(template.id));

    if (vtIntegrations.length === 0) {
      stats.skipped += 1;
      stats.missingIntegration += 1;
      await markSkipped(ioc);
      continue;
    }

    await markQueued(ioc);
    const { installation, template } = vtIntegrations[0];

    try {
      const run = await executor.run(
        template,
        installation,
        {
          ioc: { id: ioc.id, value: ioc.value, type: ioc.type, confidence: ioc.confidence },
          investigation: options.investigation,
        },
        {
          onUpdateEntity: async (type, id, fields) => {
            if (type === 'ioc') await mergeIOCUpdate(id, fields);
          },
          onNotify: () => {},
        },
        undefined,
        options.executionOptions,
      );

      await options.addRun({
        ...run,
        id: run.id || nanoid(),
      });

      if (run.status === 'success') {
        stats.enriched += 1;
        await markChecked(ioc);
      } else {
        stats.errors += 1;
        await markError(ioc);
      }
    } catch {
      stats.errors += 1;
      await markError(ioc);
    }

    await new Promise((resolve) => window.setTimeout(resolve, 1_000));
  }

  options.onComplete?.(stats);
  return stats;
}
