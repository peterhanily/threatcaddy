/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { exportJSON, importJSON, mergeImportJSON, importInvestigationJSON, exportNotesMarkdown, sanitizeNote, sanitizeStandaloneIOC, sanitizeEvidenceItem, parseTimelineImport, exportEventsJSON, downloadFile } from '../lib/export';
import { db } from '../db';
import type { Note, TimelineEvent } from '../types';

beforeEach(async () => {
  await db.notes.clear();
  await db.tasks.clear();
  await db.folders.clear();
  await db.tags.clear();
  await db.timelines.clear();
  await db.timelineEvents.clear();
  await db.whiteboards.clear();
  await db.evidenceItems.clear();
  await db.standaloneIOCs.clear();
  await db.chatThreads.clear();
});

// ---------------------------------------------------------------------------
// sanitizeNote
// ---------------------------------------------------------------------------
describe('sanitizeNote', () => {
  it('returns null for null input', () => {
    expect(sanitizeNote(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(sanitizeNote(undefined)).toBeNull();
  });

  it('returns null for non-object input (string)', () => {
    expect(sanitizeNote('not an object')).toBeNull();
  });

  it('returns null for non-object input (number)', () => {
    expect(sanitizeNote(42)).toBeNull();
  });

  it('coerces non-string title to empty string', () => {
    const result = sanitizeNote({ id: 'n1', title: 12345, content: 'ok', tags: [], pinned: false, archived: false, trashed: false, createdAt: 1000, updatedAt: 2000 });
    expect(result).not.toBeNull();
    expect(result!.title).toBe('');
  });

  it('coerces non-string content to empty string', () => {
    const result = sanitizeNote({ id: 'n1', title: 'ok', content: { nested: true }, tags: [], pinned: false, archived: false, trashed: false, createdAt: 1000, updatedAt: 2000 });
    expect(result).not.toBeNull();
    expect(result!.content).toBe('');
  });

  it('coerces non-string id to empty string', () => {
    const result = sanitizeNote({ id: 999, title: 'x', content: 'x', tags: [], pinned: false, archived: false, trashed: false, createdAt: 1000, updatedAt: 2000 });
    expect(result).not.toBeNull();
    expect(result!.id).toBe('');
  });

  it('coerces non-boolean pinned/archived/trashed to false', () => {
    const result = sanitizeNote({ id: 'n1', title: 't', content: 'c', tags: [], pinned: 'yes', archived: 1, trashed: null, createdAt: 1000, updatedAt: 2000 });
    expect(result).not.toBeNull();
    expect(result!.pinned).toBe(false);
    expect(result!.archived).toBe(false);
    expect(result!.trashed).toBe(false);
  });

  it('filters non-strings from tags array via strArr', () => {
    const result = sanitizeNote({ id: 'n1', title: 't', content: 'c', tags: ['valid', 42, null, 'also-valid', true], pinned: false, archived: false, trashed: false, createdAt: 1000, updatedAt: 2000 });
    expect(result).not.toBeNull();
    expect(result!.tags).toEqual(['valid', 'also-valid']);
  });

  it('defaults tags to empty array when not an array', () => {
    const result = sanitizeNote({ id: 'n1', title: 't', content: 'c', tags: 'not-an-array', pinned: false, archived: false, trashed: false, createdAt: 1000, updatedAt: 2000 });
    expect(result).not.toBeNull();
    expect(result!.tags).toEqual([]);
  });

  it('preserves all optional fields when present', () => {
    const result = sanitizeNote({
      id: 'n1', title: 'T', content: 'C', tags: ['a'],
      pinned: true, archived: true, trashed: true,
      trashedAt: 5000, sourceUrl: 'https://example.com', sourceTitle: 'Example',
      color: '#ff0000', folderId: 'f1', clsLevel: 'TLP:RED',
      linkedNoteIds: ['n2'], linkedTaskIds: ['t1'], linkedTimelineEventIds: ['ev1'],
      createdAt: 1000, updatedAt: 2000,
    });
    expect(result).not.toBeNull();
    expect(result!.trashedAt).toBe(5000);
    expect(result!.sourceUrl).toBe('https://example.com');
    expect(result!.sourceTitle).toBe('Example');
    expect(result!.color).toBe('#ff0000');
    expect(result!.folderId).toBe('f1');
    expect(result!.clsLevel).toBe('TLP:RED');
    expect(result!.linkedNoteIds).toEqual(['n2']);
    expect(result!.linkedTaskIds).toEqual(['t1']);
    expect(result!.linkedTimelineEventIds).toEqual(['ev1']);
  });

  it('omits optional fields that are null/undefined', () => {
    const result = sanitizeNote({
      id: 'n1', title: 'T', content: 'C', tags: [],
      pinned: false, archived: false, trashed: false,
      createdAt: 1000, updatedAt: 2000,
    });
    expect(result).not.toBeNull();
    expect(result!.trashedAt).toBeUndefined();
    expect(result!.sourceUrl).toBeUndefined();
    expect(result!.sourceTitle).toBeUndefined();
    expect(result!.color).toBeUndefined();
    expect(result!.folderId).toBeUndefined();
    expect(result!.clsLevel).toBeUndefined();
    expect(result!.linkedNoteIds).toBeUndefined();
    expect(result!.linkedTaskIds).toBeUndefined();
    expect(result!.linkedTimelineEventIds).toBeUndefined();
  });

  it('sanitizes IOC analysis with valid entries', () => {
    const result = sanitizeNote({
      id: 'n1', title: 'T', content: 'C', tags: [], pinned: false, archived: false, trashed: false,
      createdAt: 1000, updatedAt: 2000,
      iocAnalysis: {
        extractedAt: 3000,
        iocs: [{
          id: 'ioc1', type: 'ipv4', value: '10.0.0.1', confidence: 'high',
          firstSeen: 1000, dismissed: false,
        }],
        analysisSummary: 'Found suspicious IP',
        lastPushedAt: 4000,
      },
    });
    expect(result).not.toBeNull();
    expect(result!.iocAnalysis).toBeDefined();
    expect(result!.iocAnalysis!.extractedAt).toBe(3000);
    expect(result!.iocAnalysis!.iocs).toHaveLength(1);
    expect(result!.iocAnalysis!.iocs[0].type).toBe('ipv4');
    expect(result!.iocAnalysis!.iocs[0].value).toBe('10.0.0.1');
    expect(result!.iocAnalysis!.analysisSummary).toBe('Found suspicious IP');
    expect(result!.iocAnalysis!.lastPushedAt).toBe(4000);
  });

  it('filters out IOC entries with invalid type', () => {
    const result = sanitizeNote({
      id: 'n1', title: 'T', content: 'C', tags: [], pinned: false, archived: false, trashed: false,
      createdAt: 1000, updatedAt: 2000,
      iocAnalysis: {
        extractedAt: 3000,
        iocs: [
          { id: 'ioc1', type: 'ipv4', value: '10.0.0.1', confidence: 'high', firstSeen: 1000, dismissed: false },
          { id: 'ioc2', type: 'banana', value: 'invalid', confidence: 'low', firstSeen: 1000, dismissed: false },
          { id: 'ioc3', type: 'domain', value: 'evil.com', confidence: 'medium', firstSeen: 1000, dismissed: false },
        ],
      },
    });
    expect(result).not.toBeNull();
    expect(result!.iocAnalysis!.iocs).toHaveLength(2);
    expect(result!.iocAnalysis!.iocs[0].id).toBe('ioc1');
    expect(result!.iocAnalysis!.iocs[1].id).toBe('ioc3');
  });

  it('defaults invalid IOC confidence to low', () => {
    const result = sanitizeNote({
      id: 'n1', title: 'T', content: 'C', tags: [], pinned: false, archived: false, trashed: false,
      createdAt: 1000, updatedAt: 2000,
      iocAnalysis: {
        extractedAt: 3000,
        iocs: [
          { id: 'ioc1', type: 'ipv4', value: '10.0.0.1', confidence: 'super-high', firstSeen: 1000, dismissed: false },
        ],
      },
    });
    expect(result).not.toBeNull();
    expect(result!.iocAnalysis!.iocs[0].confidence).toBe('low');
  });

  it('sanitizes IOC relationships within entries', () => {
    const result = sanitizeNote({
      id: 'n1', title: 'T', content: 'C', tags: [], pinned: false, archived: false, trashed: false,
      createdAt: 1000, updatedAt: 2000,
      iocAnalysis: {
        extractedAt: 3000,
        iocs: [{
          id: 'ioc1', type: 'domain', value: 'evil.com', confidence: 'high',
          firstSeen: 1000, dismissed: false,
          relationships: [
            { targetIOCId: 'ioc2', relationshipType: 'resolves-to' },
            null,
            'garbage',
            { targetIOCId: 123, relationshipType: 'invalid' },
            { targetIOCId: 'ioc3', relationshipType: 'communicates-with' },
          ],
        }],
      },
    });
    expect(result).not.toBeNull();
    const rels = result!.iocAnalysis!.iocs[0].relationships;
    expect(rels).toHaveLength(2);
    expect(rels![0]).toEqual({ targetIOCId: 'ioc2', relationshipType: 'resolves-to' });
    expect(rels![1]).toEqual({ targetIOCId: 'ioc3', relationshipType: 'communicates-with' });
  });

  it('returns undefined iocAnalysis when field is not an object', () => {
    const result = sanitizeNote({
      id: 'n1', title: 'T', content: 'C', tags: [], pinned: false, archived: false, trashed: false,
      createdAt: 1000, updatedAt: 2000,
      iocAnalysis: 'not-an-object',
    });
    expect(result).not.toBeNull();
    expect(result!.iocAnalysis).toBeUndefined();
  });

  it('filters invalid iocTypes', () => {
    const result = sanitizeNote({
      id: 'n1', title: 'T', content: 'C', tags: [], pinned: false, archived: false, trashed: false,
      createdAt: 1000, updatedAt: 2000,
      iocTypes: ['ipv4', 'banana', 'domain', 42],
    });
    expect(result).not.toBeNull();
    expect(result!.iocTypes).toEqual(['ipv4', 'domain']);
  });

  it('filters non-strings from linkedNoteIds', () => {
    const result = sanitizeNote({
      id: 'n1', title: 'T', content: 'C', tags: [], pinned: false, archived: false, trashed: false,
      createdAt: 1000, updatedAt: 2000,
      linkedNoteIds: ['n2', 42, null, 'n3'],
    });
    expect(result).not.toBeNull();
    expect(result!.linkedNoteIds).toEqual(['n2', 'n3']);
  });
});

// ---------------------------------------------------------------------------
// sanitizeStandaloneIOC
// ---------------------------------------------------------------------------
describe('sanitizeStandaloneIOC', () => {
  it('preserves enrichment and integration link fields', () => {
    const result = sanitizeStandaloneIOC({
      id: 'ioc-1',
      type: 'domain',
      value: 'evil.example',
      confidence: 'high',
      tags: ['source:integration'],
      linkedNoteIds: ['note-1'],
      linkedEvidenceIds: ['evidence-1'],
      enrichment: {
        virusTotal: { malicious: 2, harmless: 60 },
      },
      firstSeen: 1000,
      lastSeen: 2000,
      trashed: false,
      archived: false,
      createdAt: 1000,
      updatedAt: 2000,
    });

    expect(result).not.toBeNull();
    expect(result!.linkedNoteIds).toEqual(['note-1']);
    expect(result!.linkedEvidenceIds).toEqual(['evidence-1']);
    expect(result!.firstSeen).toBe(1000);
    expect(result!.lastSeen).toBe(2000);
    expect(result!.enrichment?.virusTotal).toHaveLength(1);
    expect(result!.enrichment?.virusTotal?.[0]).toMatchObject({
      malicious: 2,
      harmless: 60,
      ts: 2000,
      source: 'import',
    });
  });
});

// ---------------------------------------------------------------------------
// sanitizeEvidenceItem
// ---------------------------------------------------------------------------
describe('sanitizeEvidenceItem', () => {
  it('preserves image evidence metadata and bounded payloads', () => {
    const result = sanitizeEvidenceItem({
      id: 'ev1',
      title: 'Screenshot',
      fileName: 'weaponized-clipboard.png',
      fileType: 'image',
      mimeType: 'image/png',
      size: 1024,
      imageWidth: 1200,
      imageHeight: 800,
      imageAspectRatio: '3:2',
      imagePixelCount: 960000,
      imageData: 'aGVsbG8=',
      imageDataMimeType: 'image/png',
      content: '# Evidence: weaponized-clipboard.png',
      extractionStatus: 'metadata-only',
      importedAt: 1000,
      chunkIndex: 1,
      chunkCount: 1,
      tags: ['evidence', 'file:png'],
      trashed: false,
      archived: false,
      createdAt: 1000,
      updatedAt: 1000,
    });

    expect(result).not.toBeNull();
    expect(result!.fileType).toBe('image');
    expect(result!.imageWidth).toBe(1200);
    expect(result!.imageHeight).toBe(800);
    expect(result!.imageData).toBe('aGVsbG8=');
    expect(result!.imageDataMimeType).toBe('image/png');
  });

  it('drops image payloads with unsafe or unsupported MIME types', () => {
    const result = sanitizeEvidenceItem({
      id: 'ev1',
      title: 'Unsafe SVG',
      fileName: 'unsafe.svg',
      fileType: 'image',
      imageData: 'aGVsbG8=',
      imageDataMimeType: 'image/svg+xml',
      size: 10,
      content: '# Evidence: unsafe.svg',
      extractionStatus: 'metadata-only',
      importedAt: 1000,
      chunkIndex: 1,
      chunkCount: 1,
      tags: [],
      trashed: false,
      archived: false,
      createdAt: 1000,
      updatedAt: 1000,
    });

    expect(result).not.toBeNull();
    expect(result!.imageData).toBeUndefined();
    expect(result!.imageDataMimeType).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// exportJSON / importJSON roundtrip
// ---------------------------------------------------------------------------
describe('exportJSON / importJSON roundtrip', () => {
  it('exports and re-imports data correctly', async () => {
    // Seed data
    await db.notes.add({
      id: 'n1', title: 'Test Note', content: '# Hello', tags: ['test'],
      pinned: false, archived: false, trashed: false, createdAt: 1000, updatedAt: 2000,
    });
    await db.tasks.add({
      id: 't1', title: 'Test Task', completed: false, priority: 'high',
      tags: [], status: 'todo', order: 1, trashed: false, archived: false, createdAt: 1000, updatedAt: 2000,
    });
    await db.folders.add({ id: 'f1', name: 'Work', order: 1, createdAt: 1000 });
    await db.tags.add({ id: 'tg1', name: 'test', color: '#ff0000' });

    // Export
    const json = await exportJSON();
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(1);
    expect(parsed.notes).toHaveLength(1);
    expect(parsed.tasks).toHaveLength(1);
    expect(parsed.folders).toHaveLength(1);
    expect(parsed.tags).toHaveLength(1);

    // Clear and reimport
    await db.notes.clear();
    await db.tasks.clear();
    await db.folders.clear();
    await db.tags.clear();

    const counts = await importJSON(json);
    expect(counts).toEqual({ notes: 1, tasks: 1, folders: 1, tags: 1, timelineEvents: 0, timelines: 0, whiteboards: 0, standaloneIOCs: 0, evidenceItems: 0, chatThreads: 0, noteTemplates: 0, playbookTemplates: 0, agentActions: 0, agentProfiles: 0, agentDeployments: 0, agentMeetings: 0, integrationTemplates: 0, installedIntegrations: 0, customSlashCommands: 0 });

    // Verify data integrity
    const notes = await db.notes.toArray();
    expect(notes[0].title).toBe('Test Note');
    expect(notes[0].content).toBe('# Hello');
    expect(notes[0].tags).toEqual(['test']);

    const tasks = await db.tasks.toArray();
    expect(tasks[0].title).toBe('Test Task');
    expect(tasks[0].priority).toBe('high');
  });

  it('preserves all v9-v11 fields through export->import round-trip', async () => {
    // Seed data with all new fields from DB v9-v11
    await db.notes.add({
      id: 'n1', title: 'Classified Note', content: 'secret', tags: ['intel'],
      pinned: false, archived: false, trashed: false, createdAt: 1000, updatedAt: 2000,
      clsLevel: 'TLP:AMBER',
      linkedNoteIds: ['n2'],
      linkedTaskIds: ['t1'],
      linkedTimelineEventIds: ['ev1'],
    });
    await db.tasks.add({
      id: 't1', title: 'Classified Task', completed: false, priority: 'high',
      tags: [], status: 'todo', order: 1, trashed: false, archived: false, createdAt: 1000, updatedAt: 2000,
      clsLevel: 'TLP:RED',
      linkedNoteIds: ['n1'],
      linkedTaskIds: [],
      linkedTimelineEventIds: ['ev1'],
    });
    await db.folders.add({
      id: 'f1', name: 'Case Alpha', order: 1, createdAt: 1000,
      description: 'Major incident', status: 'active',
      clsLevel: 'TLP:GREEN', papLevel: 'PAP:WHITE',
      tags: ['case'], timelineId: 'tl1',
    });
    await db.tags.add({ id: 'tg1', name: 'intel', color: '#ff0000' });
    await db.timelines.add({ id: 'tl1', name: 'Alpha TL', order: 0, createdAt: 1000, updatedAt: 1000 });
    await db.timelineEvents.add({
      id: 'ev1', timestamp: 5000, title: 'Event 1', eventType: 'other',
      source: 'test', confidence: 'high', linkedIOCIds: [], linkedNoteIds: ['n1'],
      linkedTaskIds: ['t1'], mitreAttackIds: [], assets: [], tags: [], starred: false,
      trashed: false, archived: false,
      timelineId: 'tl1', createdAt: 1000, updatedAt: 2000,
      clsLevel: 'TLP:AMBER',
      iocAnalysis: {
        extractedAt: 3000,
        iocs: [{
          id: 'ioc1', type: 'ipv4', value: '10.0.0.1', confidence: 'high',
          firstSeen: 1000, dismissed: false,
          iocSubtype: 'ipv4', iocStatus: 'active', clsLevel: 'TLP:RED',
          relationships: [{ targetIOCId: 'ioc2', relationshipType: 'communicates-with' }],
        }],
        analysisSummary: 'Suspicious IP',
        lastPushedAt: 4000,
      },
      iocTypes: ['ipv4'],
    });

    // Export
    const json = await exportJSON();

    // Clear everything
    await Promise.all([
      db.notes.clear(), db.tasks.clear(), db.folders.clear(),
      db.tags.clear(), db.timelines.clear(), db.timelineEvents.clear(),
      db.whiteboards.clear(),
    ]);

    // Re-import through sanitizers
    const counts = await importJSON(json);
    expect(counts).toEqual({ notes: 1, tasks: 1, folders: 1, tags: 1, timelineEvents: 1, timelines: 1, whiteboards: 0, standaloneIOCs: 0, evidenceItems: 0, chatThreads: 0, noteTemplates: 0, playbookTemplates: 0, agentActions: 0, agentProfiles: 0, agentDeployments: 0, agentMeetings: 0, integrationTemplates: 0, installedIntegrations: 0, customSlashCommands: 0 });

    // Verify Note fields
    const notes = await db.notes.toArray();
    expect(notes[0].clsLevel).toBe('TLP:AMBER');
    expect(notes[0].linkedNoteIds).toEqual(['n2']);
    expect(notes[0].linkedTaskIds).toEqual(['t1']);
    expect(notes[0].linkedTimelineEventIds).toEqual(['ev1']);

    // Verify Task fields
    const tasks = await db.tasks.toArray();
    expect(tasks[0].clsLevel).toBe('TLP:RED');
    expect(tasks[0].linkedNoteIds).toEqual(['n1']);
    expect(tasks[0].linkedTimelineEventIds).toEqual(['ev1']);

    // Verify Folder/Investigation fields
    const folders = await db.folders.toArray();
    expect(folders[0].description).toBe('Major incident');
    expect(folders[0].status).toBe('active');
    expect(folders[0].clsLevel).toBe('TLP:GREEN');
    expect(folders[0].papLevel).toBe('PAP:WHITE');
    expect(folders[0].tags).toEqual(['case']);
    expect(folders[0].timelineId).toBe('tl1');

    // Verify TimelineEvent fields
    const events = await db.timelineEvents.toArray();
    expect(events[0].clsLevel).toBe('TLP:AMBER');
    expect(events[0].iocTypes).toEqual(['ipv4']);
    expect(events[0].iocAnalysis).toBeDefined();
    expect(events[0].iocAnalysis?.lastPushedAt).toBe(4000);
    expect(events[0].iocAnalysis?.analysisSummary).toBe('Suspicious IP');

    // Verify IOCEntry fields within iocAnalysis
    const ioc = events[0].iocAnalysis?.iocs[0];
    expect(ioc).toBeDefined();
    expect(ioc?.iocSubtype).toBe('ipv4');
    expect(ioc?.iocStatus).toBe('active');
    expect(ioc?.clsLevel).toBe('TLP:RED');
    expect(ioc?.relationships).toEqual([{ targetIOCId: 'ioc2', relationshipType: 'communicates-with' }]);
  });

  it('rejects invalid import data', async () => {
    await expect(importJSON('{}')).rejects.toThrow('Invalid backup file format');
    await expect(importJSON('not json')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// importJSON edge cases
// ---------------------------------------------------------------------------
describe('importJSON edge cases', () => {
  it('rejects oversized input (>50MB)', async () => {
    const huge = 'x'.repeat(50 * 1024 * 1024 + 1);
    await expect(importJSON(huge)).rejects.toThrow('Backup file too large');
  });

  it('rejects invalid JSON', async () => {
    await expect(importJSON('{{{{not valid json')).rejects.toThrow();
  });

  it('rejects too many notes (>100k)', async () => {
    const data = {
      version: 1,
      notes: new Array(100_001).fill({ id: 'n', title: 't', content: '', tags: [], pinned: false, archived: false, trashed: false, createdAt: 0, updatedAt: 0 }),
      tasks: [],
      folders: [],
      tags: [],
    };
    await expect(importJSON(JSON.stringify(data))).rejects.toThrow('Too many items');
  });

  it('rejects too many tasks (>100k)', async () => {
    const data = {
      version: 1,
      notes: [],
      tasks: new Array(100_001).fill({ id: 't', title: 't', completed: false, priority: 'none', tags: [], status: 'todo', order: 0, createdAt: 0, updatedAt: 0 }),
      folders: [],
      tags: [],
    };
    await expect(importJSON(JSON.stringify(data))).rejects.toThrow('Too many items');
  });

  it('creates default timeline when events exist but no timelines array', async () => {
    const data = {
      version: 1,
      notes: [],
      tasks: [],
      folders: [],
      tags: [],
      timelineEvents: [{
        id: 'ev1', timestamp: 5000, title: 'Orphan Event', eventType: 'other',
        source: 'test', confidence: 'low', linkedIOCIds: [], linkedNoteIds: [],
        linkedTaskIds: [], mitreAttackIds: [], assets: [], tags: [], starred: false,
        timelineId: '', createdAt: 1000, updatedAt: 2000,
      }],
      timelines: [],
    };
    const counts = await importJSON(JSON.stringify(data));
    expect(counts.timelineEvents).toBe(1);
    expect(counts.timelines).toBe(1);

    const timelines = await db.timelines.toArray();
    expect(timelines).toHaveLength(1);
    expect(timelines[0].name).toBe('Default');

    // The orphan event should have been assigned to the new default timeline
    const events = await db.timelineEvents.toArray();
    expect(events[0].timelineId).toBe(timelines[0].id);
  });

  it('handles missing optional arrays (timelineEvents, timelines, whiteboards)', async () => {
    const data = {
      version: 1,
      notes: [{ id: 'n1', title: 'Note', content: 'hi', tags: [], pinned: false, archived: false, trashed: false, createdAt: 1000, updatedAt: 2000 }],
      tasks: [],
      folders: [],
      tags: [],
      // timelineEvents, timelines, and whiteboards intentionally omitted
    };
    const counts = await importJSON(JSON.stringify(data));
    expect(counts.notes).toBe(1);
    expect(counts.timelineEvents).toBe(0);
    expect(counts.timelines).toBe(0);
    expect(counts.whiteboards).toBe(0);
  });

  it('refuses a backup containing an empty identity without replacing existing notes', async () => {
    await db.notes.add({ id: 'retained', title: 'Retained', content: 'Original', tags: [], pinned: false, archived: false, trashed: false, createdAt: 1, updatedAt: 1 });
    const data = {
      version: 1,
      notes: [
        { id: '', title: 'No ID', content: 'x', tags: [], pinned: false, archived: false, trashed: false, createdAt: 1000, updatedAt: 2000 },
        { id: 'n1', title: 'Good', content: 'y', tags: [], pinned: false, archived: false, trashed: false, createdAt: 1000, updatedAt: 2000 },
      ],
      tasks: [],
      folders: [],
      tags: [],
    };
    await expect(importJSON(JSON.stringify(data))).rejects.toThrow('notes.id');
    const notes = await db.notes.toArray();
    expect(notes.map(note => note.id)).toEqual(['retained']);
  });

  it('does not create default timeline when events already have a timeline', async () => {
    const data = {
      version: 1,
      notes: [],
      tasks: [],
      folders: [],
      tags: [],
      timelineEvents: [{
        id: 'ev1', timestamp: 5000, title: 'Event', eventType: 'other',
        source: 'test', confidence: 'low', linkedIOCIds: [], linkedNoteIds: [],
        linkedTaskIds: [], mitreAttackIds: [], assets: [], tags: [], starred: false,
        timelineId: 'tl1', createdAt: 1000, updatedAt: 2000,
      }],
      timelines: [{ id: 'tl1', name: 'Existing TL', order: 0, createdAt: 1000, updatedAt: 1000 }],
    };
    const counts = await importJSON(JSON.stringify(data));
    expect(counts.timelines).toBe(1);
    const timelines = await db.timelines.toArray();
    expect(timelines[0].name).toBe('Existing TL');
  });
});

// ---------------------------------------------------------------------------
// mergeImportJSON
// ---------------------------------------------------------------------------
describe('mergeImportJSON', () => {
  it('preserves current investigations while merging backup notes into their original investigations', async () => {
    await db.folders.add({
      id: 'teampcp',
      name: 'TeamPCP',
      order: 0,
      createdAt: 1000,
      updatedAt: 5000,
    });
    await db.notes.add({
      id: 'team-note',
      title: 'TeamPCP - Clean Summary and Working Timeline',
      content: 'current CaddyAI work',
      folderId: 'teampcp',
      tags: [],
      pinned: false,
      archived: false,
      trashed: false,
      createdAt: 1000,
      updatedAt: 5000,
    });

    const backup = {
      version: 1,
      exportedAt: 1000,
      folders: [
        { id: 'old-case', name: 'FAIR-TRADE DUMPSTER-FIRE', order: 1, createdAt: 1000, updatedAt: 1000 },
      ],
      notes: [
        {
          id: 'old-note-1',
          title: 'Imported finding',
          content: 'older investigation note',
          folderId: 'old-case',
          tags: [],
          pinned: false,
          archived: false,
          trashed: false,
          createdAt: 1000,
          updatedAt: 1000,
        },
        {
          id: 'old-note-2',
          title: 'Imported timeline',
          content: 'older timeline note',
          folderId: 'old-case',
          tags: [],
          pinned: false,
          archived: false,
          trashed: false,
          createdAt: 1000,
          updatedAt: 1000,
        },
      ],
      tasks: [],
      tags: [],
    };

    const result = await mergeImportJSON(JSON.stringify(backup));

    expect(result.tables.notes).toMatchObject({ incoming: 2, added: 2, updated: 0, skipped: 0 });
    expect(result.tables.folders).toMatchObject({ incoming: 1, added: 1, updated: 0, skipped: 0 });
    expect(result.noteInvestigations).toEqual([
      { folderId: 'old-case', folderName: 'FAIR-TRADE DUMPSTER-FIRE', notes: 2, activeNotes: 2 },
    ]);

    await expect(db.notes.get('team-note')).resolves.toMatchObject({
      title: 'TeamPCP - Clean Summary and Working Timeline',
      content: 'current CaddyAI work',
      folderId: 'teampcp',
    });
    const oldNotes = await db.notes.where('folderId').equals('old-case').toArray();
    expect(oldNotes.map((note) => note.title).sort()).toEqual(['Imported finding', 'Imported timeline']);
  });

  it('reports skipped backup notes when local copies are already newer', async () => {
    await db.folders.add({ id: 'case-1', name: 'Existing Case', order: 0, createdAt: 1000, updatedAt: 5000 });
    await db.notes.add({
      id: 'n1',
      title: 'Local newer note',
      content: 'newer local content',
      folderId: 'case-1',
      tags: [],
      pinned: false,
      archived: false,
      trashed: false,
      createdAt: 1000,
      updatedAt: 5000,
    });

    const backup = {
      version: 1,
      exportedAt: 1000,
      folders: [{ id: 'case-1', name: 'Existing Case', order: 0, createdAt: 1000, updatedAt: 1000 }],
      notes: [{
        id: 'n1',
        title: 'Backup older note',
        content: 'older backup content',
        folderId: 'case-1',
        tags: [],
        pinned: false,
        archived: false,
        trashed: false,
        createdAt: 1000,
        updatedAt: 1000,
      }],
      tasks: [],
      tags: [],
    };

    const result = await mergeImportJSON(JSON.stringify(backup));

    expect(result.tables.notes).toMatchObject({ incoming: 1, added: 0, updated: 0, skipped: 1 });
    await expect(db.notes.get('n1')).resolves.toMatchObject({
      title: 'Local newer note',
      content: 'newer local content',
    });
  });

  it('treats omitted optional folders as empty during merge import', async () => {
    const result = await mergeImportJSON(JSON.stringify({
      version: 1,
      exportedAt: 1000,
      notes: [],
      tasks: [],
      tags: [],
    }));

    expect(result.tables.folders).toMatchObject({ incoming: 0, added: 0, updated: 0, skipped: 0 });
  });
});

// ---------------------------------------------------------------------------
// importInvestigationJSON
// ---------------------------------------------------------------------------
describe('importInvestigationJSON', () => {
  it('collapses mixed first-class and legacy evidence and remaps linked IOCs once', async () => {
    const content = [
      '# Evidence: weaponized-clipboard.txt',
      '',
      '**Imported:** 2026-05-21T00:00:00.000Z',
      '**File type:** TEXT',
      '**Extraction:** extracted',
      '',
      '## Extracted Text',
      '',
      'evil.example was observed in the source material.',
    ].join('\n');

    const result = await importInvestigationJSON(JSON.stringify({
      version: 1,
      exportedAt: 1000,
      folders: [{ id: 'old-case', name: 'Old Case', order: 0, createdAt: 1000, updatedAt: 1000 }],
      notes: [{
        id: 'legacy-note',
        title: 'Evidence - weaponized-clipboard.txt',
        content,
        folderId: 'old-case',
        tags: ['evidence', 'source:file', 'file:txt', 'extraction:extracted'],
        pinned: false,
        archived: false,
        trashed: false,
        createdAt: 1000,
        updatedAt: 1000,
      }],
      tasks: [],
      tags: [],
      standaloneIOCs: [{
        id: 'ioc-old',
        type: 'domain',
        value: 'evil.example',
        confidence: 'high',
        folderId: 'old-case',
        tags: [],
        trashed: false,
        archived: false,
        createdAt: 1000,
        updatedAt: 1000,
      }],
      evidenceItems: [{
        id: 'evidence-old',
        title: 'weaponized-clipboard.txt',
        folderId: 'old-case',
        fileName: 'weaponized-clipboard.txt',
        fileType: 'text',
        size: 123,
        content,
        extractionStatus: 'extracted',
        importedAt: 1000,
        chunkIndex: 1,
        chunkCount: 1,
        tags: ['evidence', 'source:file', 'file:txt', 'extraction:extracted'],
        linkedIOCIds: ['ioc-old'],
        trashed: false,
        archived: false,
        createdAt: 1000,
        updatedAt: 1000,
      }],
    }));

    expect(result.evidenceItems).toBe(1);
    expect(result.notes).toBe(0);
    const evidenceItems = await db.evidenceItems.toArray();
    const iocs = await db.standaloneIOCs.toArray();
    expect(evidenceItems).toHaveLength(1);
    expect(iocs).toHaveLength(1);
    expect(evidenceItems[0].folderId).toBe(result.folderId);
    expect(evidenceItems[0].linkedIOCIds).toEqual([iocs[0].id]);
    expect(evidenceItems[0].linkedIOCIds).not.toContain('ioc-old');
  });
});

// ---------------------------------------------------------------------------
// parseTimelineImport
// ---------------------------------------------------------------------------
describe('parseTimelineImport', () => {
  const makeValidExport = (overrides: Record<string, unknown> = {}) => JSON.stringify({
    format: 'threatcaddy-timeline',
    version: 1,
    exportedAt: Date.now(),
    timeline: { name: 'Test Timeline', description: 'Desc', color: '#ff0000' },
    events: [{
      id: 'ev1', timestamp: 5000, title: 'Event 1', eventType: 'other',
      source: 'test', confidence: 'high', linkedIOCIds: [], linkedNoteIds: [],
      linkedTaskIds: [], mitreAttackIds: [], assets: [], tags: [], starred: false,
      timelineId: 'tl1', createdAt: 1000, updatedAt: 2000,
    }],
    ...overrides,
  });

  it('parses valid threatcaddy-timeline format correctly', () => {
    const result = parseTimelineImport(makeValidExport());
    expect(result.format).toBe('threatcaddy-timeline');
    expect(result.version).toBe(1);
    expect(result.timeline.name).toBe('Test Timeline');
    expect(result.timeline.description).toBe('Desc');
    expect(result.timeline.color).toBe('#ff0000');
    expect(result.events).toHaveLength(1);
    expect(result.events[0].id).toBe('ev1');
    expect(result.events[0].title).toBe('Event 1');
  });

  it('accepts browsernotes-timeline format for backwards compatibility', () => {
    const json = makeValidExport({ format: 'browsernotes-timeline' });
    const result = parseTimelineImport(json);
    // Output format is always normalized to threatcaddy-timeline
    expect(result.format).toBe('threatcaddy-timeline');
    expect(result.events).toHaveLength(1);
  });

  it('rejects invalid format string', () => {
    const json = JSON.stringify({ format: 'unknown-format', version: 1, events: [] });
    expect(() => parseTimelineImport(json)).toThrow('Invalid timeline export file');
  });

  it('rejects non-object input', () => {
    expect(() => parseTimelineImport('"just a string"')).toThrow('Invalid timeline export file');
  });

  it('rejects oversized input', () => {
    const huge = 'x'.repeat(50 * 1024 * 1024 + 1);
    expect(() => parseTimelineImport(huge)).toThrow('File too large');
  });

  it('sanitizes events through sanitizeTimelineEvent', () => {
    const json = JSON.stringify({
      format: 'threatcaddy-timeline',
      version: 1,
      exportedAt: Date.now(),
      timeline: { name: 'TL' },
      events: [
        {
          id: 'ev1', timestamp: 5000, title: 'Good', eventType: 'other',
          source: 's', confidence: 'high', linkedIOCIds: [], linkedNoteIds: [],
          linkedTaskIds: [], mitreAttackIds: [], assets: [], tags: [], starred: false,
          timelineId: 'tl1', createdAt: 1000, updatedAt: 2000,
        },
        // Non-object entry should be filtered out
        null,
        'garbage',
        // Entry without an id should be filtered out after sanitization
        {
          id: '', timestamp: 5000, title: 'No ID', eventType: 'other',
          source: 's', confidence: 'low', linkedIOCIds: [], linkedNoteIds: [],
          linkedTaskIds: [], mitreAttackIds: [], assets: [], tags: [], starred: false,
          timelineId: 'tl1', createdAt: 1000, updatedAt: 2000,
        },
      ],
    });
    const result = parseTimelineImport(json);
    // Only 'ev1' should survive; null/string are filtered by sanitizeTimelineEvent returning null,
    // and the empty-id entry is filtered by the !!e.id check
    expect(result.events).toHaveLength(1);
    expect(result.events[0].id).toBe('ev1');
  });

  it('sets default timeline name when missing', () => {
    const json = JSON.stringify({
      format: 'threatcaddy-timeline',
      version: 1,
      exportedAt: Date.now(),
      timeline: {},
      events: [],
    });
    const result = parseTimelineImport(json);
    expect(result.timeline.name).toBe('Imported Timeline');
  });

  it('defaults timeline name when timeline object is absent', () => {
    const json = JSON.stringify({
      format: 'threatcaddy-timeline',
      version: 1,
      exportedAt: Date.now(),
      events: [],
    });
    const result = parseTimelineImport(json);
    expect(result.timeline.name).toBe('Imported Timeline');
  });

  it('handles events array missing from input', () => {
    const json = JSON.stringify({
      format: 'threatcaddy-timeline',
      version: 1,
      exportedAt: Date.now(),
      timeline: { name: 'Empty' },
    });
    const result = parseTimelineImport(json);
    expect(result.events).toEqual([]);
  });

  it('sanitizes timeline event eventType to other when invalid', () => {
    const json = JSON.stringify({
      format: 'threatcaddy-timeline',
      version: 1,
      exportedAt: Date.now(),
      timeline: { name: 'TL' },
      events: [{
        id: 'ev1', timestamp: 5000, title: 'E', eventType: 'not-a-real-type',
        source: 's', confidence: 'low', linkedIOCIds: [], linkedNoteIds: [],
        linkedTaskIds: [], mitreAttackIds: [], assets: [], tags: [], starred: false,
        timelineId: 'tl1', createdAt: 1000, updatedAt: 2000,
      }],
    });
    const result = parseTimelineImport(json);
    expect(result.events[0].eventType).toBe('other');
  });

  it('sanitizes timeline event confidence to low when invalid', () => {
    const json = JSON.stringify({
      format: 'threatcaddy-timeline',
      version: 1,
      exportedAt: Date.now(),
      timeline: { name: 'TL' },
      events: [{
        id: 'ev1', timestamp: 5000, title: 'E', eventType: 'other',
        source: 's', confidence: 'super-confident', linkedIOCIds: [], linkedNoteIds: [],
        linkedTaskIds: [], mitreAttackIds: [], assets: [], tags: [], starred: false,
        timelineId: 'tl1', createdAt: 1000, updatedAt: 2000,
      }],
    });
    const result = parseTimelineImport(json);
    expect(result.events[0].confidence).toBe('low');
  });
});

// ---------------------------------------------------------------------------
// exportEventsJSON
// ---------------------------------------------------------------------------
describe('exportEventsJSON', () => {
  const sampleEvent: TimelineEvent = {
    id: 'ev1', timestamp: 5000, title: 'Event 1', eventType: 'other',
    source: 'test', confidence: 'high', linkedIOCIds: [], linkedNoteIds: [],
    linkedTaskIds: [], mitreAttackIds: [], assets: [], tags: [], starred: false,
    trashed: false, archived: false,
    timelineId: 'tl1', createdAt: 1000, updatedAt: 2000,
  };

  it('produces correct format structure', () => {
    const json = exportEventsJSON([sampleEvent], { name: 'My TL', description: 'desc', color: '#aaa' });
    const parsed = JSON.parse(json);
    expect(parsed.format).toBe('threatcaddy-timeline');
    expect(parsed.version).toBe(1);
    expect(typeof parsed.exportedAt).toBe('number');
    expect(parsed.timeline.name).toBe('My TL');
    expect(parsed.timeline.description).toBe('desc');
    expect(parsed.timeline.color).toBe('#aaa');
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0].id).toBe('ev1');
  });

  it('uses default name "All Events" when no meta provided', () => {
    const json = exportEventsJSON([sampleEvent]);
    const parsed = JSON.parse(json);
    expect(parsed.timeline.name).toBe('All Events');
    expect(parsed.timeline.description).toBeUndefined();
    expect(parsed.timeline.color).toBeUndefined();
  });

  it('uses provided meta fields', () => {
    const json = exportEventsJSON([], { name: 'Custom', description: 'My description', color: '#123456' });
    const parsed = JSON.parse(json);
    expect(parsed.timeline.name).toBe('Custom');
    expect(parsed.timeline.description).toBe('My description');
    expect(parsed.timeline.color).toBe('#123456');
    expect(parsed.events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// exportNotesMarkdown
// ---------------------------------------------------------------------------
describe('exportNotesMarkdown', () => {
  it('formats notes as markdown with metadata', () => {
    const notes: Note[] = [{
      id: '1', title: 'My Note', content: 'Hello world',
      tags: ['tag1', 'tag2'], pinned: false, archived: false, trashed: false,
      createdAt: new Date('2024-01-15').getTime(),
      updatedAt: new Date('2024-01-16').getTime(),
    }];

    const md = exportNotesMarkdown(notes);
    expect(md).toContain('# My Note');
    expect(md).toContain('Tags: tag1, tag2');
    expect(md).toContain('Hello world');
    expect(md).toContain('Created:');
  });

  it('handles multiple notes with separators', () => {
    const notes: Note[] = [
      { id: '1', title: 'A', content: 'a', tags: [], pinned: false, archived: false, trashed: false, createdAt: 1000, updatedAt: 1000 },
      { id: '2', title: 'B', content: 'b', tags: [], pinned: false, archived: false, trashed: false, createdAt: 1000, updatedAt: 1000 },
    ];

    const md = exportNotesMarkdown(notes);
    expect(md).toContain('# A');
    expect(md).toContain('# B');
    expect(md).toContain('---');
  });

  it('omits Tags line when note has no tags', () => {
    const notes: Note[] = [{
      id: '1', title: 'No Tags Note', content: 'content here',
      tags: [], pinned: false, archived: false, trashed: false,
      createdAt: 1000, updatedAt: 2000,
    }];

    const md = exportNotesMarkdown(notes);
    expect(md).toContain('# No Tags Note');
    expect(md).not.toContain('Tags:');
    expect(md).toContain('Created:');
    expect(md).toContain('content here');
  });

  it('returns empty string for empty notes array', () => {
    const md = exportNotesMarkdown([]);
    expect(md).toBe('');
  });
});

// ---------------------------------------------------------------------------
// downloadFile
// ---------------------------------------------------------------------------
describe('downloadFile', () => {
  it('creates a blob, triggers download, and revokes the object URL', () => {
    const mockClick = vi.fn();
    const mockAnchor = {
      href: '',
      download: '',
      click: mockClick,
    } as unknown as HTMLAnchorElement;

    const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor as any);
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    downloadFile('file content', 'test.json', 'application/json');

    // Verify Blob was created and passed to createObjectURL
    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    const blobArg = createObjectURLSpy.mock.calls[0][0];
    expect(blobArg).toBeInstanceOf(Blob);

    // Verify anchor was configured correctly
    expect(mockAnchor.href).toBe('blob:mock-url');
    expect(mockAnchor.download).toBe('test.json');
    expect(mockClick).toHaveBeenCalledTimes(1);

    // Verify cleanup
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url');

    createElementSpy.mockRestore();
    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
  });
});
