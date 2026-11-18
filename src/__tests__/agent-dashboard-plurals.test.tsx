/**
 * R5A-2: the AgentCaddy dashboard counts active agents with each language's own
 * plural forms, not an English 's' appended to a translated sentence.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import type { Folder } from '../types';
import { AgentDashboard } from '../components/Agent/AgentDashboard';
import { BUILTIN_AGENT_PROFILES } from '../lib/builtin-agent-profiles';
import i18n from '../i18n';

const agentCatalogs = import.meta.glob<{ default: Record<string, string> }>('../../public/locales/*/agent.json', { eager: true });
const catalog = (lng: string) => agentCatalogs[`../../public/locales/${lng}/agent.json`].default;
const STEM = 'dashboard.activeAgents';

async function inLanguage(lng: string) {
  for (const [namespace, values] of Object.entries(i18n.getDataByLanguage('en') ?? {})) i18n.addResourceBundle(lng, namespace, values, true, false);
  i18n.addResourceBundle(lng, 'agent', catalog(lng), true, true);
  await act(async () => { await i18n.changeLanguage(lng); });
}

async function showDashboard(activeAgents: number) {
  const folders: Folder[] = Array.from({ length: activeAgents }, (_, i) => ({ id: `case-${i}`, name: `Case ${i}`, order: i, createdAt: 1, status: 'active', agentEnabled: true }));
  await db.folders.bulkAdd(folders);
  const view = render(<AgentDashboard folders={folders} onOpenInvestigation={() => {}} />);
  await screen.findByRole('heading', { level: 1 });
  return view.container.querySelector('h1 + p')?.textContent ?? '';
}

beforeEach(async () => { await db.folders.clear(); });
afterEach(async () => { cleanup(); await act(async () => { await i18n.changeLanguage('en'); }); });

describe('the active agent count', () => {
  it.each([[1, '1 active agent'], [2, '2 active agents']])('reads "%s" agents in English', async (count, text) => {
    expect(await showDashboard(count)).toBe(text);
  });

  it.each([
    ['ja', 2, '2 件のアクティブエージェント'],
    ['pt-BR', 2, '2 agentes ativos'],
    ['de', 2, '2 aktive Agenten'],
    ['de', 1, '1 aktiver Agent'],
    ['ru', 2, '2 активных агента'],
    ['ru', 5, '5 активных агентов'],
    ['ar', 2, 'وكيلان نشطان (2)'],
  ])('in %s, %s agents read as that language counts them', async (lng, count, text) => {
    await inLanguage(lng);
    expect(await showDashboard(count)).toBe(text);
  });
});

describe('the agent catalogs', () => {
  it('every language has each plural form its rules need, with the count and no English suffix', () => {
    expect(Object.keys(agentCatalogs)).toHaveLength(21);
    for (const [path, { default: values }] of Object.entries(agentCatalogs)) {
      const lng = path.split('/').at(-2) as string;
      const forms = new Set(['one', 'other', ...new Intl.PluralRules(lng).resolvedOptions().pluralCategories]);
      for (const form of forms) {
        expect(values[`${STEM}_${form}`], `${lng} ${form}`).toContain('{{count}}');
      }
      expect(values[STEM], lng).toBeUndefined();
      expect(Object.entries(values).filter(([key, value]) => key.startsWith(STEM) && value.includes('{{suffix}}')), lng).toEqual([]);
    }
  });

  it('German translates both forms', () => {
    for (const form of ['one', 'other']) expect(catalog('de')[`${STEM}_${form}`]).not.toBe(catalog('en')[`${STEM}_${form}`]);
  });

  it('every language\'s getting-started step names as many profiles as are built in', () => {
    // Persian writes the number in its own digits.
    const persian = (n: number) => String(n).replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
    for (const [path, { default: values }] of Object.entries(agentCatalogs)) {
      const lng = path.split('/').at(-2) as string;
      const count = BUILTIN_AGENT_PROFILES.length;
      expect(values['dashboard.step2'], lng).toContain(lng === 'fa' ? persian(count) : String(count));
    }
  });
});
