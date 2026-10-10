import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { exportEncryptedJSON, exportJSON, importJSON, mergeImportJSON } from '../lib/export';
import { BACKUP_TABLES } from '../lib/backup-tables';
import { buildFullBackupPayload } from '../lib/backup-data';
import { backupFingerprint, decryptBackup, encryptBackup } from '../lib/backup-crypto';
import { BackupPasswordRequiredError, decodePortableBackup } from '../lib/portable-backup';
import { validatePortableTables } from '../lib/backup-records';
import { BUILTIN_INTEGRATIONS } from '../lib/builtin-integrations';
import { workspaceStorageKey } from '../lib/workspace-profiles';
import { restoreFullReplace } from '../lib/backup-restore';

const note = (id = 'note') => ({ id, title: 'Synthetic note', content: 'Complete content', tags: [], pinned: false,
  archived: false, trashed: false, createdAt: 10, updatedAt: 20 });
const installation = () => ({ id: 'installed', templateId: 'integration', name: 'Synthetic integration', enabled: false,
  config: {}, scopeType: 'all', scopeFolderIds: [], runCount: 0, errorCount: 0, createdAt: 10, updatedAt: 20 });
const legacy = (extra: Record<string, unknown> = {}) => ({ version: 1, exportedAt: 20, notes: [note()], tasks: [], folders: [], tags: [], ...extra });
const settingsKey = workspaceStorageKey('threatcaddy-settings');
async function clear() {
  await db.transaction('rw', BACKUP_TABLES.map(name => db.table(name)), async () => {
    for (const name of BACKUP_TABLES) await db.table(name).clear();
  });
}
async function snapshot() { return (await buildFullBackupPayload('all')).data; }
beforeEach(async () => { await clear(); localStorage.removeItem(settingsKey); });
afterEach(() => vi.restoreAllMocks());

