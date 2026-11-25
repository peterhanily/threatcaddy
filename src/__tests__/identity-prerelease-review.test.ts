// Regression tests for the pre-release security review (25 Nov 2026).
import { describe, expect, it } from 'vitest';
import type { Identity } from '../types';
import { isPrivateLabel, nameTakenBy } from '../lib/identity-model';
import { sanitizeIdentity } from '../lib/export';

const identity = (id: string, name: string, extra: Partial<Identity> = {}): Identity => ({ id, folderId: 'case', type: 'person', name, aliases: [], details: [],
  connections: [], tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1, ...extra });

describe('labels that start private', () => {
  it.each(['Race', 'Ethnic origin', 'Ethnic group', 'Racial origin', 'Sexuality', 'Disabilities', 'Age', 'Nationality', 'Citizenship', 'Marital status',
    'Diagnosis', 'Sick leave', 'Union membership', 'Trade union', 'Immigration status', 'Credit card', 'Card number', 'Debit card no', 'TIN', 'TIN number',
    'Mob', 'Ph', 'Privatadresse', 'Wohnort', 'Numéro de sécurité sociale'])('%s', label => {
    expect(isPrivateLabel(label)).toBe(true);
  });
  it.each(['Password age', 'Account age', 'Race condition', 'Card reader', 'SIM card', 'Bank account', 'Union server', 'Leave policy', 'Email', 'Hostname',
    'Health status', 'Job title'])('%s stays public', label => {
    expect(isPrivateLabel(label)).toBe(false);
  });
});

describe('a name that reads the same is the same name', () => {
  const held = [identity('dana', 'Dana Okafor', { aliases: ['dokafor'] })];
  it.each([['zero-width space', 'Dana​ Okafor'], ['zero-width joiner', 'Da‍na Okafor'], ['right-to-left override', '‮Dana Okafor'],
    ['left-to-right mark', 'Dana Okafor‎'], ['full-width letters', 'Ｄａｎａ Ｏｋａｆｏｒ'], ['an other name with a soft hyphen', 'dok­afor']])('%s', (_kind, name) => {
    expect(nameTakenBy(held, 'case', name)?.id).toBe('dana');
  });
  it('a different name is free, and so is the identity’s own', () => {
    expect(nameTakenBy(held, 'case', 'Dana Okafor-Reyes')).toBeUndefined();
    expect(nameTakenBy(held, 'case', 'Dana Okafor', 'dana')).toBeUndefined();
    expect(nameTakenBy(held, 'case', '​')).toBeUndefined();
  });
});

describe('a crafted identity row', () => {
  const row = (extra: Record<string, unknown>) => sanitizeIdentity({ id: 'x', folderId: 'case', type: 'person', name: 'Dana Okafor', aliases: [], details: [], connections: [], tags: [], ...extra }) as Identity;
  it('keeps a detail private unless its flag plainly says public', () => {
    const details = row({ details: [{ id: 'a', label: 'Phone', value: '1', private: 'true' }, { id: 'b', label: 'Phone', value: '2', private: 1 },
      { id: 'c', label: 'Phone', value: '3', private: {} }, { id: 'd', label: 'Email', value: '4', private: false }, { id: 'e', label: 'Email', value: '5' },
      { id: 'f', label: 'Email', value: '6', private: null }, { id: 'g', label: 'Phone', value: '7', private: true }] }).details;
    expect(details.map(detail => !!detail.private)).toEqual([true, true, true, false, false, false, true]);
  });
  it('gives details that share an id their own', () => {
    const details = row({ details: [{ id: 'same', label: 'Phone', value: '1', private: true }, { id: 'same', label: 'Email', value: '2' }, { id: 'same', label: 'Role', value: '3' }] }).details;
    expect(new Set(details.map(detail => detail.id)).size).toBe(3);
    expect(details[0].id).toBe('same');
    // The same row gives the same ids on every device.
    expect(row({ details: [{ id: 'same', label: 'a', value: '1' }, { id: 'same', label: 'b', value: '2' }] }).details.map(detail => detail.id))
      .toEqual(row({ details: [{ id: 'same', label: 'a', value: '1' }, { id: 'same', label: 'b', value: '2' }] }).details.map(detail => detail.id));
  });
  it('bounds every text and list', () => {
    const huge = 'x'.repeat(500_000);
    const clean = row({ name: huge, type: huge, description: huge, aliases: Array.from({ length: 5000 }, (_, index) => huge + index),
      details: Array.from({ length: 5000 }, (_, index) => ({ id: String(index), label: huge, value: huge })),
      connections: Array.from({ length: 5000 }, (_, index) => ({ targetId: String(index), label: huge })) });
    expect([clean.name.length, clean.type.length, clean.description?.length]).toEqual([1000, 1000, 20_000]);
    expect([clean.aliases.length, clean.details.length, clean.connections.length]).toEqual([2000, 2000, 2000]);
    expect(Math.max(...clean.aliases.map(alias => alias.length), ...clean.details.map(detail => detail.label.length), ...clean.connections.map(c => c.label.length))).toBe(1000);
    expect(Math.max(...clean.details.map(detail => detail.value.length))).toBe(20_000);
  });
  it('leaves an ordinary row as it is', () => {
    const ordinary = { id: 'x', folderId: 'case', type: 'person', name: 'Dana Okafor', description: 'Accounts payable', aliases: ['dokafor'],
      details: [{ id: 'a', label: 'Phone', value: '+44 7700 900123', private: true }, { id: 'b', label: 'Email', value: 'dana@halvorsen.example' }],
      connections: [{ targetId: 'org', label: 'works at' }], tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 2 };
    expect(sanitizeIdentity(ordinary)).toMatchObject(ordinary);
  });
});
