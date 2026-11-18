/**
 * SEC-2: from a local-only investigation, AI may read other investigations, local-only ones
 * included. What it writes there syncs once the investigation stops being local-only, so both
 * privacy controls ask first when the investigation holds AI-written content.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18n from '../i18n';
import { db } from '../db';
import { hasAiWrittenContent } from '../lib/ai-content';
import { suppressSyncInCurrentTransaction } from '../lib/sync-state';
import { SYNC_WORKSPACE_KEY } from '../lib/sync-capture-policy';
import { InvestigationDetailPanel } from '../components/Investigation/InvestigationDetailPanel';
import { ToastProvider } from '../contexts/ToastContext';
import type { ChatThread, Folder } from '../types';
import enInvestigations from '../../public/locales/en/investigations.json';
import deInvestigations from '../../public/locales/de/investigations.json';
import enCommon from '../../public/locales/en/common.json';

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

    it('asks when the content check fails, rather than sharing unchecked', async () => {
      await db.notes.add(note('human', 'case'));
      vi.spyOn(db.chatThreads, 'where').mockImplementation(() => { throw new Error('Synthetic read failure'); });
      const onToggleSync = vi.fn();
      render(panel({ serverConnected, onToggleSync }));
      fireEvent.click(await find());
      expect(await screen.findByRole('dialog', { name: en['detail.shareAiTitle'] })).toHaveTextContent(message);
      expect(onToggleSync).not.toHaveBeenCalled();
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
