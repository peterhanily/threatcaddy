import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { useIdentities } from '../hooks/useIdentities';
import type { Identity } from '../types';

// Synthetic people and systems only.
const identity = (id: string, over: Partial<Identity> = {}): Identity => ({
  id, folderId: 'case', type: 'person', name: id, aliases: [], details: [], connections: [], tags: [],
  trashed: false, archived: false, createdAt: 1, updatedAt: 1, ...over,
});

async function mount(folderId?: string) {
  const hook = renderHook(() => useIdentities(folderId));
  await waitFor(() => expect(hook.result.current.loadedSuccessfully).toBe(true));
  return hook;
}

beforeEach(async () => { await db.identities.clear(); });

describe('useIdentities', () => {
  it('creates an identity with empty lists, an author and its investigation', async () => {
    const { result } = await mount('case');
    let created: Identity | undefined;
    await act(async () => { created = await result.current.createIdentity({ folderId: 'case', name: 'Dana Okafor' }); });
    expect(created).toMatchObject({ type: 'person', name: 'Dana Okafor', aliases: [], details: [], connections: [], tags: [], trashed: false, archived: false });
    expect(typeof created?.createdBy).toBe('string');
    expect(await db.identities.get(created?.id ?? '')).toEqual(created);
    expect(result.current.identities.map(row => row.name)).toEqual(['Dana Okafor']);
    expect((await mount('another-case')).result.current.identities).toEqual([]);
  });

  it('keeps an old name as another name when renamed, and promotes another name without duplicating it', async () => {
    await db.identities.add(identity('dana', { name: 'Dana Okafr', aliases: ['D. Okafor'] }));
    const { result } = await mount('case');
    await act(async () => { await result.current.updateIdentity('dana', { name: 'Dana Okafor' }); });
    expect((await db.identities.get('dana'))?.aliases).toEqual(['D. Okafor', 'Dana Okafr']);
    await act(async () => { await result.current.updateIdentity('dana', { name: 'dana okafor' }); }); // case only
    expect((await db.identities.get('dana'))?.aliases).toEqual(['D. Okafor', 'Dana Okafr']);
    await act(async () => { await result.current.updateIdentity('dana', { name: 'D. Okafor' }); });
    expect(await db.identities.get('dana')).toMatchObject({ name: 'D. Okafor', aliases: ['Dana Okafr', 'dana okafor'] });
    expect(result.current.identities[0]).toMatchObject({ name: 'D. Okafor', aliases: ['Dana Okafr', 'dana okafor'] });
  });

  it('does not record an empty first name as another name', async () => {
    await db.identities.add(identity('new', { name: '' }));
    const { result } = await mount('case');
    await act(async () => { await result.current.updateIdentity('new', { name: 'svc_backup' }); });
    expect((await db.identities.get('new'))?.aliases).toEqual([]);
  });

  it('trashes, restores, archives and empties the trash', async () => {
    await db.identities.bulkAdd([identity('a'), identity('b')]);
    const { result } = await mount('case');
    await act(async () => { await result.current.trashIdentity('a'); });
    expect(await db.identities.get('a')).toMatchObject({ trashed: true, trashedAt: expect.any(Number) });
    await act(async () => { await result.current.restoreIdentity('a'); });
    const restored = await db.identities.get('a');
    expect(restored?.trashed).toBe(false);
    expect(restored).not.toHaveProperty('trashedAt');
    await act(async () => { await result.current.toggleArchiveIdentity('b'); });
    expect((await db.identities.get('b'))?.archived).toBe(true);
    await act(async () => { await result.current.trashIdentity('a'); });
    await act(async () => { await result.current.emptyTrashIdentities(); });
    expect(await db.identities.get('a')).toBeUndefined();
    expect(await db.identities.get('b')).toBeDefined();
    expect(result.current.identities.map(row => row.id)).toEqual(['b']);
  });

  it('purges identities that have been in the trash for more than 30 days', async () => {
    const day = 24 * 60 * 60 * 1000;
    await db.identities.bulkAdd([
      identity('old', { trashed: true, trashedAt: Date.now() - 31 * day }),
      identity('recent', { trashed: true, trashedAt: Date.now() - day }),
    ]);
    const { result } = await mount('case');
    expect(result.current.identities.map(row => row.id)).toEqual(['recent']);
    expect(await db.identities.get('old')).toBeUndefined();
  });

  it('deletes an identity and every connection that points to it', async () => {
    await db.identities.bulkAdd([
      identity('org', { type: 'organization', name: 'Halvorsen Logistics' }),
      identity('dana', { connections: [{ targetId: 'org', label: 'works at' }] }),
      identity('marcus', { connections: [{ targetId: 'org', label: 'works at' }, { targetId: 'dana', label: 'reports to' }] }),
    ]);
    const { result } = await mount('case');
    await act(async () => { await result.current.deleteIdentity('org'); });
    expect(await db.identities.get('org')).toBeUndefined();
    expect((await db.identities.get('dana'))?.connections).toEqual([]);
    expect((await db.identities.get('marcus'))?.connections).toEqual([{ targetId: 'dana', label: 'reports to' }]);
    expect(result.current.identities.find(row => row.id === 'marcus')?.connections).toEqual([{ targetId: 'dana', label: 'reports to' }]);
  });

  it('merges one identity into another, moving its names, details, connections and links', async () => {
    await db.identities.bulkAdd([
      identity('keep', { name: 'Tomas Lindqvist', aliases: ['T. Lindqvist'], clsLevel: 'TLP:GREEN', tags: ['payroll'],
        details: [{ id: 'd1', label: 'Email', value: 'tomas@example.test' }],
        connections: [{ targetId: 'gone', label: 'same as' }, { targetId: 'org', label: 'works at' }] }),
      identity('gone', { name: 'Tomás Lindqvist', aliases: ['t. lindqvist', 'tlindqvist'], status: 'suspicious', contact: true,
        clsLevel: 'TLP:AMBER', tags: ['payroll', 'vendor'], description: 'Finance approver',
        details: [{ id: 'd1', label: 'email', value: 'TOMAS@example.test' }, { id: 'd1', label: 'Phone', value: '+44 20 7946 0000', private: true }],
        connections: [{ targetId: 'org', label: 'Works at' }, { targetId: 'keep', label: 'same as' }, { targetId: 'laptop', label: 'uses' }] }),
      identity('org', { type: 'organization', name: 'Halvorsen Logistics' }),
      identity('laptop', { type: 'system', name: 'FIN-WS-014', connections: [{ targetId: 'gone', label: 'used by' }] }),
      identity('manager', { connections: [{ targetId: 'gone', label: 'manages' }, { targetId: 'keep', label: 'manages' }] }),
    ]);
    const { result } = await mount('case');
    await act(async () => { await result.current.mergeIdentities('keep', 'gone'); });

    expect(await db.identities.get('gone')).toBeUndefined();
    const kept = await db.identities.get('keep');
    expect(kept).toMatchObject({
      name: 'Tomas Lindqvist', aliases: ['T. Lindqvist', 'Tomás Lindqvist', 'tlindqvist'], description: 'Finance approver',
      status: 'suspicious', contact: true, clsLevel: 'TLP:AMBER', tags: ['payroll', 'vendor'],
      connections: [{ targetId: 'org', label: 'works at' }, { targetId: 'laptop', label: 'uses' }],
    });
    // Same label and value (ignoring case) is one detail; a new detail keeps its privacy but not a clashing id.
    expect(kept?.details).toHaveLength(2);
    expect(kept?.details[1]).toMatchObject({ label: 'Phone', value: '+44 20 7946 0000', private: true });
    expect(kept?.details[1].id).not.toBe('d1');
    expect((await db.identities.get('laptop'))?.connections).toEqual([{ targetId: 'keep', label: 'used by' }]);
    expect((await db.identities.get('manager'))?.connections).toEqual([{ targetId: 'keep', label: 'manages' }]);
    expect(result.current.identities.map(row => row.id).sort()).toEqual(['keep', 'laptop', 'manager', 'org']);
  });

  it('refuses to merge across investigations or into itself and changes nothing', async () => {
    const here = identity('here', { name: 'Dana Okafor' });
    const there = identity('there', { folderId: 'another-case', name: 'Dana Okafor' });
    await db.identities.bulkAdd([here, there]);
    const { result } = await mount();
    await expect(result.current.mergeIdentities('here', 'there')).rejects.toThrow('same investigation');
    await expect(result.current.mergeIdentities('here', 'here')).rejects.toThrow('two different identities');
    await expect(result.current.mergeIdentities('here', 'missing')).rejects.toThrow('not found');
    expect(await db.identities.toArray()).toEqual([here, there]);
  });
});
