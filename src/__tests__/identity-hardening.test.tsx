/**
 * Phase 7 security hardening: no oracle at the detail cap, bounded matching on hostile text,
 * custom types that are not object keys, and whole-word phone masking.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import type { Identity, ToolUseBlock } from '../types';
import { executeTool } from '../lib/llm-tools';
import { mintHumanApproval } from '../lib/human-approval';
import { ENGLISH_TYPE_LABELS, canonicalType, guessIdentity, maskDetail } from '../lib/identity-model';
import { getNodeIcon } from '../lib/graph-icons';
import { identityNodeColor } from '../lib/graph-data';
import { buildIdentities } from '../lib/identity-import';
import { buildIdentityIndex, findMentions } from '../lib/identity-match';
import type { ColumnMapping } from '../lib/data-import';
import { seedAIWorkspace } from './helpers/ai-workspace';
import { ALL_STATIC_TOOLS } from './helpers/tool-exec';

const SECRET = '+44 7700 900123';
const now = Date.now();
let n = 0;
async function run(name: string, input: Record<string, unknown>, folderId = 'S') {
  const toolUse: ToolUseBlock = { type: 'tool_use', id: `hardening-${++n}`, name, input };
  const approval = mintHumanApproval(toolUse, folderId, 'chat-card');
  const { result } = await executeTool(toolUse, folderId, undefined, { surface: 'chat-act', allowedTools: ALL_STATIC_TOOLS, approval });
  return JSON.parse(result) as Record<string, unknown>;
}
const person = (id: string, extra: Partial<Identity> = {}): Identity => ({ id, folderId: 'S', type: 'person', name: id, aliases: [], details: [],
  connections: [], tags: [], trashed: false, archived: false, createdAt: now, updatedAt: now, ...extra });
const elapsed = (work: () => unknown) => { const started = performance.now(); work(); return performance.now() - started; };

describe('the detail cap', () => {
  beforeEach(async () => {
    await seedAIWorkspace();
    const details = Array.from({ length: 199 }, (_, index) => ({ id: `d${index}`, label: 'Note', value: `public ${index}` }));
    await db.identities.add(person('dana', { name: 'Dana Okafor', details: [...details, { id: 'p', label: 'Phone', value: SECRET, private: true }] }));
  });

  it('answers the same whether or not a guess is the private value, with one entry or several', async () => {
    const reply = async (guess: string, fillers: number) => {
      // Each attempt starts from the same identity: a refused call stores nothing, an accepted one is undone here.
      const before = await db.identities.get('dana');
      const result = await run('update_identity', { id: 'dana', addDetails: [{ label: 'Phone', value: guess },
        ...Array.from({ length: fillers }, (_, index) => ({ label: 'Note', value: `filler ${guess} ${index}` }))] });
      if (before) await db.identities.put(before);
      return result;
    };
    // 199 public details: one more fits, two do not, whatever the guess.
    for (const fillers of [0, 1, 5]) expect(await reply(SECRET, fillers)).toEqual(await reply('+44 7700 900999', fillers));
    expect(await reply(SECRET, 0)).toMatchObject({ success: true, detailsReceived: 1 });
    expect(await reply(SECRET, 1)).toMatchObject({ error: expect.stringMatching(/at most 200 details/) });
  });
});

describe('the total detail cap', () => {
  it('stops an identity growing without end through private details', async () => {
    await seedAIWorkspace();
    const details = Array.from({ length: 395 }, (_, index) => ({ id: `p${index}`, label: 'Phone', value: `+44 7700 9${String(index).padStart(5, '0')}`, private: true }));
    await db.identities.add(person('lee', { name: 'Lee Park', details }));
    expect(await run('update_identity', { id: 'lee', addDetails: [{ label: 'Phone', value: '+1 555 0100' }] })).toMatchObject({ success: true });
    const many = Array.from({ length: 10 }, (_, index) => ({ label: 'Phone', value: `+1 555 01${index}0` }));
    expect(await run('update_identity', { id: 'lee', addDetails: many })).toMatchObject({ error: expect.stringMatching(/at most/) });
  });
});

// Complexity is checked without tight wall-clock limits (they fail on a busy machine): inputs are
// large enough that the old quadratic code would take minutes, while the bound is seconds.
describe('hostile text stays fast', () => {
  const evil = 'a@' + '.'.repeat(400_000) + '@';
  it('masks a long hidden value and guesses a long imported name in linear time', () => {
    expect(elapsed(() => expect(maskDetail({ label: 'Note', value: evil })).toBe('•••••••'))).toBeLessThan(3000);
    expect(elapsed(() => guessIdentity(evil))).toBeLessThan(3000);
    const mappings = new Map<string, ColumnMapping>([['Name', 'identity-name'], ['Other names', 'identity-aliases']]);
    expect(elapsed(() => buildIdentities([{ Name: evil, 'Other names': '' }], mappings, { folderId: 'S', existing: [] }))).toBeLessThan(3000);
  });

  it('refuses a far too long Connections line before splitting it', () => {
    const mappings = new Map<string, ColumnMapping>([['Name', 'identity-name'], ['Connections', 'identity-connections']]);
    let errors: string[] = [];
    const time = elapsed(() => { errors = buildIdentities([{ Name: 'Dana', Connections: 'x: '.repeat(400_000) }], mappings, { folderId: 'S', existing: [] }).errors; });
    expect(time).toBeLessThan(3000);
    expect(errors).toEqual(['Row 2: a connection longer than 400 characters was skipped.']);
  });

  it('stops scanning a crafted note for mentions once its work budget is spent', () => {
    const name = 'a' + 'b c '.repeat(25).slice(0, 99);
    const folder = buildIdentityIndex([person('x', { name })]).folders.get('S');
    // A real mention after a crafted run that spends the budget is not looked for; on its own it is found.
    expect(findMentions(`${' @ab c'.repeat(100_000)} @${name} `, folder)).toEqual([]);
    expect(findMentions(`Spoke to @${name} today`, folder)).toHaveLength(1);
  });
});

describe('a custom type is text, never an object key', () => {
  it('keeps "__proto__" and "constructor" as typed', () => {
    expect(canonicalType('__proto__', ENGLISH_TYPE_LABELS, [])).toBe('__proto__');
    expect(canonicalType('Constructor', ENGLISH_TYPE_LABELS, [])).toBe('Constructor');
    expect(canonicalType('Organisation', ENGLISH_TYPE_LABELS, [])).toBe('organization');
    expect(identityNodeColor('__proto__')).toBe('#64748b');
    expect(() => getNodeIcon('identity', '#0ea5e9', undefined, '__proto__')).not.toThrow();
  });

  it('lets the AI create and then find an identity of such a type', async () => {
    await seedAIWorkspace();
    const created = await run('create_identity', { name: 'Proto Person', type: '__proto__' });
    expect((await db.identities.get(created.id as string))?.type).toBe('__proto__');
    expect(await run('search_identities', { query: 'zzz' })).toMatchObject({ count: 0 });
  });
});

describe('masking', () => {
  it('shows the last digits only for a phone label, as a whole word', () => {
    expect(maskDetail({ label: 'Mobile phone', value: '+44 7700 900123' })).toBe('•••• 0123');
    expect(maskDetail({ label: 'Tel', value: '+44 7700 900123' })).toBe('•••• 0123');
    expect(maskDetail({ label: 'Hotel booking ref', value: '12345678' })).toBe('•••••••');
    expect(maskDetail({ label: 'Intel source', value: '123456' })).toBe('•••••••');
  });
});
