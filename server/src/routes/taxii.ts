/** Read-only current-state TAXII 2.1 projection; no write/manifest/history API. */
import { Hono } from 'hono';
import { and, asc, eq, gt, gte, inArray, isNull, or, sql, getTableColumns } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { db } from '../db/index.js';
import { folders, standaloneIOCs, investigationMembers } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { checkInvestigationAccess } from '../middleware/access.js';
import { stixIOC, stixRelationship, type STIXObject } from '../lib/stix-projection.js';
import type { AuthUser } from '../types.js';

const TAXII_MEDIA_TYPE = 'application/taxii+json;version=2.1';
const STIX_MEDIA_TYPE = 'application/stix+json;version=2.1';
const app = new Hono<{ Variables: { user: AuthUser } }>();
app.use('*', requireAuth);
app.use('*', async (c, next) => {
  const accept = c.req.header('accept');
  if (accept && !accept.split(',').some(value => /^(\*\/\*|application\/\*|application\/taxii\+json)(?:\s*;|$)/i.test(value.trim()))) {
    return c.json({ title: 'Unsupported media type', description: `Use ${TAXII_MEDIA_TYPE}` }, 406, { 'Content-Type': TAXII_MEDIA_TYPE });
  }
  await next();
  c.header('Content-Type', TAXII_MEDIA_TYPE);
  c.header('Cache-Control', 'private, no-store');
});
// Local-only investigations never enter the server schema/sync contract.
const visibleFolder = (folder: typeof folders.$inferSelect) => !folder.deletedAt;
const collection = (folder: typeof folders.$inferSelect) => ({ id: folder.id, title: folder.name,
  description: folder.description || '', can_read: true, can_write: false, media_types: [STIX_MEDIA_TYPE] });
const liveIOCs = (folderId: string) => and(eq(standaloneIOCs.folderId, folderId), isNull(standaloneIOCs.deletedAt),
  eq(standaloneIOCs.trashed, false), eq(standaloneIOCs.archived, false));

app.get('/', c => c.json({ title: 'ThreatCaddy TAXII Server', description: 'Read-only current-state investigation IOC export',
  default: '/api/taxii/', api_roots: ['/api/taxii/'], versions: [TAXII_MEDIA_TYPE], max_content_length: 1024 * 1024 }));
app.get('/collections/', async c => {
  const memberships = await db.select({ folderId: investigationMembers.folderId }).from(investigationMembers)
    .where(eq(investigationMembers.userId, c.get('user').id));
  if (!memberships.length) return c.json({ collections: [] });
  const rows = await db.select().from(folders).where(and(inArray(folders.id, memberships.map(row => row.folderId)),
    isNull(folders.deletedAt))).orderBy(asc(folders.id));
  return c.json({ collections: rows.filter(visibleFolder).map(collection) });
});
app.get('/collections/:id/', async c => {
  const id = c.req.param('id');
  if (!await checkInvestigationAccess(c.get('user').id, id)) return c.json({ title: 'No access to this collection' }, 403);
  const [folder] = await db.select().from(folders).where(eq(folders.id, id)).limit(1);
  if (!folder || !visibleFolder(folder)) return c.json({ title: 'Collection not found' }, 404);
  return c.json(collection(folder));
});

