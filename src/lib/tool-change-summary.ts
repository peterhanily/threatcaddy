import { db } from '../db';
import { detailWillBePrivate } from './llm-tools-identities';

/**
 * What a proposed write changes, by the stored names of what it touches, for an approval card: the
 * card otherwise shows an id and the model's own account of it. Never a private detail's value.
 */
export type ChangeField = { field: string; from?: string; to?: string; changed?: true; items?: Array<{ text: string; private?: boolean }> };
export type ToolChange =
  | { kind: 'changes' | 'creates'; name: string; fields: ChangeField[] }
  | { kind: 'connects'; from: string; phrase: string; to: string; fields: ChangeField[] }
  | { kind: 'missing'; id: string; fields: ChangeField[] };

const MAX = 80;
const text = (value: unknown) => {
  const shown = value == null || value === '' ? '—' : String(value).replace(/\s+/g, ' ').trim();
  return shown.length > MAX ? `${shown.slice(0, MAX)}…` : shown;
};
const has = (input: Record<string, unknown>, key: string) => Object.hasOwn(input, key) && input[key] !== undefined;
const list = (value: unknown) => (Array.isArray(value) ? value : value == null || value === '' ? [] : [value]);
/** `from → to` for each field the input names. */
const fieldsOf = (input: Record<string, unknown>, stored: Record<string, unknown> | undefined, keys: readonly string[], map: (key: string, value: unknown) => unknown = (_, value) => value) =>
  keys.filter(key => has(input, key)).map(key => ({ field: key, from: text(stored?.[key]), to: text(map(key, input[key])) }));
const changed = (input: Record<string, unknown>, keys: readonly string[]): ChangeField[] => keys.filter(key => has(input, key)).map(field => ({ field, changed: true }));
const detailItems = (value: unknown) => list(value).flatMap(entry => {
  const label = (entry as { label?: unknown })?.label;
  return typeof label === 'string' && label.trim() ? [{ text: text(label), private: detailWillBePrivate(label) }] : [];
});
const nameItems = (value: unknown) => list(value).flatMap(name => (typeof name === 'string' && name.trim() ? [{ text: text(name) }] : []));
const id = (value: unknown) => String(value || '');

async function identityName(idValue: unknown, name: unknown): Promise<string> {
  const stored = id(idValue) ? await db.identities.get(id(idValue)) : undefined;
  return text(stored?.name ?? name ?? idValue);
}

/** Null for tools this does not describe. */
export async function summarizeToolChange(tool: string, input: Record<string, unknown>): Promise<ToolChange | null> {
  switch (tool) {
    case 'update_identity': {
      const stored = await db.identities.get(id(input.id));
      if (!stored) return { kind: 'missing', id: text(input.id), fields: [] };
      const fields: ChangeField[] = fieldsOf(input, stored as unknown as Record<string, unknown>, ['description', 'status', 'contact'],
        (key, value) => (key === 'status' && value === 'none' ? '' : key === 'contact' ? String(!!value) : value));
      if (has(input, 'contact')) fields[fields.findIndex(field => field.field === 'contact')].from = String(!!stored.contact);
      if (list(input.addOtherNames).length) fields.push({ field: 'addOtherNames', items: nameItems(input.addOtherNames) });
      if (list(input.addDetails).length) fields.push({ field: 'addDetails', items: detailItems(input.addDetails) });
      return { kind: 'changes', name: text(stored.name), fields };
    }
    case 'create_identity': {
      const fields: ChangeField[] = ['type', 'status', 'organization', 'description', 'contact'].filter(key => has(input, key)).map(key => ({ field: key, to: text(key === 'contact' ? String(!!input[key]) : input[key]) }));
      if (list(input.otherNames).length) fields.push({ field: 'otherNames', items: nameItems(input.otherNames) });
      if (list(input.details).length) fields.push({ field: 'details', items: detailItems(input.details) });
      return { kind: 'creates', name: text(input.name), fields };
    }
    case 'connect_identities':
      return { kind: 'connects', from: await identityName(input.fromId, input.fromName), phrase: text(input.phrase), to: await identityName(input.toId, input.toName), fields: [] };
    case 'update_note': {
      const stored = await db.notes.get(id(input.id));
      if (!stored) return { kind: 'missing', id: text(input.id), fields: [] };
      const fields = [...fieldsOf(input, stored as unknown as Record<string, unknown>, ['title']), ...changed(input, ['content', 'appendContent'])];
      if (has(input, 'tags')) fields.push({ field: 'tags', items: nameItems(input.tags) });
      return { kind: 'changes', name: text(stored.title), fields };
    }
    case 'update_task': {
      const stored = await db.tasks.get(id(input.id));
      if (!stored) return { kind: 'missing', id: text(input.id), fields: [] };
      return { kind: 'changes', name: text(stored.title), fields: [
        ...fieldsOf(input, stored as unknown as Record<string, unknown>, ['title', 'status', 'priority', 'assigneeId']), ...changed(input, ['description'])] };
    }
    case 'update_ioc': {
      const stored = await db.standaloneIOCs.get(id(input.id));
      if (!stored) return { kind: 'missing', id: text(input.id), fields: [] };
      return { kind: 'changes', name: text(`${stored.type}: ${stored.value}`), fields: [
        ...fieldsOf(input, stored as unknown as Record<string, unknown>, ['type', 'value', 'confidence', 'iocStatus', 'iocSubtype', 'attribution']), ...changed(input, ['analystNotes'])] };
    }
    default: return null;
  }
}
