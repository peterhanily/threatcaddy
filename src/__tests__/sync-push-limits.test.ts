import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MAX_SYNC_REQUEST_NODES, outgoingRefusal, syncDataNodes } from '../lib/sync-push-limits';

const note = { id: 'n1', title: 'Note', content: 'body', folderId: 'f1', tags: [], pinned: false, archived: false, trashed: false, createdAt: 1, updatedAt: 1 };
/** An object nested `levels` deep below the field. */
const nested = (levels: number): unknown => levels === 0 ? 'leaf' : { next: nested(levels - 1) };

describe('client copy of the server write limits', () => {
  it('accepts an ordinary row', () => {
    expect(outgoingRefusal('notes', 'n1', note)).toBeNull();
    expect(outgoingRefusal('notes', 'n1', undefined)).toBeNull();
  });

  it.each([
    ['a string over 500,000 characters', { content: 'x'.repeat(500_001) }],
    ['an object nested more than five levels below a field', { iocAnalysis: nested(7) }],
    ['an array over 5,000 items', { tags: Array(5001).fill('t') }],
    ['an object with over 200 fields', { iocAnalysis: Object.fromEntries(Array.from({ length: 201 }, (_, index) => [`k${index}`, 1])) }],
    ['an unparseable timestamp column', { trashedAt: 'not a date' }],
    ['an out-of-range timestamp column', { trashedAt: 1e300 }],
  ])('holds back %s', (_label, fields) => {
    expect(outgoingRefusal('notes', 'n1', { ...note, ...fields })).toBe('limits');
  });

  it('ignores server-managed fields and values JSON sends as null', () => {
    expect(outgoingRefusal('notes', 'n1', { ...note, createdBy: 'x'.repeat(600_000), trashedAt: Number.NaN })).toBeNull();
    expect(outgoingRefusal('notes', 'n1', { ...note, iocAnalysis: nested(6) })).toBeNull();
  });

  it('checks inline assets by bytes and encoding', () => {
    const board = { id: 'w1', name: 'Board', folderId: 'f1', elements: '[]', tags: [] };
    expect(outgoingRefusal('whiteboards', 'w1', { ...board, files: JSON.stringify({ a: 'x'.repeat(600_000) }) })).toBeNull();
    expect(outgoingRefusal('whiteboards', 'w1', { ...board, files: JSON.stringify({ a: 'é'.repeat(4_200_000) }) })).toBe('limits');
    const evidence = { id: 'e1', folderId: 'f1', title: 'Shot', fileName: 'shot.png', fileType: 'image', importedAt: 1, imageDataMimeType: 'image/png' };
    expect(outgoingRefusal('evidenceItems', 'e1', { ...evidence, imageData: 'iVBORw0KGgo=' })).toBeNull();
    expect(outgoingRefusal('evidenceItems', 'e1', { ...evidence, imageData: 'not base64!' })).toBe('limits');
  });

  it('holds back exactly the evidence preview types this client shows but the server refuses', () => {
    const list = (path: string, name: string) => [...(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..', path), 'utf8')
      .match(new RegExp(`${name} = new Set\\(\\[([^\\]]*)\\]\\)`))?.[1] ?? '').matchAll(/'([^']+)'/g)].map(match => match[1]);
    const server = list('server/src/services/sync-service.ts', 'EVIDENCE_RASTER_MIME_TYPES');
    const client = list('src/lib/export.ts', 'VALID_RASTER_IMAGE_MIME_TYPES');
    expect(server).toContain('image/png');
    expect(client).toEqual(expect.arrayContaining(['image/bmp', 'image/avif']));
    const shot = { id: 'e1', folderId: 'f1', title: 'Shot', fileName: 'shot', fileType: 'image', importedAt: 1, imageData: 'Qk0=' };
    for (const type of client) {
      expect(outgoingRefusal('evidenceItems', 'e1', { ...shot, imageDataMimeType: type })).toBe(server.includes(type) ? null : 'previewType');
    }
    expect(outgoingRefusal('evidenceItems', 'e1', { ...shot, imageDataMimeType: ' IMAGE/PNG ' })).toBeNull();
    expect(outgoingRefusal('evidenceItems', 'e1', { ...shot, imageData: undefined })).toBeNull();
  });

  it('holds back rows other clients cannot read', () => {
    expect(outgoingRefusal('standaloneIOCs', 'i1', { id: 'i1', type: 'ip', value: '203.0.113.7', folderId: 'f1', tags: [] })).toBe('unreadable');
    expect(outgoingRefusal('whiteboards', 'w1', { id: 'w1', name: 'Board', folderId: 'f1', elements: '{}', tags: [] })).toBe('unreadable');
    // The entity id is authoritative; a row without its own id is still readable.
    expect(outgoingRefusal('notes', 'n1', { ...note, id: undefined })).toBeNull();
  });

  it('counts the values the server structure budget visits', () => {
    expect(syncDataNodes(undefined)).toBe(0);
    expect(syncDataNodes({ a: [1, 2], b: null })).toBe(5);
    expect(syncDataNodes({ ['x'.repeat(129)]: 1 })).toBe(Infinity);
    expect(syncDataNodes({ a: nested(8) })).toBe(Infinity);
    expect(syncDataNodes({ items: Array(4000).fill(0) })).toBeLessThan(MAX_SYNC_REQUEST_NODES);
  });
});