interface Position { date: string; id: string; offset: number }
function decodeCursor(value: string, query: string): Position {
  if (value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid next cursor');
  const item = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Position & { query: string };
  if (item.query !== query || typeof item.id !== 'string' || item.id.length > 200 || !item.id
    || typeof item.date !== 'string' || !Number.isFinite(Date.parse(item.date))
    || !Number.isInteger(item.offset) || item.offset < 0 || item.offset > 10000) throw new Error('Invalid next cursor');
  return item;
}
app.get('/collections/:id/objects/', async c => {
  const folderId = c.req.param('id');
  if (!await checkInvestigationAccess(c.get('user').id, folderId)) return c.json({ title: 'No access to this collection' }, 403);
  const [folder] = await db.select().from(folders).where(eq(folders.id, folderId)).limit(1);
  if (!folder || !visibleFolder(folder)) return c.json({ title: 'Collection not found' }, 404);
  let limit: number, query: string;
  let after: string | undefined, position: Position | undefined;
  const filters: Record<string, string[]> = {};
  try {
    const params = new URL(c.req.url).searchParams;
    const supported = new Set(['limit', 'next', 'added_after', 'match[id]', 'match[type]', 'match[version]', 'match[spec_version]']);
    for (const key of params.keys()) if (!supported.has(key) || params.getAll(key).length !== 1) throw new Error('Unsupported or repeated query parameter');
    const rawLimit = params.get('limit') ?? '100';
    if (!/^[1-9]\d*$/.test(rawLimit) || !Number.isSafeInteger(Number(rawLimit))) throw new Error('limit must be a positive integer');
    limit = Math.min(Number(rawLimit), 500);
    const timestamp = params.get('added_after');
    if (timestamp !== null) {
      if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) throw new Error('Invalid added_after timestamp');
      after = timestamp;
    }
    for (const field of ['id', 'type', 'version', 'spec_version']) {
      const value = params.get(`match[${field}]`);
      if (value !== null) {
        if (!value || value.length > 10000 || value.split(',').some(item => !item.trim())) throw new Error('Invalid match filter');
        filters[field] = value.split(',');
      }
    }
    query = createHash('sha256').update(JSON.stringify([folderId, timestamp, filters])).digest('hex');
    if (params.has('next')) position = decodeCursor(params.get('next')!, query);
  } catch (error) { return c.json({ title: 'Invalid TAXII query', description: String(error) }, 400); }
  const matches = (object: STIXObject) => (!filters.id || filters.id.includes(object.id))
    && (!filters.type || filters.type.includes(object.type))
    && (!filters.spec_version || filters.spec_version.includes('2.1'))
    && (!filters.version || filters.version.some(version => ['last', 'all'].includes(version) || version === (object.modified ?? object.created)));
  const output: Array<{ object: STIXObject; position: Position }> = [];
  let scanned = 0, exhausted = false;
  let bytes = 0, byteLimitReached = false;
  let lastScanned = position;
  let exclusive = false;
  // Bound scans even for heavily filtered collections; callers follow more/next.
  while (output.length <= limit && scanned < 1000 && !exhausted && !byteLimitReached) {
    const boundary = position ? or(sql`${standaloneIOCs.updatedAt} > ${position.date}::timestamptz`,
      and(sql`${standaloneIOCs.updatedAt} = ${position.date}::timestamptz`, (exclusive ? gt : gte)(standaloneIOCs.id, position.id))) : undefined;
    const rows = await db.select({ ...getTableColumns(standaloneIOCs),
      cursorDate: sql<string>`to_char(${standaloneIOCs.updatedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    }).from(standaloneIOCs).where(and(liveIOCs(folderId), boundary,
      after ? sql`${standaloneIOCs.updatedAt} > ${after}::timestamptz` : undefined)).orderBy(asc(standaloneIOCs.updatedAt), asc(standaloneIOCs.id)).limit(100);
    if (!rows.length) { exhausted = true; break; }
    for (const original of rows) {
      const ioc = { ...original, clsLevel: original.clsLevel || folder.clsLevel };
      scanned++;
      const date = ioc.cursorDate;
      const start = !exclusive && position?.id === ioc.id && position.date === date ? position.offset : 0;
      let objects = stixIOC(ioc);
      const relationships = Array.isArray(ioc.relationships) ? ioc.relationships as Array<{ targetIOCId?: string; relationshipType?: string }> : [];
      if (relationships.length > 1000) return c.json({ title: 'IOC exceeds the supported relationship limit' }, 422);
      const ids = [...new Set(relationships.map(rel => rel.targetIOCId).filter((id): id is string => typeof id === 'string' && !!id))];
      if (objects.length && ids.length) {
        const targets = await db.select().from(standaloneIOCs).where(and(liveIOCs(folderId), inArray(standaloneIOCs.id, ids)));
        for (const rel of relationships) {
          const target = targets.find(row => row.id === rel.targetIOCId && row.folderId === folderId);
          if (target && typeof rel.relationshipType === 'string') objects.push(...stixRelationship(ioc,
            { ...target, clsLevel: target.clsLevel || folder.clsLevel }, rel.relationshipType));
        }
      }
      objects = objects.filter(matches);
      for (let index = start; index < objects.length && output.length <= limit; index++) {
        const size = Buffer.byteLength(JSON.stringify(objects[index]));
        if (size > 8 * 1024 * 1024) return c.json({ title: 'A STIX object exceeds the 8 MiB page size' }, 422);
        if (bytes + size > 8 * 1024 * 1024) { byteLimitReached = true; break; }
        output.push({ object: objects[index], position: { date, id: ioc.id, offset: index + 1 } });
        bytes += size;
      }
      lastScanned = { date, id: ioc.id, offset: objects.length };
      if (output.length > limit || byteLimitReached) break;
    }
    if (output.length > limit || byteLimitReached) break;
    if (rows.length < 100) { exhausted = true; break; }
    position = lastScanned;
    exclusive = true;
  }
  const more = output.length > limit || byteLimitReached || !exhausted;
  const delivered = output.slice(0, limit);
  const continuation = output.length > limit || byteLimitReached ? delivered.at(-1)?.position : lastScanned;
  if (delivered.length) {
    c.header('X-TAXII-Date-Added-First', delivered[0].position.date);
    c.header('X-TAXII-Date-Added-Last', delivered[delivered.length - 1].position.date);
  }
  return c.json({ objects: delivered.map(item => item.object), more,
    ...(more && continuation ? { next: Buffer.from(JSON.stringify({ ...continuation, query })).toString('base64url') } : {}) });
});
export default app;
