/** The investigation details dialog: counts and dates fill their placeholders, and its switches mirror in RTL. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import i18n from '../i18n';
import { InvestigationDetailPanel } from '../components/Investigation/InvestigationDetailPanel';
import { formatFullDate } from '../lib/utils';
import { ToastProvider } from '../contexts/ToastContext';
import type { Folder } from '../types';
import enInvestigations from '../../public/locales/en/investigations.json';
import deInvestigations from '../../public/locales/de/investigations.json';
import deCommon from '../../public/locales/de/common.json';

const localeRoot = resolve(__dirname, '../../public/locales');
// These languages write the same words as English: French "note(s)", Italian plural "note", Dutch "whiteboard(s)".
const SAME_AS_ENGLISH = new Set(['fr detail.notesCount_one', 'fr detail.notesCount_many', 'fr detail.notesCount_other',
  'it detail.notesCount_many', 'it detail.notesCount_other', 'nl detail.whiteboardsCount_one', 'nl detail.whiteboardsCount_other']);

const CREATED = Date.UTC(2026, 10, 3, 9, 30);
const UPDATED = Date.UTC(2026, 10, 17, 14, 5);
const folder: Folder = { id: 'case', name: 'Fictional Case Alpha', order: 0, status: 'active', createdAt: CREATED, updatedAt: UPDATED };
const props = { folder, onUpdate: vi.fn(), onClose: vi.fn(), allTags: [], onCreateTag: vi.fn(), effectiveClsLevels: [] };
const panel = (extra: Partial<Parameters<typeof InvestigationDetailPanel>[0]> = {}) =>
  <ToastProvider><InvestigationDetailPanel {...props} entityCounts={{ notes: 1, tasks: 2, events: 0, whiteboards: 5 }} {...extra} /></ToastProvider>;
const dialog = () => screen.getByRole('dialog');

afterEach(async () => { await act(async () => { await i18n.changeLanguage('en'); }); });

async function inGerman() {
  for (const [namespace, values] of Object.entries(i18n.getDataByLanguage('en') ?? {})) i18n.addResourceBundle('de', namespace, values, true, false);
  i18n.addResourceBundle('de', 'investigations', deInvestigations, true, true);
  i18n.addResourceBundle('de', 'common', deCommon, true, true);
  await act(async () => { await i18n.changeLanguage('de'); });
}

describe('investigation details text', () => {
  it('shows each count and both dates instead of raw placeholders', () => {
    render(panel());
    expect(dialog()).not.toHaveTextContent('{{');
    expect(screen.getByText('Contents (8 items)')).toBeInTheDocument();
    for (const text of ['1 note', '2 tasks', '0 events', '5 whiteboards']) expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByText(`Created ${formatFullDate(CREATED)}`)).toBeInTheDocument();
    expect(screen.getByText(`Updated ${formatFullDate(UPDATED)}`)).toBeInTheDocument();
  });

  it('uses the singular for one item of each kind', () => {
    render(panel({ entityCounts: { notes: 1, tasks: 1, events: 1, whiteboards: 0 } }));
    expect(screen.getByText('Contents (3 items)')).toBeInTheDocument();
    for (const text of ['1 note', '1 task', '1 event', '0 whiteboards']) expect(screen.getByText(text)).toBeInTheDocument();
    render(panel({ entityCounts: { notes: 1, tasks: 0, events: 0, whiteboards: 0 } }));
    expect(screen.getByText('Contents (1 item)')).toBeInTheDocument();
  });

  it('shows the counts and dates in the analyst\'s language', async () => {
    await inGerman();
    render(panel());
    expect(dialog()).not.toHaveTextContent('{{');
    expect(screen.getByText('1 Notiz')).toBeInTheDocument();
    expect(screen.getByText('2 Aufgaben')).toBeInTheDocument();
    expect(screen.getByText(`Erstellt ${formatFullDate(CREATED)}`)).toBeInTheDocument();
    // The classification and PAP selects' empty choice uses the existing detail.none key.
    expect(screen.getAllByRole('option', { name: (deInvestigations as Record<string, string>)['detail.none'] })).toHaveLength(2);
    expect(screen.queryByRole('option', { name: 'None' })).toBeNull();
  });

  it('names the dialog and its close button in the analyst\'s language', async () => {
    await inGerman();
    const onClose = vi.fn();
    render(panel({ onClose }));
    const named = screen.getByRole('dialog', { name: (deInvestigations as Record<string, string>)['detail.title'] });
    fireEvent.click(within(named).getByRole('button', { name: (deCommon as Record<string, string>).close }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog', { name: 'Investigation details' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('translates every count form each language uses', () => {
    const en = enInvestigations as Record<string, string>;
    const stems = ['contentsLabel', 'notesCount', 'tasksCount', 'eventsCount', 'whiteboardsCount'];
    expect(Object.keys(en).filter(key => new RegExp(`^detail\\.(${stems.join('|')})_`).test(key))).toHaveLength(10);
    const locales = readdirSync(localeRoot).filter(name => name !== 'en');
    expect(locales).toHaveLength(20);
    for (const locale of locales) {
      const values = JSON.parse(readFileSync(resolve(localeRoot, locale, 'investigations.json'), 'utf8')) as Record<string, string>;
      for (const category of new Intl.PluralRules(locale).resolvedOptions().pluralCategories) {
        for (const stem of stems) {
          const key = `detail.${stem}_${category}`;
          const id = `${locale} ${key}`;
          const english = [en[`detail.${stem}_one`], en[`detail.${stem}_other`]];
          expect(values[key], id).toContain('{{count}}');
          if (SAME_AS_ENGLISH.has(id)) expect(english, id).toContain(values[key]);
          else expect(english, id).not.toContain(values[key]);
        }
      }
    }
  });
});

describe('investigation details switches', () => {
  const knobClass = (control: HTMLElement) => (control.querySelector('.rounded-full .rounded-full') as HTMLElement).className;
  const PHYSICAL = /(^|\s)(left|right)-\[/;

  it('places the Keep on this device knob with logical positions, so it mirrors in right-to-left languages', async () => {
    const view = render(panel({ folder: { ...folder, localOnly: true }, serverConnected: false, onToggleSync: vi.fn() }));
    const on = knobClass(await screen.findByRole('switch', { name: /Keep on this device/ }));
    expect(on).toMatch(/(^|\s)start-\[14px\](\s|$)/);
    expect(on).not.toMatch(PHYSICAL);
    view.unmount();
    render(panel({ folder: { ...folder, localOnly: false }, serverConnected: false, onToggleSync: vi.fn() }));
    const off = knobClass(await screen.findByRole('switch', { name: /Keep on this device/ }));
    expect(off).toMatch(/(^|\s)start-\[2px\](\s|$)/);
    expect(off).not.toMatch(PHYSICAL);
  });

  it('places the team sync knob with logical positions too', () => {
    const view = render(panel({ folder: { ...folder, localOnly: false }, serverConnected: true, onToggleSync: vi.fn() }));
    const synced = knobClass(screen.getByRole('button', { name: /Synced to server/ }));
    expect(synced).toMatch(/(^|\s)start-\[14px\](\s|$)/);
    expect(synced).not.toMatch(PHYSICAL);
    view.unmount();
    render(panel({ folder: { ...folder, localOnly: true }, serverConnected: true, onToggleSync: vi.fn() }));
    const local = knobClass(screen.getByRole('button', { name: /Local only/ }));
    expect(local).toMatch(/(^|\s)start-\[2px\](\s|$)/);
    expect(local).not.toMatch(PHYSICAL);
  });
});
