/**
 * R5A-5: builtin lookups take their names from the integrations namespace, which
 * the hosted build loads on demand. An enrichment that an agent runs on its own
 * names them in its result (which the agent reads and the analyst sees under
 * Result), never as a builtin.* key.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '../db';
import type { ToolUseBlock } from '../types';
import i18n from '../i18n';
import { ids, seedAIWorkspace } from './helpers/ai-workspace';
import { installEgressSpy, type EgressSpy } from './helpers/egress-spy';
import { execTool } from './helpers/tool-exec';

const call = (name: string, input: Record<string, unknown>): ToolUseBlock => ({ type: 'tool_use', id: `call-${name}`, name, input });

let egress: EgressSpy;
let restore = () => {};
beforeEach(async () => {
  await seedAIWorkspace();
  localStorage.clear();
  egress = installEgressSpy();
  // As in the hosted build: the namespace arrives only when something loads it.
  const bundle = i18n.getResourceBundle('en', 'integrations') as Record<string, unknown>;
  i18n.removeResourceBundle('en', 'integrations');
  const load = vi.spyOn(i18n, 'loadNamespaces').mockImplementation(async namespaces => {
    if ([namespaces].flat().includes('integrations')) i18n.addResourceBundle('en', 'integrations', bundle);
  });
  restore = () => { load.mockRestore(); i18n.addResourceBundle('en', 'integrations', bundle, true, true); };
  // Slack is not a passive lookup, so an agent's own run skips it and sends nothing.
  await db.installedIntegrations.add({ id: 'slack', templateId: 'slack-webhook-notify', name: 'slack', enabled: true,
    config: { webhookUrl: 'https://hooks.slack.com/services/T0/B0/X0', channel: '#soc' },
    scopeType: 'all', scopeFolderIds: [], runCount: 0, errorCount: 0, createdAt: 1, updatedAt: 1 });
});
afterEach(() => { restore(); egress.restore(); });

it('an enrichment an agent runs on its own names the builtin lookup it skipped', async () => {
  const result = await execTool(call('enrich_ioc', { iocId: ids('S').ioc }), 'S', { surface: 'agent', agentContext: { profileId: 'ap-ioc-enricher' }, approve: false });
  expect(result.isError).toBe(false);
  expect(result.result).not.toContain('builtin.');
  expect(JSON.parse(result.result).results).toEqual([{ name: 'Slack Webhook Notification', status: 'skipped', summary: 'Needs analyst approval' }]);
  expect(egress.fetches).toEqual([]);
});

it('list_integrations describes a builtin lookup in words', async () => {
  const result = await execTool(call('list_integrations', {}), 'S', { surface: 'agent', agentContext: { profileId: 'ap-ioc-enricher' }, approve: false });
  expect(result.isError).toBe(false);
  expect(result.result).not.toContain('builtin.');
});
