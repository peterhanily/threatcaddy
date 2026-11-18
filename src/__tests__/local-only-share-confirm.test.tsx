/**
 * SEC-2: from a local-only investigation, AI may read other investigations, local-only ones
 * included. What it writes there syncs once the investigation stops being local-only, so both
 * privacy controls ask first when the investigation holds AI-written content.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { DBCore, DBCoreCursor, Middleware } from 'dexie';
import i18n from '../i18n';
import { db } from '../db';
import { hasAiWrittenContent } from '../lib/ai-content';
import { generateMasterKey } from '../lib/crypto';
import { setSessionKey } from '../lib/encryptionMiddleware';
import { clearEncryptionMeta, setEncryptionMeta } from '../lib/encryptionStore';
import { DELEGATION_TOOL_DEFINITIONS, EXECUTIVE_TOOL_DEFINITIONS, TOOL_DEFINITIONS, isWriteTool } from '../lib/llm-tool-defs';
import { classifyToolCall } from '../lib/tool-reach';
import { suppressSyncInCurrentTransaction } from '../lib/sync-state';
import { SYNC_WORKSPACE_KEY } from '../lib/sync-capture-policy';
import { InvestigationDetailPanel } from '../components/Investigation/InvestigationDetailPanel';
import { ToastProvider } from '../contexts/ToastContext';
import type { AgentAction, ChatThread, Folder, Settings } from '../types';
import enInvestigations from '../../public/locales/en/investigations.json';
import deInvestigations from '../../public/locales/de/investigations.json';
import enCommon from '../../public/locales/en/common.json';

// Pass-through spies: the real classifier and check run unless a test says otherwise.
vi.mock('../lib/tool-reach', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/tool-reach')>();
  return { ...actual, classifyToolCall: vi.fn(actual.classifyToolCall) };
});
vi.mock('../lib/ai-content', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/ai-content')>();
  return { ...actual, hasAiWrittenContent: vi.fn(actual.hasAiWrittenContent) };
});

/** WebKit keeps a transaction active only while it dispatches an IndexedDB event, so a cursor
 * that awaits Web Crypto between rows (the encryption middleware's) cannot continue there.
 * fake-indexeddb never ends a transaction; this layer under the encryption middleware refuses the same calls. */
const webkitCursors: Middleware<DBCore> = {
  stack: 'dbcore', name: 'webkit-cursors', level: 1,
  create: down => ({ ...down, table: name => {
    const table = down.table(name);
    return { ...table, async openCursor(req) {
      const cursor = await table.openCursor(req);
      if (!cursor) return cursor;
      let dispatching = false;
      const active = () => {
        if (!dispatching) throw new DOMException('The transaction is inactive or finished.', 'TransactionInactiveError');
      };
      const strict: DBCoreCursor = {
        get trans() { return cursor.trans; },
        get key() { return cursor.key; },
        get primaryKey() { return cursor.primaryKey; },
        get value() { return cursor.value; },
        get done() { return cursor.done; },
        continue: key => { active(); cursor.continue(key); },
        continuePrimaryKey: (key, primaryKey) => { active(); cursor.continuePrimaryKey(key, primaryKey); },
        advance: count => { active(); cursor.advance(count); },
        stop: value => cursor.stop(value),
        fail: error => cursor.fail(error),
        start: onNext => cursor.start(() => { dispatching = true; try { onNext(); } finally { dispatching = false; } }),
        next() {
          let first = true;
          return strict.start(() => { if (first) { first = false; strict.continue(); } else strict.stop(); }).then(() => strict);
        },
      };
      return strict;
    } };
  } }),
};

const en = enInvestigations as Record<string, string>;
const de = deInvestigations as Record<string, string>;
const NEW_KEYS = ['detail.shareAiTitle', 'detail.shareAiMessageNow', 'detail.shareAiMessageLater', 'detail.shareAiConfirm'];
const now = 1_700_000_000_000;

