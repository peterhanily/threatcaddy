import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { buildFullBackupPayload } from '../lib/backup-data';
import { exportInvestigationJSON } from '../lib/export';
import { TOOL_DEFINITIONS } from '../lib/llm-tools';
import { execTool } from './helpers/tool-exec';
import { workspaceStorageKey } from '../lib/workspace-profiles';
import type { ToolUseBlock } from '../types';
import type { IntegrationTemplate } from '../types/integration-types';

// Tool errors go to the model as JSON, not to users, so they are not localized.
const call = (name: string, input: Record<string, unknown>): ToolUseBlock => ({ type: 'tool_use', id: `tool-${name}`, name, input });
const run = async (name: string, input: Record<string, unknown>) => JSON.parse((await execTool(call(name, input), 'f1')).result);
const base = { tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1 };

beforeEach(async () => {
  await Promise.all(db.tables.map(table => table.clear()));
  localStorage.removeItem(workspaceStorageKey('threatcaddy-settings'));
  await db.folders.add({ id: 'f1', name: 'Case', order: 0, createdAt: 1 });
  await db.timelines.add({ id: 'tl', name: 'Main', order: 0, createdAt: 1, updatedAt: 1 });
  await db.tasks.add({ ...base, id: 't1', title: 'Existing', folderId: 'f1', completed: false, priority: 'none', status: 'todo', order: 0 });
  await db.standaloneIOCs.add({ ...base, id: 'i1', type: 'domain', value: 'evil.example', confidence: 'low', folderId: 'f1' });
  await db.timelineEvents.add({ ...base, id: 'e1', timestamp: 1, title: 'Existing', eventType: 'other', source: 'SIEM', confidence: 'low',
    linkedIOCIds: [], linkedNoteIds: [], linkedTaskIds: [], mitreAttackIds: [], assets: [], starred: false, folderId: 'f1', timelineId: 'tl' });
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.removeItem(workspaceStorageKey('threatcaddy-settings')); });

