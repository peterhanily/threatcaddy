/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTimeline } from '../hooks/useTimeline';
import { db } from '../db';

describe('useTimeline', () => {
  beforeEach(async () => {
    await db.timelineEvents.clear();
  });

  it('starts with empty events and loading=false', async () => {
    const { result } = renderHook(() => useTimeline());
    await act(async () => {});
    expect(result.current.events).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('creates an event with defaults', async () => {
    const { result } = renderHook(() => useTimeline());
    await act(async () => {});

    let event: Awaited<ReturnType<typeof result.current.createEvent>>;
    await act(async () => {
      event = await result.current.createEvent();
    });

    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].title).toBe('');
    expect(result.current.events[0].eventType).toBe('other');
    expect(result.current.events[0].source).toBe('');
    expect(result.current.events[0].confidence).toBe('low');
    expect(result.current.events[0].linkedIOCIds).toEqual([]);
    expect(result.current.events[0].linkedNoteIds).toEqual([]);
    expect(result.current.events[0].linkedTaskIds).toEqual([]);
    expect(result.current.events[0].mitreAttackIds).toEqual([]);
    expect(result.current.events[0].assets).toEqual([]);
    expect(result.current.events[0].tags).toEqual([]);
    expect(result.current.events[0].starred).toBe(false);
    expect(result.current.events[0].timelineId).toBe('');
    expect(result.current.events[0].trashed).toBe(false);
    expect(result.current.events[0].archived).toBe(false);
    expect(event!.id).toBeTruthy();
  });

  it('creates an event with overrides', async () => {
    const { result } = renderHook(() => useTimeline());
    await act(async () => {});

    await act(async () => {
      await result.current.createEvent({
        title: 'Phishing Email Received',
        eventType: 'initial-access',
        source: 'email-gateway',
        timelineId: 'tl-1',
      });
    });

    expect(result.current.events[0].title).toBe('Phishing Email Received');
    expect(result.current.events[0].eventType).toBe('initial-access');
    expect(result.current.events[0].source).toBe('email-gateway');
    expect(result.current.events[0].timelineId).toBe('tl-1');
  });

  it('persists events to IndexedDB', async () => {
    const { result } = renderHook(() => useTimeline());
    await act(async () => {});

    await act(async () => {
      await result.current.createEvent({ title: 'Persisted Event' });
    });

    const stored = await db.timelineEvents.toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0].title).toBe('Persisted Event');
  });

  it('updates an event', async () => {
    const { result } = renderHook(() => useTimeline());
    await act(async () => {});

    let eventId: string;
    await act(async () => {
      const e = await result.current.createEvent({ title: 'Original' });
      eventId = e.id;
    });

    await act(async () => {
      await result.current.updateEvent(eventId!, { title: 'Updated Title', source: 'siem' });
    });

    expect(result.current.events[0].title).toBe('Updated Title');
    expect(result.current.events[0].source).toBe('siem');
    expect(result.current.events[0].updatedAt).toBeGreaterThan(0);
  });

  it('deletes an event permanently', async () => {
    const { result } = renderHook(() => useTimeline());
    await act(async () => {});

    let eventId: string;
    await act(async () => {
      const e = await result.current.createEvent({ title: 'To Delete' });
      eventId = e.id;
    });
    expect(result.current.events).toHaveLength(1);

    await act(async () => {
      await result.current.deleteEvent(eventId!);
    });

    expect(result.current.events).toHaveLength(0);
    const stored = await db.timelineEvents.toArray();
    expect(stored).toHaveLength(0);
  });

  it('trashes and restores an event', async () => {
    const { result } = renderHook(() => useTimeline());
    await act(async () => {});

    let eventId: string;
    await act(async () => {
      const e = await result.current.createEvent({ title: 'Trash Me' });
      eventId = e.id;
    });

    await act(async () => {
      await result.current.trashEvent(eventId!);
    });

    expect(result.current.events[0].trashed).toBe(true);
    expect(result.current.events[0].trashedAt).toBeGreaterThan(0);

    await act(async () => {
      await result.current.restoreEvent(eventId!);
    });

    expect(result.current.events[0].trashed).toBe(false);
  });

  it('toggles archive on an event', async () => {
    const { result } = renderHook(() => useTimeline());
    await act(async () => {});

    let eventId: string;
    await act(async () => {
      const e = await result.current.createEvent({ title: 'Archive Me' });
      eventId = e.id;
    });

    await act(async () => {
      await result.current.toggleArchiveEvent(eventId!);
    });

    expect(result.current.events[0].archived).toBe(true);

    await act(async () => {
      await result.current.toggleArchiveEvent(eventId!);
    });

    expect(result.current.events[0].archived).toBe(false);
  });

  it('empties trash events', async () => {
    const { result } = renderHook(() => useTimeline());
    await act(async () => {});

    let trashId: string;
    await act(async () => {
      await result.current.createEvent({ title: 'Keep' });
      const t = await result.current.createEvent({ title: 'Trash Me' });
      trashId = t.id;
    });

    await act(async () => {
      await result.current.trashEvent(trashId!);
    });

    await act(async () => {
      await result.current.emptyTrashEvents();
    });

    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].title).toBe('Keep');
  });

  it('toggles star on an event', async () => {
    const { result } = renderHook(() => useTimeline());
    await act(async () => {});

    let eventId: string;
    await act(async () => {
      const e = await result.current.createEvent({ title: 'Star Me' });
      eventId = e.id;
    });

    expect(result.current.events[0].starred).toBe(false);

    await act(async () => {
      await result.current.toggleStar(eventId!);
    });

    expect(result.current.events[0].starred).toBe(true);

    await act(async () => {
      await result.current.toggleStar(eventId!);
    });

    expect(result.current.events[0].starred).toBe(false);
  });

  it('filters by active status (excludes trashed/archived)', async () => {
    const { result } = renderHook(() => useTimeline());
    await act(async () => {});

    let trashId: string;
    let archiveId: string;
    await act(async () => {
      await result.current.createEvent({ title: 'Active' });
      const t = await result.current.createEvent({ title: 'Trashed' });
      trashId = t.id;
      const a = await result.current.createEvent({ title: 'Archived' });
      archiveId = a.id;
    });

    await act(async () => {
      await result.current.trashEvent(trashId!);
      await result.current.toggleArchiveEvent(archiveId!);
    });

    const active = result.current.getFilteredEvents({});
    expect(active).toHaveLength(1);
    expect(active[0].title).toBe('Active');
  });

  it('filters by trashed status', async () => {
    const { result } = renderHook(() => useTimeline());
    await act(async () => {});

    let trashId: string;
    await act(async () => {
      await result.current.createEvent({ title: 'Active' });
      const t = await result.current.createEvent({ title: 'Trashed' });
      trashId = t.id;
    });

    await act(async () => {
      await result.current.trashEvent(trashId!);
    });

    const trashed = result.current.getFilteredEvents({ showTrashed: true });
    expect(trashed).toHaveLength(1);
    expect(trashed[0].title).toBe('Trashed');
  });

  it('filters by archived status', async () => {
    const { result } = renderHook(() => useTimeline());
    await act(async () => {});

    let archiveId: string;
    await act(async () => {
      await result.current.createEvent({ title: 'Active' });
      const a = await result.current.createEvent({ title: 'Archived' });
      archiveId = a.id;
    });

    await act(async () => {
      await result.current.toggleArchiveEvent(archiveId!);
    });

    const archived = result.current.getFilteredEvents({ showArchived: true });
    expect(archived).toHaveLength(1);
    expect(archived[0].title).toBe('Archived');
  });

  it('filters by timelineId', async () => {
    const { result } = renderHook(() => useTimeline());
    await act(async () => {});

    await act(async () => {
      await result.current.createEvent({ title: 'Timeline A', timelineId: 'tl-a' });
      await result.current.createEvent({ title: 'Timeline B', timelineId: 'tl-b' });
    });

    const filtered = result.current.getFilteredEvents({ timelineId: 'tl-a' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].title).toBe('Timeline A');
  });

  it('filters by eventTypes array', async () => {
    const { result } = renderHook(() => useTimeline());
    await act(async () => {});

    await act(async () => {
      await result.current.createEvent({ title: 'Access', eventType: 'initial-access' });
      await result.current.createEvent({ title: 'Exec', eventType: 'execution' });
      await result.current.createEvent({ title: 'Other', eventType: 'other' });
    });

    const filtered = result.current.getFilteredEvents({ eventTypes: ['initial-access', 'execution'] });
    expect(filtered).toHaveLength(2);
    const titles = filtered.map((e) => e.title).sort();
    expect(titles).toEqual(['Access', 'Exec']);
  });

  it('filters by source (case-insensitive substring match)', async () => {
    const { result } = renderHook(() => useTimeline());
    await act(async () => {});

    await act(async () => {
      await result.current.createEvent({ title: 'Event 1', source: 'Splunk SIEM' });
      await result.current.createEvent({ title: 'Event 2', source: 'email-gateway' });
      await result.current.createEvent({ title: 'Event 3', source: 'Splunk UBA' });
    });

    const filtered = result.current.getFilteredEvents({ source: 'splunk' });
    expect(filtered).toHaveLength(2);
    const titles = filtered.map((e) => e.title).sort();
    expect(titles).toEqual(['Event 1', 'Event 3']);
  });

  it('filters by starred', async () => {
    const { result } = renderHook(() => useTimeline());
    await act(async () => {});

    let starId: string;
    await act(async () => {
      await result.current.createEvent({ title: 'Normal' });
      const s = await result.current.createEvent({ title: 'Starred' });
      starId = s.id;
    });

    await act(async () => {
      await result.current.toggleStar(starId!);
    });

    const filtered = result.current.getFilteredEvents({ starred: true });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].title).toBe('Starred');
  });

  it('filters by date range (dateStart, dateEnd)', async () => {
    const { result } = renderHook(() => useTimeline());
    await act(async () => {});

    const now = Date.now();
    await act(async () => {
      await result.current.createEvent({ title: 'Old', timestamp: now - 7 * 86400000 });
      await result.current.createEvent({ title: 'Recent', timestamp: now - 1 * 86400000 });
      await result.current.createEvent({ title: 'Future', timestamp: now + 1 * 86400000 });
    });

    const filtered = result.current.getFilteredEvents({
      dateStart: now - 2 * 86400000,
      dateEnd: now,
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].title).toBe('Recent');
  });

  it('filters by search (matches title, description, source)', async () => {
    const { result } = renderHook(() => useTimeline());
    await act(async () => {});

    await act(async () => {
      await result.current.createEvent({ title: 'Malware Detected', source: 'edr' });
      await result.current.createEvent({ title: 'Login Event', description: 'Suspicious malware activity' });
      await result.current.createEvent({ title: 'Network Scan', source: 'malware-sandbox' });
      await result.current.createEvent({ title: 'Unrelated Event', source: 'firewall' });
    });

    const filtered = result.current.getFilteredEvents({ search: 'malware' });
    expect(filtered).toHaveLength(3);
    const titles = filtered.map((e) => e.title).sort();
    expect(titles).toEqual(['Login Event', 'Malware Detected', 'Network Scan']);
  });

  it('sorts ascending vs descending, starred first', async () => {
    const { result } = renderHook(() => useTimeline());
    await act(async () => {});

    const now = Date.now();
    let starId: string;
    await act(async () => {
      await result.current.createEvent({ title: 'Early', timestamp: now - 3000 });
      await result.current.createEvent({ title: 'Middle', timestamp: now - 2000 });
      const s = await result.current.createEvent({ title: 'Late', timestamp: now - 1000 });
      starId = s.id;
    });

    // Star the "Late" event
    await act(async () => {
      await result.current.toggleStar(starId!);
    });

    // Descending (default): starred first, then by timestamp desc
    const desc = result.current.getFilteredEvents({ sortDir: 'desc' });
    expect(desc[0].title).toBe('Late'); // starred, comes first
    expect(desc[1].title).toBe('Middle');
    expect(desc[2].title).toBe('Early');

    // Ascending: starred first, then by timestamp asc
    const asc = result.current.getFilteredEvents({ sortDir: 'asc' });
    expect(asc[0].title).toBe('Late'); // starred, comes first
    expect(asc[1].title).toBe('Early');
    expect(asc[2].title).toBe('Middle');
  });

  it('computes eventCounts correctly', async () => {
    const { result } = renderHook(() => useTimeline());
    await act(async () => {});

    let trashId: string;
    let archiveId: string;
    let starId: string;
    await act(async () => {
      const s = await result.current.createEvent({ title: 'Active Starred' });
      starId = s.id;
      await result.current.createEvent({ title: 'Active 2' });
      const t = await result.current.createEvent({ title: 'Trashed' });
      trashId = t.id;
      const a = await result.current.createEvent({ title: 'Archived' });
      archiveId = a.id;
    });

    await act(async () => {
      await result.current.toggleStar(starId!);
      await result.current.trashEvent(trashId!);
      await result.current.toggleArchiveEvent(archiveId!);
    });

    expect(result.current.eventCounts.total).toBe(2);
    expect(result.current.eventCounts.starred).toBe(1);
    expect(result.current.eventCounts.trashed).toBe(1);
    expect(result.current.eventCounts.archived).toBe(1);
  });

  it('auto-purges old trashed events on load', async () => {
    // Manually insert an event that was trashed 31 days ago
    const oldEvent = {
      id: 'old-trashed',
      timestamp: Date.now() - 60 * 86400000,
      title: 'Old Trash',
      eventType: 'other' as const,
      source: '',
      confidence: 'low' as const,
      linkedIOCIds: [],
      linkedNoteIds: [],
      linkedTaskIds: [],
      mitreAttackIds: [],
      assets: [],
      tags: [],
      starred: false,
      timelineId: '',
      trashed: true,
      trashedAt: Date.now() - 31 * 86400000,
      archived: false,
      createdAt: Date.now() - 60 * 86400000,
      updatedAt: Date.now() - 31 * 86400000,
    };
    await db.timelineEvents.add(oldEvent);

    const { result } = renderHook(() => useTimeline());
    await act(async () => {});

    // Old trashed event should have been purged
    expect(result.current.events.find((e) => e.id === 'old-trashed')).toBeUndefined();
    const stored = await db.timelineEvents.get('old-trashed');
    expect(stored).toBeUndefined();
  });
});