const thread = (id: string, folderId: string, extra: Partial<ChatThread> = {}): ChatThread => ({
  id, title: 'Fictional chat', folderId, model: 'synthetic-model', provider: 'anthropic', tags: [], trashed: false, archived: false,
  messages: [{ id: `${id}-m`, role: 'assistant', content: 'Fictional reply', createdAt: now }], createdAt: now, updatedAt: now, ...extra,
});
const note = (id: string, folderId: string, extra: Record<string, unknown> = {}) => ({
  id, folderId, title: 'Fictional note', content: 'Synthetic text', tags: [] as string[], pinned: false, archived: false, trashed: false,
  createdAt: now, updatedAt: now, ...extra,
});

beforeEach(async () => {
  await db.transaction('rw', db.tables, async () => {
    suppressSyncInCurrentTransaction();
    for (const table of db.tables) await table.clear();
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => { await i18n.changeLanguage('en'); });
});

describe('hasAiWrittenContent', () => {
  it('is false for an investigation with only analyst content', async () => {
    await db.notes.add(note('human', 'case', { createdBy: 'Fictional Analyst' }));
    // A chat folder is an empty container; conversations elsewhere do not travel with this investigation.
    await db.chatThreads.add(thread('container', 'case', { messages: [], isFolder: true, tags: ['chat-folder'] }));
    await db.chatThreads.add(thread('elsewhere', 'other'));
    await db.notes.add(note('agent-elsewhere', 'other', { tags: ['ai-generated'] }));
    expect(await hasAiWrittenContent('case')).toBe(false);
  });

  it.each([
    ['a CaddyAI conversation', () => db.chatThreads.add(thread('chat', 'case'))],
    ['an agent audit thread', () => db.chatThreads.add(thread('audit', 'case', { tags: ['agent-audit'], source: 'agent' }))],
    ['the supervisor audit thread', () => db.chatThreads.add(thread('supervisor', 'case', { title: 'Supervisor Audit Trail', source: 'agent' }))],
    ['a note an agent created', () => db.notes.add(note('agent-note', 'case', { tags: ['ai-generated'] }))],
    ['a 2.0.2 agent task without the tag', () => db.tasks.add({ id: 'agent-task', folderId: 'case', title: 'Fictional task', completed: false,
      priority: 'none', status: 'todo', order: 0, tags: [], trashed: false, archived: false, createdBy: 'agent:🔗 Pattern Hunter (Analyst)',
      createdAt: now, updatedAt: now })],
    ['an IOC an agent created', () => db.standaloneIOCs.add({ id: 'agent-ioc', folderId: 'case', type: 'domain', value: 'fictional.example',
      confidence: 'medium', tags: ['ai-generated'], trashed: false, archived: false, createdAt: now, updatedAt: now })],
    ['a timeline event an agent created', () => db.timelineEvents.add({ id: 'agent-event', folderId: 'case', timelineId: 't', title: 'Fictional event',
      timestamp: now, eventType: 'other', source: 'agent', starred: false, confidence: 'medium', linkedIOCIds: [], linkedNoteIds: [], linkedTaskIds: [],
      mitreAttackIds: [], assets: [], tags: ['ai-generated'], trashed: false, archived: false, createdAt: now, updatedAt: now })],
    ['a trashed agent note, which syncs if restored', () => db.notes.add(note('trashed-agent-note', 'case', { tags: ['ai-generated'], trashed: true }))],
  ])('is true for %s', async (_label, seed) => {
    await seed();
    expect(await hasAiWrittenContent('case')).toBe(true);
  });

  // Chat writes carry no marker, and from a local-only home the other local-only investigations are in reach.
  describe('AI that wrote here from elsewhere', () => {
    const call = (name: string, input: Record<string, unknown>) => ({ id: `call-${name}`, name, input, result: '{"success":true}', isError: false });
    const chatIn = (folderId: string | undefined, toolCalls: ReturnType<typeof call>[]) => db.chatThreads.add(thread('elsewhere', 'other', {
      folderId, messages: [{ id: 'reply', role: 'assistant', content: 'Fictional reply', toolCalls, createdAt: now }] }));
    const action = (status: AgentAction['status']): AgentAction => ({ id: `action-${status}`, investigationId: 'case', threadId: 'supervisor-thread',
      agentConfigId: 'caddy-supervisor', toolName: 'update_ioc', toolInput: { id: 'ioc' }, rationale: 'Fictional rationale', status, createdAt: now });

    beforeEach(async () => {
      await db.folders.bulkAdd([
        { id: 'case', name: 'Fictional case', order: 0, status: 'active', createdAt: now, localOnly: true },
        { id: 'other', name: 'Other case', order: 1, status: 'active', createdAt: now, localOnly: true },
      ]);
      await db.notes.add(note('human', 'case', { createdBy: 'Fictional Analyst' }));
    });

    it.each([
      ['a note a conversation in another investigation created here', () => chatIn('other', [
        call('create_in_investigation', { investigationId: 'case', entityType: 'note', data: { title: 'Fictional' } })])],
      ['an item a conversation outside any investigation created here by name', () => chatIn(undefined, [
        call('create_in_investigation', { investigationName: 'FICTIONAL case', entityType: 'task', data: { title: 'Fictional' } })])],
      ['an edit a conversation elsewhere made to an item here', () => chatIn('other', [call('update_note', { id: 'human', content: 'Synthetic text' })])],
      ['a change an agent or the supervisor made here', () => db.agentActions.add(action('executed'))],
      ['an approved change that never recorded its result', () => db.agentActions.add(action('approved'))],
    ])('is true for %s', async (_label, seed) => {
      await seed();
      expect(await hasAiWrittenContent('case')).toBe(true);
    });

    it('is false when AI elsewhere only read here, wrote in its own or a third investigation, or never changed anything here', async () => {
      await db.folders.add({ id: 'third', name: 'Third case', order: 2, status: 'active', createdAt: now, localOnly: true });
      await chatIn('other', [call('read_note', { id: 'human' }), call('create_note', { title: 'Fictional' }),
        call('create_in_investigation', { investigationId: 'other', entityType: 'note', data: { title: 'Fictional' } }),
        call('create_in_investigation', { investigationId: 'third', entityType: 'note', data: { title: 'Fictional' } })]);
      await db.agentActions.bulkAdd([action('pending'), action('rejected'), action('failed')]);
      expect(await hasAiWrittenContent('case')).toBe(false);
      expect(await hasAiWrittenContent('other')).toBe(true);
      expect(await hasAiWrittenContent('third')).toBe(true);
    });

    // Most recorded writes land in their own conversation's investigation; classifying each one made every share slow.
    it('classifies only the calls that can reach another investigation', async () => {
      await chatIn('other', [...Array.from({ length: 20 }, () => call('create_note', { title: 'Fictional' })), call('read_note', { id: 'human' }),
        call('create_task', { title: 'Fictional' }), call('create_in_investigation', { investigationId: 'other', entityType: 'note', data: { title: 'Fictional' } })]);
      vi.mocked(classifyToolCall).mockClear();
      expect(await hasAiWrittenContent('case')).toBe(false);
      expect(vi.mocked(classifyToolCall).mock.calls.map(([classified]) => classified.name)).toEqual(['create_in_investigation']);
    });

    // The guard against that shortcut missing a tool: whatever the dispatcher would place here is seen.
    it('sees every write tool the dispatcher would place here', async () => {
      await db.tasks.add({ id: 'x', folderId: 'case', title: 'Fictional task', completed: false, priority: 'none', status: 'todo', order: 0,
        tags: [], trashed: false, archived: false, createdAt: now, updatedAt: now });
      await db.notes.add(note('x', 'case'));
      await db.standaloneIOCs.add({ id: 'x', folderId: 'case', type: 'domain', value: 'fictional.example', confidence: 'medium', tags: [],
        trashed: false, archived: false, createdAt: now, updatedAt: now });
      await db.timelineEvents.add({ id: 'x', folderId: 'case', timelineId: 't', title: 'Fictional event', timestamp: now, eventType: 'other',
        source: 'analyst', starred: false, confidence: 'medium', linkedIOCIds: [], linkedNoteIds: [], linkedTaskIds: [], mitreAttackIds: [],
        assets: [], tags: [], trashed: false, archived: false, createdAt: now, updatedAt: now });
      // Every argument a call can name a row or an investigation by, all pointing here.
      const input = { id: 'x', taskId: 'x', iocId: 'x', folderId: 'x', noteId: 'x', parentFolderId: 'x', investigationId: 'case',
        entityType: 'note', data: { title: 'Fictional' }, links: [{ sourceType: 'note', sourceId: 'x', targetType: 'timeline-event', targetId: 'x' }] };
      const writes = [...TOOL_DEFINITIONS, ...DELEGATION_TOOL_DEFINITIONS, ...EXECUTIVE_TOOL_DEFINITIONS].map(tool => tool.name).filter(isWriteTool);
      const seen: string[] = [];
      for (const name of writes) {
        await db.chatThreads.clear();
        await chatIn('other', [call(name, input)]);
        const reach = await classifyToolCall({ type: 'tool_use', id: `call-${name}`, name, input }, { homeFolderId: 'other', settings: {} as Settings });
        const here = await hasAiWrittenContent('case');
        expect(here, name).toBe(reach.targetFolderIds.includes('case'));
        if (here) seen.push(name);
      }
      expect(seen).toEqual(expect.arrayContaining(['create_in_investigation', 'update_note', 'update_task', 'update_ioc', 'update_timeline_event',
        'link_entities', 'review_completed_task', 'enrich_ioc', 'delete_note_folder', 'move_to_folder']));
    });

    describe('in an encrypted workspace, where WebKit cannot continue a decrypting cursor', () => {
      beforeEach(async () => {
        db.close();
        db.use(webkitCursors);
        await db.open();
        setEncryptionMeta({ version: 1, salt: 'fixture-salt', wrappedKey: 'fixture-wrapped', recoverySalt: 'fixture-recovery-salt',
          recoveryWrappedKey: 'fixture-recovery-key', enabledAt: 1 });
        setSessionKey(await generateMasterKey());
        await db.notes.bulkAdd(Array.from({ length: 5 }, (_, index) => note(`analyst-${index}`, 'case', { createdBy: 'Fictional Analyst' })));
        await db.chatThreads.add(thread('plain-elsewhere', 'other'));
      });
      afterEach(async () => {
        clearEncryptionMeta();
        setSessionKey(null);
        db.close();
        db.unuse({ stack: 'dbcore', name: 'webkit-cursors' });
        await db.open();
      });

      it('shares without asking when AI wrote nothing here', async () => {
        await chatIn('other', [call('read_note', { id: 'analyst-0' }), call('create_note', { title: 'Fictional' })]);
        expect(await hasAiWrittenContent('case')).toBe(false);
      });

      it('sees a conversation elsewhere that wrote here', async () => {
        await chatIn('other', [call('update_note', { id: 'human', content: 'Synthetic text' })]);
        const stored = await new Promise<Record<string, unknown>>((resolveRow, reject) => {
          const request = db.backendDB().transaction('chatThreads').objectStore('chatThreads').get('elsewhere');
          request.onsuccess = () => resolveRow(request.result);
          request.onerror = () => reject(request.error);
        });
        expect(Array.isArray(stored.messages)).toBe(false);
        expect(await hasAiWrittenContent('case')).toBe(true);
      });

      // Classifying an enrichment also looks up the integrations it would call, which a cursor cannot read here.
      it('places an enrichment from elsewhere with an integration installed', async () => {
        const ioc = (id: string, folderId: string) => ({ id, folderId, type: 'domain' as const, value: 'fictional.example', confidence: 'medium' as const,
          tags: [], trashed: false, archived: false, createdAt: now, updatedAt: now });
        await db.standaloneIOCs.bulkAdd([ioc('ioc-other', 'other'), ioc('ioc-case', 'case')]);
        await db.installedIntegrations.add({ id: 'fictional-integration', templateId: 'fictional-template', name: 'Fictional integration', enabled: true,
          config: {}, scopeType: 'all', scopeFolderIds: [], runCount: 0, errorCount: 0, createdAt: now, updatedAt: now });
        await chatIn('other', [call('enrich_ioc', { iocId: 'ioc-other' })]);
        expect(await hasAiWrittenContent('case')).toBe(false);
        await db.chatThreads.clear();
        await chatIn('other', [call('enrich_ioc', { iocId: 'ioc-case' })]);
        expect(await hasAiWrittenContent('case')).toBe(true);
      });

      it.each([
        ['a conversation here', () => db.chatThreads.add(thread('chat', 'case'))],
        ['a note an agent created', () => db.notes.add(note('agent-note', 'case', { tags: ['ai-generated'] }))],
        ['a change an agent or the supervisor made here', () => db.agentActions.add(action('executed'))],
      ])('sees %s', async (_label, seed) => {
        await seed();
        expect(await hasAiWrittenContent('case')).toBe(true);
      });
    });
  });
});

describe('sharing a local-only investigation from its details', () => {
  const folder: Folder = { id: 'case', name: 'Fictional case', order: 0, status: 'active', createdAt: now, localOnly: true };
  const props = { onUpdate: vi.fn(), onClose: vi.fn(), allTags: [], onCreateTag: vi.fn(), entityCounts: { notes: 0, tasks: 0, events: 0, whiteboards: 0 }, effectiveClsLevels: [] };
  const panel = (extra: Partial<Parameters<typeof InvestigationDetailPanel>[0]>) =>
    <ToastProvider><InvestigationDetailPanel {...props} folder={folder} {...extra} /></ToastProvider>;
  const shareDialog = () => screen.queryByRole('dialog', { name: en['detail.shareAiTitle'] });

  const controls = [
    { control: 'the Cloud Sync button', serverConnected: true, message: en['detail.shareAiMessageNow'],
      find: () => screen.findByRole('button', { name: /^Local only/ }) },
    { control: 'the Keep on this device switch', serverConnected: false, message: en['detail.shareAiMessageLater'],
      find: () => screen.findByRole('switch', { name: /Keep on this device/ }) },
  ];

  describe.each(controls)('$control', ({ serverConnected, message, find }) => {
    it('asks first when AI wrote here, and Cancel keeps it local-only', async () => {
      await db.chatThreads.add(thread('chat', 'case'));
      const onToggleSync = vi.fn();
      render(panel({ serverConnected, onToggleSync }));
      fireEvent.click(await find());
      const dialog = await screen.findByRole('dialog', { name: en['detail.shareAiTitle'] });
      expect(dialog).toHaveTextContent(message);
      expect(onToggleSync).not.toHaveBeenCalled();
      fireEvent.click(within(dialog).getByRole('button', { name: (enCommon as Record<string, string>).cancel }));
      await waitFor(() => expect(shareDialog()).toBeNull());
      expect(onToggleSync).not.toHaveBeenCalled();
    });

    it('shares once the analyst confirms', async () => {
      await db.notes.add(note('agent-note', 'case', { tags: ['ai-generated'] }));
      const onToggleSync = vi.fn();
      render(panel({ serverConnected, onToggleSync }));
      fireEvent.click(await find());
      const dialog = await screen.findByRole('dialog', { name: en['detail.shareAiTitle'] });
      fireEvent.click(within(dialog).getByRole('button', { name: en['detail.shareAiConfirm'] }));
      expect(onToggleSync).toHaveBeenCalledExactlyOnceWith('case', true);
      await waitFor(() => expect(shareDialog()).toBeNull());
    });

    it('shares without asking when AI wrote nothing here', async () => {
      await db.notes.add(note('human', 'case'));
      await db.chatThreads.add(thread('elsewhere', 'other'));
      const onToggleSync = vi.fn();
      render(panel({ serverConnected, onToggleSync }));
      fireEvent.click(await find());
      await waitFor(() => expect(onToggleSync).toHaveBeenCalledExactlyOnceWith('case', true));
      expect(shareDialog()).toBeNull();
    });

    it('waits for the content check before it takes another click', async () => {
      let finish: (aiWrote: boolean) => void = () => {};
      vi.mocked(hasAiWrittenContent).mockClear().mockImplementationOnce(() => new Promise(resolveCheck => { finish = resolveCheck; }));
      const onToggleSync = vi.fn();
      render(panel({ serverConnected, onToggleSync }));
      const control = await find();
      control.focus();
      fireEvent.click(control);
      // aria-disabled, not disabled: a keyboard user keeps focus on the control.
      expect(control).toHaveAttribute('aria-disabled', 'true');
      expect(control).toHaveFocus();
      fireEvent.click(control);
      await act(async () => { finish(false); });
      await waitFor(() => expect(control).not.toHaveAttribute('aria-disabled'));
      expect(onToggleSync).toHaveBeenCalledExactlyOnceWith('case', true);
      expect(hasAiWrittenContent).toHaveBeenCalledTimes(1);
    });

    it('asks when the content check fails, rather than sharing unchecked', async () => {
      await db.notes.add(note('human', 'case'));
      const failure = new Error('Synthetic read failure');
      vi.spyOn(db.chatThreads, 'where').mockImplementation(() => { throw failure; });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const onToggleSync = vi.fn();
      render(panel({ serverConnected, onToggleSync }));
      fireEvent.click(await find());
      expect(await screen.findByRole('dialog', { name: en['detail.shareAiTitle'] })).toHaveTextContent(message);
      expect(onToggleSync).not.toHaveBeenCalled();
      // A failed check is visible in the console, not only as a question.
      expect(warn).toHaveBeenCalledWith(expect.any(String), failure);
    });

    it('never asks when turning local-only on', async () => {
      await db.chatThreads.add(thread('chat', 'case'));
      const onToggleSync = vi.fn();
      render(panel({ folder: { ...folder, localOnly: false }, serverConnected, onToggleSync }));
      fireEvent.click(await (serverConnected
        ? screen.findByRole('button', { name: /^Synced to server/ })
        : screen.findByRole('switch', { name: /Keep on this device/ })));
      expect(onToggleSync).toHaveBeenCalledExactlyOnceWith('case', false);
      await new Promise(resolveWait => setTimeout(resolveWait, 20));
      expect(shareDialog()).toBeNull();
    });
  });

  it('closes the question when the team server disconnects, so a bound workspace never shares without its replay', async () => {
    await db.table('_syncMeta').put({ key: SYNC_WORKSPACE_KEY, value: { version: 1, serverUrl: 'https://team.example.invalid', userId: 'analyst' } });
    await db.chatThreads.add(thread('chat', 'case'));
    const onToggleSync = vi.fn();
    const view = render(panel({ serverConnected: true, onToggleSync }));
    fireEvent.click(await screen.findByRole('button', { name: /^Local only/ }));
    await screen.findByRole('dialog', { name: en['detail.shareAiTitle'] });
    view.rerender(panel({ serverConnected: false, onToggleSync }));
    await new Promise(resolveWait => setTimeout(resolveWait, 50));
    expect(shareDialog()).toBeNull();
    expect(screen.queryByRole('button', { name: en['detail.shareAiConfirm'] })).toBeNull();
    // Reconnecting does not reopen a question the analyst never answered.
    view.rerender(panel({ serverConnected: true, onToggleSync }));
    await new Promise(resolveWait => setTimeout(resolveWait, 50));
    expect(shareDialog()).toBeNull();
    expect(onToggleSync).not.toHaveBeenCalled();
  });

  it('asks in the analyst\'s language', async () => {
    for (const [namespace, values] of Object.entries(i18n.getDataByLanguage('en') ?? {})) i18n.addResourceBundle('de', namespace, values, true, false);
    i18n.addResourceBundle('de', 'investigations', de, true, true);
    await act(async () => { await i18n.changeLanguage('de'); });
    await db.chatThreads.add(thread('chat', 'case'));
    render(panel({ serverConnected: true, onToggleSync: vi.fn() }));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${de['detail.localOnly']}`) }));
    const dialog = await screen.findByRole('dialog', { name: de['detail.shareAiTitle'] });
    expect(dialog).toHaveTextContent(de['detail.shareAiMessageNow']);
    expect(within(dialog).getByRole('button', { name: de['detail.shareAiConfirm'] })).toBeInTheDocument();
  });
});

describe('share confirmation text', () => {
  it('is translated in every language, with nothing left in English in German', () => {
    for (const key of NEW_KEYS) {
      expect(en[key], key).toBeTruthy();
      expect(de[key], key).toBeTruthy();
      expect(de[key], key).not.toBe(en[key]);
    }
    const root = resolve(__dirname, '../../public/locales');
    const locales = readdirSync(root).filter(name => name !== 'en');
    expect(locales).toHaveLength(20);
    for (const locale of locales) {
      const values = JSON.parse(readFileSync(resolve(root, locale, 'investigations.json'), 'utf8')) as Record<string, string>;
      for (const key of NEW_KEYS) {
        expect(values[key], `${locale} ${key}`).toBeTruthy();
        expect(values[key], `${locale} ${key}`).not.toBe(en[key]);
        expect(values[key], `${locale} ${key}`).not.toContain('{{');
      }
    }
  });
});