describe('AI write tools store only values every backup accepts', () => {
  it('lower-cases and hyphenates model spellings, keeping task completion in step with status', async () => {
    const task = await run('create_task', { title: 'Contain', priority: 'High', status: 'IN_PROGRESS' });
    expect(await db.tasks.get(task.id)).toMatchObject({ priority: 'high', status: 'in-progress', completed: false });
    const done = await run('create_task', { title: 'Closed', status: 'Done' });
    expect(await db.tasks.get(done.id)).toMatchObject({ priority: 'none', status: 'done', completed: true });
    await run('update_task', { id: 't1', status: 'DONE', priority: 'LOW' });
    expect(await db.tasks.get('t1')).toMatchObject({ priority: 'low', status: 'done', completed: true });

    const ioc = await run('create_ioc', { type: 'domain', value: 'c2.example', confidence: 'High' });
    expect((await db.standaloneIOCs.get(ioc.id))?.confidence).toBe('high');
    await run('update_ioc', { id: 'i1', confidence: 'CONFIRMED' });
    expect((await db.standaloneIOCs.get('i1'))?.confidence).toBe('confirmed');
    const bulk = await run('bulk_create_iocs', { iocs: [{ type: 'ipv4', value: '203.0.113.5', confidence: 'Medium' }, { type: 'ipv4', value: '203.0.113.6' }] });
    expect((await db.standaloneIOCs.bulkGet(bulk.iocs.map((row: { id: string }) => row.id))).map(row => row?.confidence)).toEqual(['medium', 'medium']);

    const event = await run('create_timeline_event', { title: 'Pivot', timestamp: '2025-01-01T00:00:00Z', eventType: 'lateral_movement' });
    expect((await db.timelineEvents.get(event.id))?.eventType).toBe('lateral-movement');
    await run('update_timeline_event', { id: 'e1', eventType: 'Command_And_Control', confidence: 'High' });
    expect(await db.timelineEvents.get('e1')).toMatchObject({ eventType: 'command-and-control', confidence: 'high' });

    const routed = await run('create_in_investigation', { investigationId: 'f1', entityType: 'task', data: { title: 'Routed', priority: 'MEDIUM' } });
    expect((await db.tasks.get(routed.id))?.priority).toBe('medium');
    const delegated = await run('delegate_task', { title: 'Hunt', description: 'Sweep hosts', assignToProfile: 'Threat Hunter', priority: 'HIGH' });
    expect((await db.tasks.get(delegated.taskId))?.priority).toBe('high');

    const deployed = await run('deploy_agent', { profileName: 'Threat Hunter', competitiveness: 'Competitive' });
    expect((await db.agentDeployments.get(deployed.deploymentId))?.competitiveness).toBe('competitive');
    // One active deployment per profile: each spawn uses a different agent.
    const spawned = await run('spawn_agent', { profileName: 'Malware Analyst', reason: 'Coverage', competitiveness: 'INDEPENDENT' });
    expect((await db.agentDeployments.get(spawned.deploymentId))?.competitiveness).toBe('independent');
    const unspecified = await run('spawn_agent', { profileName: 'Network Forensics', reason: 'Coverage' });
    expect((await db.agentDeployments.get(unspecified.deploymentId))?.competitiveness).toBe('cooperative');

    await expect(buildFullBackupPayload('all')).resolves.toBeDefined();
    await expect(exportInvestigationJSON('f1')).resolves.toContain('"competitiveness": "competitive"');
  });

  it('files a critical ticket as a high-priority local task when no ticketing system is configured', async () => {
    const ticket = await run('create_ticket', { title: 'Escalate', description: 'Ransomware', priority: 'critical' });
    expect(ticket).toMatchObject({ success: true, external: false });
    expect((await db.tasks.get(ticket.taskId))?.priority).toBe('high');
    await expect(buildFullBackupPayload('all')).resolves.toBeDefined();
  });

  it('keeps the critical priority in the payload sent to a configured ticketing system', async () => {
    localStorage.setItem(workspaceStorageKey('threatcaddy-settings'), JSON.stringify({ ticketEndpoint: 'https://tickets.example.test' }));
    const fetch = vi.fn(async () => new Response(JSON.stringify({ id: 'T-1' })));
    vi.stubGlobal('fetch', fetch);
    expect(await run('create_ticket', { title: 'Escalate', description: 'Ransomware', priority: 'critical' })).toMatchObject({ success: true, external: true });
    expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).priority).toBe('critical');
    expect(await db.tasks.count()).toBe(1);
  });

  it.each([
    ['create_task', { title: 'X', priority: 'urgent' }, 'priority'],
    ['create_task', { title: 'X', status: 'blocked' }, 'status'],
    ['update_task', { id: 't1', priority: 'p1' }, 'priority'],
    ['update_task', { id: 't1', status: 'blocked' }, 'status'],
    ['create_ioc', { type: 'domain', value: 'x.example', confidence: 'certain' }, 'confidence'],
    ['update_ioc', { id: 'i1', confidence: 'certain' }, 'confidence'],
    ['bulk_create_iocs', { iocs: [{ type: 'ipv4', value: '203.0.113.7' }, { type: 'ipv4', value: '203.0.113.8', confidence: 'certain' }] }, 'confidence'],
    ['create_timeline_event', { title: 'X', timestamp: '2025-01-01T00:00:00Z', eventType: 'phishing' }, 'eventType'],
    ['update_timeline_event', { id: 'e1', eventType: 'phishing' }, 'eventType'],
    ['update_timeline_event', { id: 'e1', confidence: 'maybe' }, 'confidence'],
    ['create_in_investigation', { investigationId: 'f1', entityType: 'ioc', data: { type: 'domain', value: 'x.example', confidence: 'certain' } }, 'confidence'],
    ['create_ticket', { title: 'X', description: 'Y', priority: 'p1' }, 'priority'],
    ['delegate_task', { title: 'X', description: 'Y', assignToProfile: 'Threat Hunter', priority: 'critical' }, 'priority'],
    ['deploy_agent', { profileName: 'Threat Hunter', competitiveness: 'aggressive' }, 'competitiveness'],
    ['spawn_agent', { profileName: 'Threat Hunter', reason: 'Coverage', competitiveness: 'aggressive' }, 'competitiveness'],
  ])('%s refuses an unsupported value and writes nothing (%#)', async (name, input, field) => {
    const before = await buildFullBackupPayload('all');
    const result = await execTool(call(name, input), 'f1');
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.result).error).toContain(`Unsupported ${field}`);
    expect((await buildFullBackupPayload('all')).data).toEqual(before.data);
  });

  it('declares the confidence values bulk_create_iocs accepts', () => {
    const bulk = TOOL_DEFINITIONS.find(tool => tool.name === 'bulk_create_iocs');
    const items = (bulk?.input_schema.properties.iocs as { items: { properties: Record<string, { enum?: string[] }> } }).items;
    expect(items.properties.confidence.enum).toEqual(['low', 'medium', 'high', 'confirmed']);
  });
});

