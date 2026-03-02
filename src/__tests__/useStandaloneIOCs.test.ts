/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStandaloneIOCs } from '../hooks/useStandaloneIOCs';
import { db } from '../db';

describe('useStandaloneIOCs', () => {
  beforeEach(async () => {
    await db.standaloneIOCs.clear();
  });

  it('starts with empty iocs and loading=false', async () => {
    const { result } = renderHook(() => useStandaloneIOCs());
    await act(async () => {});
    expect(result.current.iocs).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('creates an IOC with defaults', async () => {
    const { result } = renderHook(() => useStandaloneIOCs());
    await act(async () => {});

    let ioc: Awaited<ReturnType<typeof result.current.createIOC>>;
    await act(async () => {
      ioc = await result.current.createIOC();
    });

    expect(result.current.iocs).toHaveLength(1);
    expect(result.current.iocs[0].type).toBe('ipv4');
    expect(result.current.iocs[0].value).toBe('');
    expect(result.current.iocs[0].confidence).toBe('medium');
    expect(result.current.iocs[0].tags).toEqual([]);
    expect(result.current.iocs[0].trashed).toBe(false);
    expect(result.current.iocs[0].archived).toBe(false);
    expect(ioc!.id).toBeTruthy();
  });

  it('creates an IOC with overrides', async () => {
    const { result } = renderHook(() => useStandaloneIOCs());
    await act(async () => {});

    await act(async () => {
      await result.current.createIOC({
        type: 'domain',
        value: 'evil.example.com',
        confidence: 'high',
        tags: ['malware'],
      });
    });

    expect(result.current.iocs[0].type).toBe('domain');
    expect(result.current.iocs[0].value).toBe('evil.example.com');
    expect(result.current.iocs[0].confidence).toBe('high');
    expect(result.current.iocs[0].tags).toEqual(['malware']);
  });

  it('persists IOCs to IndexedDB', async () => {
    const { result } = renderHook(() => useStandaloneIOCs());
    await act(async () => {});

    await act(async () => {
      await result.current.createIOC({ value: '10.0.0.1' });
    });

    const stored = await db.standaloneIOCs.toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0].value).toBe('10.0.0.1');
  });

  it('updates an IOC', async () => {
    const { result } = renderHook(() => useStandaloneIOCs());
    await act(async () => {});

    let iocId: string;
    await act(async () => {
      const ioc = await result.current.createIOC({ value: '192.168.1.1' });
      iocId = ioc.id;
    });

    await act(async () => {
      await result.current.updateIOC(iocId!, { value: '10.0.0.1', confidence: 'high' });
    });

    expect(result.current.iocs[0].value).toBe('10.0.0.1');
    expect(result.current.iocs[0].confidence).toBe('high');
    expect(result.current.iocs[0].updatedAt).toBeGreaterThanOrEqual(result.current.iocs[0].createdAt);
  });

  it('deletes an IOC permanently', async () => {
    const { result } = renderHook(() => useStandaloneIOCs());
    await act(async () => {});

    let iocId: string;
    await act(async () => {
      const ioc = await result.current.createIOC();
      iocId = ioc.id;
    });
    expect(result.current.iocs).toHaveLength(1);

    await act(async () => {
      await result.current.deleteIOC(iocId!);
    });

    expect(result.current.iocs).toHaveLength(0);
    const stored = await db.standaloneIOCs.toArray();
    expect(stored).toHaveLength(0);
  });

  it('trashes and restores an IOC', async () => {
    const { result } = renderHook(() => useStandaloneIOCs());
    await act(async () => {});

    let iocId: string;
    await act(async () => {
      const ioc = await result.current.createIOC();
      iocId = ioc.id;
    });

    await act(async () => {
      await result.current.trashIOC(iocId!);
    });

    expect(result.current.iocs[0].trashed).toBe(true);
    expect(result.current.iocs[0].trashedAt).toBeGreaterThan(0);

    await act(async () => {
      await result.current.restoreIOC(iocId!);
    });

    expect(result.current.iocs[0].trashed).toBe(false);
  });

  it('toggles archive on an IOC', async () => {
    const { result } = renderHook(() => useStandaloneIOCs());
    await act(async () => {});

    let iocId: string;
    await act(async () => {
      const ioc = await result.current.createIOC();
      iocId = ioc.id;
    });

    await act(async () => {
      await result.current.toggleArchiveIOC(iocId!);
    });

    expect(result.current.iocs[0].archived).toBe(true);

    await act(async () => {
      await result.current.toggleArchiveIOC(iocId!);
    });

    expect(result.current.iocs[0].archived).toBe(false);
  });

  it('empties trash IOCs', async () => {
    const { result } = renderHook(() => useStandaloneIOCs());
    await act(async () => {});

    let t2Id: string;
    await act(async () => {
      await result.current.createIOC({ value: 'keep-me' });
      const t2 = await result.current.createIOC({ value: 'trash-me' });
      t2Id = t2.id;
    });

    await act(async () => {
      await result.current.trashIOC(t2Id!);
    });

    await act(async () => {
      await result.current.emptyTrashIOCs();
    });

    expect(result.current.iocs).toHaveLength(1);
    expect(result.current.iocs[0].value).toBe('keep-me');
  });

  it('filters by active status (excludes trashed/archived)', async () => {
    const { result } = renderHook(() => useStandaloneIOCs());
    await act(async () => {});

    let tId: string;
    await act(async () => {
      await result.current.createIOC({ value: 'active-ioc' });
      const t = await result.current.createIOC({ value: 'trashed-ioc' });
      tId = t.id;
    });

    await act(async () => {
      await result.current.trashIOC(tId!);
    });

    const active = result.current.getFilteredIOCs({});
    expect(active).toHaveLength(1);
    expect(active[0].value).toBe('active-ioc');
  });

  it('filters by trashed status', async () => {
    const { result } = renderHook(() => useStandaloneIOCs());
    await act(async () => {});

    let tId: string;
    await act(async () => {
      await result.current.createIOC({ value: 'active-ioc' });
      const t = await result.current.createIOC({ value: 'trashed-ioc' });
      tId = t.id;
    });

    await act(async () => {
      await result.current.trashIOC(tId!);
    });

    const trashed = result.current.getFilteredIOCs({ showTrashed: true });
    expect(trashed).toHaveLength(1);
    expect(trashed[0].value).toBe('trashed-ioc');
  });

  it('filters by archived status', async () => {
    const { result } = renderHook(() => useStandaloneIOCs());
    await act(async () => {});

    let aId: string;
    await act(async () => {
      await result.current.createIOC({ value: 'active-ioc' });
      const a = await result.current.createIOC({ value: 'archived-ioc' });
      aId = a.id;
    });

    await act(async () => {
      await result.current.toggleArchiveIOC(aId!);
    });

    const archived = result.current.getFilteredIOCs({ showArchived: true });
    expect(archived).toHaveLength(1);
    expect(archived[0].value).toBe('archived-ioc');
  });

  it('filters by folderId', async () => {
    const { result } = renderHook(() => useStandaloneIOCs());
    await act(async () => {});

    await act(async () => {
      await result.current.createIOC({ value: 'folder-a', folderId: 'f1' });
      await result.current.createIOC({ value: 'folder-b', folderId: 'f2' });
    });

    const filtered = result.current.getFilteredIOCs({ folderId: 'f1' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].value).toBe('folder-a');
  });

  it('filters by type', async () => {
    const { result } = renderHook(() => useStandaloneIOCs());
    await act(async () => {});

    await act(async () => {
      await result.current.createIOC({ type: 'ipv4', value: '10.0.0.1' });
      await result.current.createIOC({ type: 'domain', value: 'evil.example.com' });
    });

    const filtered = result.current.getFilteredIOCs({ type: 'domain' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].value).toBe('evil.example.com');
  });

  it('computes iocCounts correctly', async () => {
    const { result } = renderHook(() => useStandaloneIOCs());
    await act(async () => {});

    let trashId: string;
    let archiveId: string;
    await act(async () => {
      await result.current.createIOC({ value: 'active-1' });
      await result.current.createIOC({ value: 'active-2' });
      const t = await result.current.createIOC({ value: 'trashed' });
      trashId = t.id;
      const a = await result.current.createIOC({ value: 'archived' });
      archiveId = a.id;
    });

    await act(async () => {
      await result.current.trashIOC(trashId!);
      await result.current.toggleArchiveIOC(archiveId!);
    });

    expect(result.current.iocCounts.total).toBe(2);
    expect(result.current.iocCounts.trashed).toBe(1);
    expect(result.current.iocCounts.archived).toBe(1);
  });

  it('auto-purges old trashed IOCs on load', async () => {
    // Manually insert an IOC that was trashed 31 days ago
    const oldIOC = {
      id: 'old-trashed',
      type: 'ipv4' as const,
      value: '192.168.0.1',
      confidence: 'medium' as const,
      tags: [],
      trashed: true,
      trashedAt: Date.now() - 31 * 86400000,
      archived: false,
      createdAt: Date.now() - 60 * 86400000,
      updatedAt: Date.now() - 31 * 86400000,
    };
    await db.standaloneIOCs.add(oldIOC);

    const { result } = renderHook(() => useStandaloneIOCs());
    await act(async () => {});

    // Old trashed IOC should have been purged
    expect(result.current.iocs.find(i => i.id === 'old-trashed')).toBeUndefined();
    const stored = await db.standaloneIOCs.get('old-trashed');
    expect(stored).toBeUndefined();
  });
});
