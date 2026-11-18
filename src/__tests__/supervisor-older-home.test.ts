/**
 * R6U-1: what the supervisor writes can quote any investigation, local-only ones
 * included, so its notes and tasks run only in a local-only home. 2.0.2 queued
 * them in its own investigation, which could sync; approving one of those now
 * fails with a reason and runs nothing. Its writes into other investigations
 * still ask, and run when approved.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import type { AgentAction, Folder } from '../types';
import { executeApprovedAction } from '../lib/agent-action-approval';
import { getSupervisorToolPermission, validateSupervisorDispatch } from '../lib/supervisor-tool-policy';
import { suppressSyncInCurrentTransaction } from '../lib/sync-state';
import enAgent from '../../public/locales/en/agent.json';
import deAgent from '../../public/locales/de/agent.json';
import { canary, ids, seedAIWorkspace, syncQueueContains } from './helpers/ai-workspace';

const KEY = 'refusal.supervisorHomeSyncable';
const REASON = (enAgent as Record<string, string>)[KEY];
const LOCAL = canary('L');
const SUPERVISOR = 'CaddyAgent Supervisor';

/** 2.0.2's supervisor investigation: same name and icon, no local-only flag, already synced. */
const OLDER: Folder = { id: 'OLD-SUP', name: SUPERVISOR, icon: '🤖', order: 9999, createdAt: 1, status: 'active',
  description: 'Automated cross-investigation findings from CaddyAgent Supervisor' };
const CURRENT: Folder = { ...OLDER, id: 'NEW-SUP', localOnly: true };

const proposal = (id: string, investigationId: string, toolName: string, toolInput: Record<string, unknown>): AgentAction => ({
  id, investigationId, threadId: 'sup-thread', agentConfigId: 'caddy-supervisor', toolName, toolInput,
  rationale: `Cross-case: Evidence ${LOCAL}`, status: 'pending', severity: 'warning', createdAt: 1,
});
const noteIn = (home: string) => proposal(`note-${home}`, home, 'create_note', { title: 'Cross-case finding', content: `Local case says ${LOCAL}` });
const taskIn = (home: string) => proposal(`task-${home}`, home, 'create_task', { title: `Follow up ${LOCAL}`, description: 'From Local case' });

/** What 2.0.2 left: its folder synced long ago, so nothing is queued for it now. */
async function seedOlder(rows: AgentAction[]) {
  await db.transaction('rw', [db.folders, db.agentActions], async () => {
    suppressSyncInCurrentTransaction();
    await db.folders.add(OLDER);
    await db.agentActions.bulkAdd(rows);
  });
  await db.table('_syncQueue').clear();
}

const written = async (folderId: string) => [
  ...await db.notes.where('folderId').equals(folderId).toArray(),
  ...await db.tasks.where('folderId').equals(folderId).toArray(),
];

beforeEach(async () => { await seedAIWorkspace(); localStorage.clear(); });

describe('a 2.0.2 supervisor note or task in its older investigation, which can sync', () => {
  it.each([
    ['with the current local-only supervisor investigation present', true],
    ['with no current supervisor investigation', false],
  ])('fails with the reason and writes nothing, %s', async (_, withCurrent) => {
    await seedOlder([noteIn('OLD-SUP'), taskIn('OLD-SUP')]);
    if (withCurrent) await db.folders.add(CURRENT);
    for (const row of [noteIn('OLD-SUP'), taskIn('OLD-SUP')]) {
      const result = await executeApprovedAction(row);
      expect(result.isError, row.toolName).toBe(true);
      expect(JSON.parse(result.result).error, row.toolName).toBe(REASON);
      expect(await db.agentActions.get(row.id), row.toolName).toMatchObject({ status: 'failed', resultSummary: result.result });
    }
    expect(await written('OLD-SUP')).toEqual([]);
    expect(await written('NEW-SUP')).toEqual([]);
    expect(await db.table('_syncQueue').count()).toBe(0);
    expect(await syncQueueContains(LOCAL)).toBe(false);
  });

  it('is refused on the live path too, before anything is queued or run', async () => {
    await seedOlder([]);
    for (const name of ['create_note', 'create_task']) {
      const call = { type: 'tool_use' as const, id: `call-${name}`, name, input: { title: 'Finding' } };
      expect(await getSupervisorToolPermission(call, 'OLD-SUP'), name).toMatchObject({ kind: 'denied' });
      expect(await validateSupervisorDispatch(call, 'OLD-SUP'), name).toBeTruthy();
    }
  });
});

describe('a supervisor note or task in a local-only supervisor investigation', () => {
  it.each([
    ['as created', SUPERVISOR],
    ['after the analyst renamed it', 'Supervisor findings (this device)'],
  ])('runs when approved, %s, and nothing is queued to sync', async (_, name) => {
    await seedOlder([]);
    await db.folders.add({ ...CURRENT, name });
    for (const row of [noteIn('NEW-SUP'), taskIn('NEW-SUP')]) {
      await db.agentActions.add(row);
      expect((await executeApprovedAction(row)).isError, row.toolName).toBe(false);
      expect((await db.agentActions.get(row.id))?.status, row.toolName).toBe('executed');
    }
    expect((await written('NEW-SUP')).map(entity => entity.title).sort()).toEqual(['Cross-case finding', `Follow up ${LOCAL}`]);
    expect(await syncQueueContains(LOCAL)).toBe(false);
  });
});

describe('a supervisor write into another investigation', () => {
  beforeEach(async () => { await db.folders.add(CURRENT); });

  it('update_ioc runs when approved', async () => {
    const row = proposal('ioc-S', 'S', 'update_ioc', { id: ids('S').ioc, confidence: 'high' });
    await db.agentActions.add(row);
    expect((await executeApprovedAction(row)).isError).toBe(false);
    expect((await db.agentActions.get(row.id))?.status).toBe('executed');
    expect((await db.standaloneIOCs.get(ids('S').ioc))?.confidence).toBe('high');
  });

  it('link_entities runs when approved', async () => {
    const row = proposal('link-S', 'S', 'link_entities', { links: [{ sourceType: 'note', sourceId: ids('S').note, targetType: 'task', targetId: ids('S').task }] });
    await db.agentActions.add(row);
    expect((await executeApprovedAction(row)).isError).toBe(false);
    expect((await db.agentActions.get(row.id))?.status).toBe('executed');
  });
});

it('the reason is translated: German differs from English', () => {
  expect(REASON).toBeTruthy();
  expect((deAgent as Record<string, string>)[KEY]).toBeTruthy();
  expect((deAgent as Record<string, string>)[KEY]).not.toBe(REASON);
});