describe('enrich_ioc stores integration output every backup accepts', () => {
  async function install(outputs: IntegrationTemplate['outputs']) {
    await db.integrationTemplates.add({ id: 'template', schemaVersion: '1.0', version: '1.0.0', name: 'Fixture enrichment', description: 'Synthetic',
      author: 'test', icon: 'search', color: '#000', category: 'enrichment', tags: [], triggers: [{ type: 'manual' }], configSchema: [],
      steps: [], outputs, requiredDomains: [], source: 'user', createdAt: 1, updatedAt: 1 });
    await db.installedIntegrations.add({ id: 'installed', templateId: 'template', name: 'Fixture', enabled: true, config: {},
      scopeType: 'all', scopeFolderIds: [], runCount: 0, errorCount: 0, createdAt: 1, updatedAt: 1 });
  }

  it('adds a snapshot beside earlier ones, normalises confidence and stores only supported fields', async () => {
    await db.standaloneIOCs.update('i1', { enrichment: { shodan: [{ org: 'Example', ts: 1 }] } });
    await install([
      // Shaped like the built-in VirusTotal, AbuseIPDB and URLhaus outputs.
      { type: 'update-ioc', template: { id: '{{ioc.id}}', enrichment: { virusTotal: { malicious: '3' } } } },
      { type: 'update-ioc', template: { id: '{{ioc.id}}', iocStatus: 'malicious', confidence: 'High', verdict: 'unsupported' } },
      { type: 'create-ioc', template: { type: 'domain', value: 'c2.example', confidence: 'High' } },
    ]);
    expect((await run('enrich_ioc', { iocId: 'i1' })).results).toEqual([expect.objectContaining({ status: 'success' })]);

    const ioc = await db.standaloneIOCs.get('i1');
    expect(ioc).toMatchObject({ iocStatus: 'malicious', confidence: 'high' });
    expect(ioc).not.toHaveProperty('verdict');
    expect(ioc?.enrichment?.shodan).toEqual([expect.objectContaining({ org: 'Example', ts: 1 })]);
    expect(ioc?.enrichment?.virusTotal).toEqual([expect.objectContaining({ malicious: '3', ts: expect.any(Number) })]);
    expect((await db.standaloneIOCs.toArray()).find(row => row.value === 'c2.example')?.confidence).toBe('high');
    await expect(buildFullBackupPayload('all')).resolves.toBeDefined();
    await expect(exportInvestigationJSON('f1')).resolves.toContain('c2.example');
  });

  it('keeps the stored IOC status when an output sets it to null, instead of storing the text "null"', async () => {
    await db.standaloneIOCs.update('i1', { iocStatus: 'suspicious' });
    await install([{ type: 'update-ioc', template: { id: '{{ioc.id}}', iocStatus: null } }]);
    expect((await run('enrich_ioc', { iocId: 'i1' })).results).toEqual([expect.objectContaining({ status: 'success' })]);
    expect((await db.standaloneIOCs.get('i1'))?.iocStatus).toBe('suspicious');
  });

  it('keeps the stored confidence, or the default for a new IOC, when the output has no supported value', async () => {
    await install([
      { type: 'update-ioc', template: { id: '{{ioc.id}}', confidence: 'score-7' } },
      { type: 'create-ioc', template: { type: 'domain', value: 'c2.example', confidence: '7' } },
    ]);
    expect((await run('enrich_ioc', { iocId: 'i1' })).results).toEqual([expect.objectContaining({ status: 'success' })]);
    expect((await db.standaloneIOCs.get('i1'))?.confidence).toBe('low');
    expect((await db.standaloneIOCs.toArray()).find(row => row.value === 'c2.example')?.confidence).toBe('medium');
    await expect(buildFullBackupPayload('all')).resolves.toBeDefined();
  });
});
