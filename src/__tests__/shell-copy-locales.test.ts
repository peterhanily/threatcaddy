/** Settings, offline, web fetch and app shell text added or changed for 2.0.3: translated in every language. */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../public/locales');
const locales = readdirSync(root).filter(name => name !== 'en');
const read = (locale: string, namespace: string) => JSON.parse(readFileSync(resolve(root, locale, `${namespace}.json`), 'utf8')) as Record<string, string>;

const KEYS: Record<string, string[]> = {
  settings: ['general.version', 'general.aboutLocalFirst', 'ai.routing.auto', 'ai.routingHelp', 'ai.dataFlow.fetchUpdate'],
  common: ['offlineStatus.unavailableNotice', 'screenshare.viewHidden', 'screenshare.browseVisible', 'sidebar.tags', 'sidebar.noTags', 'sidebar.tagNameRequired',
    'sidebar.tagNameExists', 'sidebar.tagRenameFailed', 'sidebar.tagDeleteFailed', 'sidebar.tagNewName', 'sidebar.tagSaveName',
    'sidebar.tagCancelRename', 'sidebar.tagRename', 'sidebar.tagDelete', 'sidebar.tagDeleteTitle', 'sidebar.tagDeleteMessage'],
  exec: ['dashboard.analystModeBanner'],
  integrations: ['fetch.updateExtension'],
};

// French writes "Version" too.
const SAME_AS_ENGLISH = new Set(['fr settings:general.version']);

describe('shell and settings text in every language', () => {
  it('has a value in each language (German included) that is not the English source for each key', () => {
    expect(locales).toContain('de');
    for (const [namespace, keys] of Object.entries(KEYS)) {
      const en = read('en', namespace);
      for (const locale of locales) {
        const values = read(locale, namespace);
        for (const key of keys) {
          const id = `${locale} ${namespace}:${key}`;
          expect(en[key], `en ${namespace}:${key}`).toBeTruthy();
          expect(values[key], id).toBeTruthy();
          // Languages that use the loanword "Tags" elsewhere in the app (German, Dutch, Portuguese) match it here.
          if (key === 'sidebar.tags') expect(values[key], id).toBe(read(locale, 'investigations')['detail.tagsLabel']);
          else if (!SAME_AS_ENGLISH.has(`${locale} ${namespace}:${key}`)) expect(values[key], id).not.toBe(en[key]);
        }
      }
    }
  });

  it('says where to get a newer extension in every language', () => {
    for (const locale of ['en', ...locales]) {
      for (const [namespace, key] of [['integrations', 'fetch.updateExtension'], ['settings', 'ai.dataFlow.fetchUpdate']]) {
        const text = read(locale, namespace)[key];
        expect(text, `${locale} ${key}`).toContain('GitHub');
        expect(text, `${locale} ${key}`).toContain('1.1.3');
      }
    }
  });

  // Right-to-left languages write the path with ←, as their other Settings references do.
  const settingsPath = (locale: string, tab: string) => {
    const settings = read(locale, 'settings');
    const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`${escape(settings.title)} [→←] ${escape(settings[tab])}`);
  };

  it('points About to the AI tab by its name in each language', () => {
    for (const locale of ['en', ...locales]) {
      expect(read(locale, 'settings')['general.aboutLocalFirst'], locale).toMatch(settingsPath(locale, 'tabs.ai'));
    }
  });

  it('points the unavailable notice to the Data tab by its name in each language', () => {
    for (const locale of ['en', ...locales]) {
      expect(read(locale, 'common')['offlineStatus.unavailableNotice'], locale).toMatch(settingsPath(locale, 'tabs.data'));
    }
  });
});
