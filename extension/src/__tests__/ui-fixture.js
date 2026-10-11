import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Script } from 'node:vm';

const english = JSON.parse(readFileSync(resolve(import.meta.dirname, '../_locales/en/messages.json'), 'utf8'));
export function englishMessage(key, values = []) {
  const entry = english[key];
  if (!entry) return '';
  return entry.message.replace(/\$([\w]+)\$/g, (_match, name) => {
    const definition = entry.placeholders?.[name.toLowerCase()];
    return definition ? String(values[Number(definition.content.slice(1)) - 1] ?? '') : '';
  });
}
export function loadUI(context) {
  context.chrome.runtime ??= {};
  context.chrome.runtime.getManifest ??= () => JSON.parse(readFileSync(resolve(import.meta.dirname, '../manifest.json'), 'utf8'));
  new Script(readFileSync(resolve(import.meta.dirname, '../ui.js'), 'utf8')).runInContext(context);
}
