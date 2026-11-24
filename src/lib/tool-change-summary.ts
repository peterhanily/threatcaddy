import { db } from '../db';
import { detailsToAdd, findIdentity, identitiesBeside, identityScope, otherNamesToAdd, prepareIdentityLabels, toolItems } from './llm-tools-identities';

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
/** Direction controls a stored name may hold would reorder the card's sentence ("X reports to Y"). */
const BIDI_CONTROLS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
const text = (value: unknown) => {
  const shown = value == null || value === '' ? '—' : String(value).replace(BIDI_CONTROLS, '').replace(/\s+/g, ' ').trim();
  return shown.length > MAX ? `${shown.slice(0, MAX).replace(/[\uD800-\uDBFF]$/, '')}…` : shown;
};
const has = (input: Record<string, unknown>, key: string) => Object.hasOwn(input, key) && input[key] !== undefined;
const list = (value: unknown) => (Array.isArray(value) ? value : value == null || value === '' ? [] : [value]);
/** `from → to` for each field the input names. */
// An empty value is not a change these tools make.
const fieldsOf = (input: Record<string, unknown>, stored: Record<string, unknown> | undefined, keys: readonly string[]) =>
  keys.filter(key => has(input, key) && String(input[key]).trim() !== '').map(key => ({ field: key, from: text(stored?.[key]), to: text(input[key]) }));
const changed = (input: Record<string, unknown>, keys: readonly string[]): ChangeField[] => keys.filter(key => has(input, key)).map(field => ({ field, changed: true }));
const nameItems = (value: unknown) => list(value).flatMap(name => (typeof name === 'string' && name.trim() ? [{ text: text(name) }] : []));
const id = (value: unknown) => String(value || '');
const status = (value: unknown) => { const text = String(value ?? '').trim().toLowerCase(); return text === 'none' ? '' : text; };
/** Details as the tool will store them: its item limit, and each marked private by its rule. */
const detailItems = (value: unknown) => detailsToAdd(value).map(detail => ({ text: text(detail.label), ...(detail.private ? { private: true } : {}) }));

/** Null for tools this does not describe. `folderId` is the conversation's or agent's investigation. */
export async function summarizeToolChange(tool: string, input: Record<string, unknown>, folderId?: string): Promise<ToolChange | null> {
  switch (tool) {
    case 'update_identity': {
      const stored = await db.identities.get(id(input.id));
      if (!stored || stored.trashed) return { kind: 'missing', id: text(input.id), fields: [] };
      // As executeUpdateIdentity reads each field (private labels in the interface language included).
      await prepareIdentityLabels();
      const fields: ChangeField[] = [];
      if (input.description !== undefined) fields.push({ field: 'description', from: text(stored.description), to: text(input.description) });
      if (input.status !== undefined) fields.push({ field: 'status', from: text(stored.status), to: text(status(input.status)) });
      if (typeof input.contact === 'boolean') fields.push({ field: 'contact', from: String(!!stored.contact), to: String(input.contact) });
      const names = otherNamesToAdd(stored, input.addOtherNames, await identitiesBeside(stored));
      if (names.length) fields.push({ field: 'addOtherNames', items: names.map(name => ({ text: text(name) })) });
      const details = detailItems(input.addDetails);
      if (details.length) fields.push({ field: 'addDetails', items: details });
      return { kind: 'changes', name: text(stored.name), fields };
    }
    case 'create_identity': {
      await prepareIdentityLabels();
      const fields: ChangeField[] = ['type', 'status', 'organization', 'description'].filter(key => has(input, key) && String(input[key]).trim())
        .map(key => ({ field: key, to: text(key === 'status' ? status(input[key]) : input[key]) }));
      if (input.contact === true) fields.push({ field: 'contact', to: 'true' });
      const names = nameItems(toolItems(input.otherNames));
      if (names.length) fields.push({ field: 'otherNames', items: names });
      const details = detailItems(input.details);
      if (details.length) fields.push({ field: 'details', items: details });
      return { kind: 'creates', name: text(input.name), fields };
    }
    case 'connect_identities': {
      // Both ends as executeConnectIdentities finds them: by id, or by exact name or other name.
      const first = id(input.fromId) ? await db.identities.get(id(input.fromId)) : undefined;
      const rows = await identityScope(first?.folderId ?? folderId);
      const from = findIdentity(rows, { id: input.fromId, name: input.fromName });
      const to = findIdentity(rows, { id: input.toId, name: input.toName });
      if (typeof from === 'string') return { kind: 'missing', id: text(input.fromId || input.fromName), fields: [] };
      if (typeof to === 'string') return { kind: 'missing', id: text(input.toId || input.toName), fields: [] };
      return { kind: 'connects', from: text(from.name), phrase: text(input.phrase), to: text(to.name), fields: [] };
    }
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