describe('portable backup contracts', () => {
  it('uses exactly the shared19-table registry and retains the established flat version1 fields', async () => {
    const document = JSON.parse(await exportJSON());
    expect(document).toMatchObject({ format: 'threatcaddy-backup', version: 1 });
    expect(Object.keys(document).filter(name => BACKUP_TABLES.includes(name as typeof BACKUP_TABLES[number]))).toEqual([...BACKUP_TABLES]);
    for (const name of BACKUP_TABLES) expect(document[name]).toEqual([]);
    expect(Object.keys((await decodePortableBackup(JSON.stringify(document))).payload.data)).toEqual([...BACKUP_TABLES]);
  });

  it('accepts every bundled integration schema without inventing a second incompatible template format', () => {
    expect(() => validatePortableTables({ integrationTemplates: BUILTIN_INTEGRATIONS })).not.toThrow();
  });

  it('preserves long Unicode note/chat content and nested supported metadata without truncation', async () => {
    const content = 'Synthetic 中文. '.repeat(45_000);
    expect(content.length).toBeGreaterThan(500_000);
    await db.notes.add({ ...note(), content, annotations: [{ id: 'annotation', text: content, createdAt: 10 }] });
    await db.tasks.add({ id: 'task', title: 'Task', completed: false, priority: 'none', status: 'todo', order: 0,
      tags: [], archived: false, trashed: false, createdAt: 10, updatedAt: 20, checklist: [{ id: 'check', text: 'Retained', done: false }] });
    const thread = { id: 'chat', title: 'Chat', messages: [{ id: 'message', role: 'assistant' as const, content, createdAt: 10,
      tokenCount: { input: 0, output: 1 }, userId: 'fictional-user', toolCalls: [{ id: 'call', name: 'read_note', input: { id: 'note' }, result: 'Synthetic result', isError: false }] }],
    model: 'synthetic', provider: 'local' as const, tags: [], clsLevel: 'TLP:RED', mode: 'plan' as const, source: 'user' as const,
    contextSummary: content, archived: false, trashed: false, createdAt: 10, updatedAt: 20 };
    await db.chatThreads.add(thread);
    const json = await exportJSON();
    await clear();
    await importJSON(json);
    expect(await db.notes.get('note')).toMatchObject({ content, annotations: [{ id: 'annotation', text: content, createdAt: 10 }] });
    expect(await db.tasks.get('task')).toMatchObject({ checklist: [{ id: 'check', text: 'Retained', done: false }] });
    expect(await db.chatThreads.get('chat')).toMatchObject(thread);
  });

  it('retains source provenance, empty nested collections, and false/zero values', async () => {
    await db.agentProfiles.add({ id: 'profile', name: 'Synthetic profile', role: 'observer', systemPrompt: '',
      policy: { autoApproveReads: false, autoApproveEnrich: false, autoApproveFetch: false, autoApproveCreate: false, autoApproveModify: false, intervalMinutes: 0 },
      allowedTools: [], priority: 0, source: 'user', createdBy: 'fictional-author', updatedBy: 'fictional-reviewer', createdAt: 10, updatedAt: 20 });
    const source = await db.agentProfiles.get('profile');
    if (!source) throw new Error('Synthetic profile did not persist');
    const json = await exportJSON();
    await clear();
    await importJSON(json);
    expect(await db.agentProfiles.get('profile')).toMatchObject(source);
  });

  it('redacts all installed configuration from plaintext with explicit recoverability metadata', async () => {
    await db.table('installedIntegrations').add({ ...installation(), config: { undeclaredCredential: 'fictional-value', nested: { ordinary: false } } });
    const document = JSON.parse(await exportJSON());
    expect(document.redactions).toEqual(['installedIntegrations.config']);
    expect(document.installedIntegrations[0].config).toEqual({});
    expect(JSON.stringify(document)).not.toContain('fictional-value');
    await clear();
    const result = await importJSON(JSON.stringify(document));
    expect(result.warnings?.join(' ')).toContain('configuration was omitted');
    expect(await db.installedIntegrations.get('installed')).toMatchObject({ enabled: false, config: {} });
  });

  it('preserves configuration only inside actual encrypted exports and supports retry after wrong password', async () => {
    const config = { credential: 'fictional-only', count: 0, enabled: false, labels: ['synthetic'] };
    await db.table('installedIntegrations').add({ ...installation(), config });
    const json = await exportEncryptedJSON('synthetic-backup-password');
    expect(json).not.toContain('fictional-only');
    await clear();
    await expect(importJSON(json)).rejects.toBeInstanceOf(BackupPasswordRequiredError);
    await expect(importJSON(json, 'wrong')).rejects.toThrow('Wrong password');
    expect(await db.installedIntegrations.count()).toBe(0);
    await importJSON(json, 'synthetic-backup-password');
    expect(await db.installedIntegrations.get('installed')).toMatchObject({ config, enabled: false });
    await expect(exportEncryptedJSON(' ')).rejects.toThrow('non-empty');
  });

  it('reads historical plaintext cloud wrappers and the historical encrypted cloud data envelope', async () => {
    const document = legacy();
    await importJSON(JSON.stringify({ version: 1, type: 'full-backup', sharedAt: 20, sharedBy: 'synthetic', payload: document }));
    expect(await db.notes.get('note')).toMatchObject(note());
    await clear();
    const encrypted = await encryptBackup('synthetic-password', { version: 1, type: 'full', scope: 'all', createdAt: 20, data: document });
    await importJSON(JSON.stringify(encrypted), 'synthetic-password');
    expect(await db.notes.get('note')).toMatchObject(note());
  });

  it('does not rewrite canonical full payload bytes or differential parent fingerprints during decoding', async () => {
    await db.notes.add(note());
    const payload = await buildFullBackupPayload('all');
    const hash = await backupFingerprint(payload);
    const decoded = await decodePortableBackup(JSON.stringify(payload));
    expect(decoded.payload).toEqual(payload);
    expect(await backupFingerprint(decoded.payload)).toBe(hash);
    expect(await backupFingerprint(payload)).toBe(hash);
  });

  it('rejects incomplete canonical/server records but safely fills known defaults in legacy flat files', async () => {
    await db.notes.add(note('retained'));
    const before = await snapshot();
    const payload = { version: 1 as const, type: 'full' as const, scope: 'all' as const, createdAt: 20, data: { notes: [{ id: 'incomplete' }] } };
    await expect(restoreFullReplace(payload)).rejects.toThrow('notes.title');
    await expect(importJSON(JSON.stringify(payload))).rejects.toThrow('notes.title');
    expect(await snapshot()).toEqual(before);
    await importJSON(JSON.stringify(legacy({ notes: [{ id: 'legacy', title: 'Old supported note' }] })));
    expect(await db.notes.get('legacy')).toMatchObject({ title: 'Old supported note', content: '', tags: [], archived: false });
  });

  it('suspends restored automation and invalidates old approval without altering the backup archive', async () => {
    const data = legacy({ folders: [{ id: 'folder', name: 'Folder', order: 0, createdAt: 10, agentEnabled: true, agentStatus: 'running' }],
      agentActions: [{ id: 'action', investigationId: 'folder', threadId: 'chat', toolName: 'create_note', toolInput: {}, rationale: 'Synthetic', status: 'approved', toolBinding: 'historical-binding', createdAt: 10 }],
      installedIntegrations: [{ ...installation(), enabled: true }],
      agentDeployments: [{ id: 'deployment', investigationId: 'folder', profileId: 'profile', status: 'running', serverSideEnabled: true, serverBotConfigId: 'historical-server', handoffState: 'server', order: 0, createdAt: 10, updatedAt: 20 }] });
    const archivedJSON = JSON.stringify(data);
    const result = await importJSON(archivedJSON);
    expect(result.warnings?.join(' ')).toContain('automation is inactive');
    expect(await db.folders.get('folder')).toMatchObject({ agentEnabled: false, agentStatus: 'paused' });
    expect(await db.agentActions.get('action')).toMatchObject({ status: 'rejected' });
    expect(await db.agentActions.get('action')).not.toHaveProperty('toolBinding');
    expect(await db.installedIntegrations.get('installed')).toMatchObject({ enabled: false });
    expect(await db.agentDeployments.get('deployment')).toMatchObject({ status: 'paused', shift: 'resting', serverSideEnabled: false });
    expect(await db.agentDeployments.get('deployment')).not.toHaveProperty('serverBotConfigId');
    expect(JSON.stringify(data)).toBe(archivedJSON);
  });

  it('preserves absent legacy tables but clears explicitly empty collections, including quick links', async () => {
    await db.table('customSlashCommands').add({ id: 'command', name: 'synthetic', description: '', template: 'Retain', createdAt: 10, updatedAt: 20 });
    const quickLinks = [{ id: 'link', title: 'Synthetic', url: 'https://example.test/' }];
    localStorage.setItem(settingsKey, JSON.stringify({ quickLinks, unrelatedSetting: true }));
    await importJSON(JSON.stringify(legacy()));
    expect(await db.customSlashCommands.count()).toBe(1);
    expect(JSON.parse(localStorage.getItem(settingsKey) ?? 'null').quickLinks).toEqual(quickLinks);
    await importJSON(JSON.stringify(legacy({ customSlashCommands: [], quickLinks: [] })));
    expect(await db.customSlashCommands.count()).toBe(0);
    expect(JSON.parse(localStorage.getItem(settingsKey) ?? 'null')).toEqual({ quickLinks: [], unrelatedSetting: true });
  });

  it('reports settings failure as a warning after committed entities rather than claiming rollback', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Synthetic unavailable settings store'); });
    const result = await importJSON(JSON.stringify(legacy({ quickLinks: [] })));
    expect(await db.notes.get('note')).toMatchObject(note());
    expect(result.warnings?.join(' ')).toContain('data was restored, but quick-link settings');
  });

  it.each([
    ['duplicate identity', { notes: [note(), note()] }],
    ['blank identity', { notes: [{ ...note(), id: '' }] }],
    ['malformed table', { tasks: {} }],
    ['invalid supported field', { notes: [{ ...note(), title: 3 }] }],
    ['malformed nested message', { chatThreads: [{ id: 'chat', messages: [{ id: 'message', role: 'user', content: {} }] }] }],
    ['unsupported nested field', { tasks: [{ id: 'task', checklist: [{ id: 'check', text: 'Synthetic', done: false, futureField: 1 }] }] }],
    ['incomplete profile', { agentProfiles: [{ id: 'profile' }] }],
    ['incomplete profile soul', { agentProfiles: [{ id: 'profile', name: 'Synthetic', soul: {} }] }],
    ['incomplete profile lifetime metrics', { agentProfiles: [{ id: 'profile', name: 'Synthetic', soul: { identity: '', lessons: [], strengths: [], weaknesses: [], updatedAt: 10, lifetimeMetrics: {} } }] }],
    ['incomplete cycle summary', { chatThreads: [{ id: 'chat', messages: [{ id: 'message', role: 'assistant', content: 'Synthetic', createdAt: 10, agentCycleSummary: {} }] }] }],
    ['incomplete integration', { integrationTemplates: [{ id: 'integration' }] }],
    ['incomplete installation', { installedIntegrations: [{ id: 'installed' }] }],
    ['incomplete command', { customSlashCommands: [{ id: 'command' }] }],
    ['null optional collection', { noteTemplates: null }],
    ['blank quick-link identity', { quickLinks: [{ id: '', title: 'Synthetic', url: 'https://example.test/' }] }],
    ['duplicate quick-link identity', { quickLinks: [{ id: 'link', title: 'One', url: 'https://example.test/one' }, { id: 'link', title: 'Two', url: 'https://example.test/two' }] }],
    ['future version', { version: 99 }],
  ])('rejects %s before replace or merge writes anything', async (_label, extra) => {
    await db.notes.add(note('retained'));
    const before = await snapshot();
    await expect(importJSON(JSON.stringify(legacy(extra)))).rejects.toThrow();
    await expect(mergeImportJSON(JSON.stringify(legacy(extra)))).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });

  it('encrypts the exact marker document instead of nesting ExportData into BackupPayload.data', async () => {
    await db.notes.add(note());
    const envelope = JSON.parse(await exportEncryptedJSON('synthetic-password'));
    const document = await decryptBackup<Record<string, unknown>>('synthetic-password', envelope);
    expect(document).toMatchObject({ format: 'threatcaddy-backup', version: 1, notes: [note()] });
    expect(document).not.toHaveProperty('data');
  });
});
