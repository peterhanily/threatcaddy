/** F6C-4: the CaddyAI model selector names a local model in the analyst's language, as AgentCaddy does. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, render, screen } from '@testing-library/react';
import i18n from '../i18n';
import { ChatInput } from '../components/Chat/ChatInput';
import enChat from '../../public/locales/en/chat.json';
import deChat from '../../public/locales/de/chat.json';

const en = enChat as Record<string, unknown>;
const de = deChat as Record<string, unknown>;
const KEYS = { 'input.localModels': 'panel.localModels', 'input.localModel': 'panel.localModel' } as const;
const props = { onSend: vi.fn(), onStop: vi.fn(), isStreaming: false, extensionAvailable: true, onModelChange: vi.fn() };
const groupOf = (option: HTMLElement) => option.closest('optgroup')?.getAttribute('label');

afterEach(async () => { await act(async () => { await i18n.changeLanguage('en'); }); });

async function inGerman() {
  for (const [namespace, values] of Object.entries(i18n.getDataByLanguage('en') ?? {})) i18n.addResourceBundle('de', namespace, values, true, false);
  i18n.addResourceBundle('de', 'chat', de, true, true);
  await act(async () => { await i18n.changeLanguage('de'); });
}

describe('CaddyAI local model option', () => {
  it('names the local model and its group in English', () => {
    render(<ChatInput {...props} model="fictional-local" provider="local" localModelName="fictional-local" />);
    const option = screen.getByRole('option', { name: 'Local: fictional-local' });
    expect(groupOf(option)).toBe('Local');
  });

  it('names the local model and its group in German, differing from English', async () => {
    expect(de['input.localModel']).not.toBe(en['input.localModel']);
    expect(de['input.localModels']).not.toBe(en['input.localModels']);
    await inGerman();
    render(<ChatInput {...props} model="fictional-local" provider="local" localModelName="fictional-local" />);
    const option = screen.getByRole('option', { name: 'Lokal: fictional-local' });
    expect(groupOf(option)).toBe('Lokal');
    expect(screen.queryByRole('option', { name: /^Local:/ })).toBeNull();
  });

  it('files a kept local model under the same translated group', async () => {
    await inGerman();
    // A thread kept its earlier local model after Settings named a different one.
    const { container } = render(<ChatInput {...props} model="earlier-local" provider="local" localModelName="fictional-local" />);
    expect(groupOf(screen.getByRole('option', { name: 'earlier-local' }))).toBe('Lokal');
    expect([...container.querySelectorAll('optgroup')].map(group => group.getAttribute('label'))).not.toContain('local');
  });

  it('carries the AgentCaddy panel wording in every language', () => {
    const root = resolve(__dirname, '../../public/locales');
    const locales = readdirSync(root);
    expect(locales).toHaveLength(21);
    for (const locale of locales) {
      const chat = JSON.parse(readFileSync(resolve(root, locale, 'chat.json'), 'utf8')) as Record<string, unknown>;
      const agent = JSON.parse(readFileSync(resolve(root, locale, 'agent.json'), 'utf8')) as Record<string, unknown>;
      for (const [chatKey, agentKey] of Object.entries(KEYS)) expect(chat[chatKey], `${locale} ${chatKey}`).toBe(agent[agentKey]);
    }
  });
});
