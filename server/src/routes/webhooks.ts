/**
 * Webhook ingest endpoint — accepts alerts from SIEMs, SOAR platforms, and
 * other external systems. Creates attributed alerts and owned investigations.
 *
 * Auth: Bearer token or X-Webhook-Secret header (configured via WEBHOOK_INGEST_SECRET env var).
 * No JWT required — this is designed for machine-to-machine integration.
 *
 * POST /api/webhooks/ingest
 * {
 *   "source": "splunk",           // required — identifies the sending system
 *   "title": "Suspicious login",  // required — becomes investigation name
 *   "description": "...",         // optional — investigation description
 *   "severity": "high",           // optional — low/medium/high/critical
 *   "raw": { ... },               // optional — full raw alert payload
 *   "iocs": [                     // optional — IOCs to auto-create
 *     { "type": "ipv4", "value": "1.2.3.4" },
 *     { "type": "domain", "value": "evil.com" }
 *   ],
 *   "investigationId": "abc123",  // optional — add to existing investigation
 *   "tags": ["phishing"],         // optional — tags for the investigation
 *   "triggerAgents": true          // retained for compatibility; server handoff is unavailable
 * }
 */

import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import { folders, notes, standaloneIOCs, users, investigationMembers } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { logger } from '../lib/logger.js';
import { checkInvestigationAccess } from '../middleware/access.js';
import { HANDOFF_UNAVAILABLE } from '../bots/handoff-policy.js';
import { timingSafeEqual, createHmac } from 'node:crypto';

const app = new Hono();

const INGEST_SECRET = process.env.WEBHOOK_INGEST_SECRET || '';

// ─── Auth middleware ──────────────────────────────────────────────

app.use('*', async (c, next) => {
  if (!INGEST_SECRET) {
    return c.json({ error: 'Webhook ingest not configured. Set WEBHOOK_INGEST_SECRET env var.' }, 503);
  }

  // Accept Bearer token or X-Webhook-Secret header
  const authHeader = c.req.header('Authorization') || '';
  const secretHeader = c.req.header('X-Webhook-Secret') || '';
  const signatureHeader = c.req.header('X-Webhook-Signature') || '';

  let authenticated = false;

  // Bearer token
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const tokenBuf = Buffer.from(token);
    const secretBuf = Buffer.from(INGEST_SECRET);
    if (tokenBuf.length === secretBuf.length && timingSafeEqual(tokenBuf, secretBuf)) {
      authenticated = true;
    }
  }

  // Raw secret header
  if (!authenticated && secretHeader) {
    const headerBuf = Buffer.from(secretHeader);
    const secretBuf = Buffer.from(INGEST_SECRET);
    if (headerBuf.length === secretBuf.length && timingSafeEqual(headerBuf, secretBuf)) {
      authenticated = true;
    }
  }

  // HMAC-SHA256 signature
  if (!authenticated && signatureHeader.startsWith('sha256=')) {
    const rawBody = await c.req.text();
    const expected = createHmac('sha256', INGEST_SECRET).update(rawBody).digest('hex');
    const provided = signatureHeader.slice(7);
    const expectedBuf = Buffer.from(expected);
    const providedBuf = Buffer.from(provided);
    if (expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf)) {
      authenticated = true;
      // Store raw body for later parsing since we consumed it
      c.set('rawBody' as never, rawBody as never);
    }
  }

  if (!authenticated) {
    return c.json({ error: 'Invalid webhook secret' }, 401);
  }

  return next();
});

// ─── Ingest endpoint ─────────────────────────────────────────────

interface IngestPayload {
  source: string;
  title: string;
  description?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  raw?: Record<string, unknown>;
  iocs?: Array<{ type: string; value: string; confidence?: string }>;
  investigationId?: string;
  tags?: string[];
  triggerAgents?: boolean;
}

const VALID_SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);
const MAX_TITLE_LEN = 200;
const MAX_SOURCE_LEN = 50;
const MAX_IOC_VALUE_LEN = 500;

/** Sanitize a string: trim, enforce max length, strip control chars. */
function sanitizeStr(s: unknown, maxLen: number): string {
  if (typeof s !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return s.trim().replace(/[\x00-\x1f]/g, '').substring(0, maxLen);
}

class IngestAuthorizationError extends Error {
  constructor(message: string, readonly status: 403 | 503) { super(message); }
}

app.post('/ingest', async (c) => {
  let body: IngestPayload;
  try {
    // Use pre-read body from HMAC auth, or parse fresh
    const rawBody = c.get('rawBody' as never) as string | undefined;
    body = rawBody ? JSON.parse(rawBody) : await c.req.json<IngestPayload>();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ error: 'Invalid ingest payload' }, 400);
  if (body.iocs !== undefined && !Array.isArray(body.iocs)) return c.json({ error: 'iocs must be an array' }, 400);

  // Strict type + length validation
  const source = sanitizeStr(body.source, MAX_SOURCE_LEN);
  const title = sanitizeStr(body.title, MAX_TITLE_LEN);
  if (!source || !title) {
    return c.json({ error: 'source (string, max 50) and title (string, max 200) are required' }, 400);
  }
  const severity = VALID_SEVERITIES.has(String(body.severity || '')) ? String(body.severity) as 'low' | 'medium' | 'high' | 'critical' : 'medium';
  const description = sanitizeStr(body.description, 5000);
  const tags = Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === 'string' && t.length < 100).slice(0, 20) : [];

  const ownerId = process.env.WEBHOOK_INGEST_OWNER_ID;
  if (!ownerId) return c.json({ error: 'Webhook ingest requires WEBHOOK_INGEST_OWNER_ID for an active analyst or administrator' }, 503);
  const [owner] = await db.select({ id: users.id, active: users.active, role: users.role, email: users.email })
    .from(users).where(eq(users.id, ownerId)).limit(1);
  if (!owner || !owner.active || !['admin', 'analyst'].includes(owner.role) || owner.email.endsWith('@threatcaddy.internal')) {
    return c.json({ error: 'Configured ingestion owner is not an active analyst or administrator' }, 503);
  }
  const now = new Date();
  const created = !body.investigationId;
  const folderId = body.investigationId || nanoid();
  if (typeof folderId !== 'string') return c.json({ error: 'investigationId must be a string' }, 400);
  if (!created) {
    const existing = await db.select({ id: folders.id }).from(folders).where(eq(folders.id, folderId)).limit(1);
    if (!existing.length) return c.json({ error: 'Investigation not found' }, 404);
    if (!await checkInvestigationAccess(ownerId, folderId, 'editor')) return c.json({ error: 'Configured ingestion owner cannot edit this investigation' }, 403);
  }

  // Create alert note
  const noteId = nanoid();
  const noteContent = [
    `# Alert: ${title}`,
    '',
    `**Source:** ${source}`,
    `**Severity:** ${severity}`,
    description ? `\n${description}` : '',
    '',
    body.raw ? `## Raw Alert Data\n\`\`\`json\n${JSON.stringify(body.raw, null, 2).substring(0, 5000)}\n\`\`\`` : '',
  ].filter(Boolean).join('\n');

  let iocCount = 0;
  try {
    await db.transaction(async tx => {
      const [currentOwner] = await tx.select({ active: users.active, role: users.role, email: users.email })
        .from(users).where(eq(users.id, ownerId)).for('share');
      if (!currentOwner || !currentOwner.active || !['admin', 'analyst'].includes(currentOwner.role)
          || currentOwner.email.endsWith('@threatcaddy.internal')) throw new IngestAuthorizationError('Configured ingestion owner is no longer eligible', 503);
      if (!created && !await checkInvestigationAccess(ownerId, folderId, 'editor', tx)) throw new IngestAuthorizationError('Configured ingestion owner can no longer edit this investigation', 403);
      if (created) {
        const severityIcon = severity === 'critical' ? '🚨' : severity === 'high' ? '⚠️' : severity === 'medium' ? '🔶' : '📋';
        await tx.insert(folders).values({
          id: folderId, name: `${severityIcon} ${title}`.substring(0, 200),
          description: description || `Auto-created from ${source} alert`, status: 'active',
          tags: [...tags, `source:${source}`, 'auto-ingested'],
          createdBy: ownerId, updatedBy: ownerId, createdAt: now, updatedAt: now,
        });
        await tx.insert(investigationMembers).values({ id: nanoid(), folderId, userId: ownerId, role: 'owner', joinedAt: now });
      }
      await tx.insert(notes).values({
        id: noteId,
        folderId,
        title: `[${source.toUpperCase()}] ${title}`.substring(0, 200),
        content: noteContent,
        tags: ['alert', `source:${source}`, `severity:${severity}`],
        createdBy: ownerId, updatedBy: ownerId,
        pinned: severity === 'critical' || severity === 'high',
        trashed: false,
        archived: false,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });

      // Batch-insert IOCs
      if (body.iocs?.length) {
        const VALID_CONFIDENCES = new Set(['low', 'medium', 'high', 'confirmed']);
        const iocValues = body.iocs.slice(0, 100)
          .filter(ioc => ioc && typeof ioc.type === 'string' && typeof ioc.value === 'string' && ioc.type && ioc.value)
          .map(ioc => ({
            id: nanoid(),
            folderId: folderId!,
            type: sanitizeStr(ioc.type, 50),
            value: sanitizeStr(ioc.value, MAX_IOC_VALUE_LEN),
            confidence: (VALID_CONFIDENCES.has(ioc.confidence || '') ? ioc.confidence : 'medium') as 'low' | 'medium' | 'high' | 'confirmed',
            analystNotes: `Auto-extracted from ${source} alert`,
            tags: ['auto-ingested', `source:${source}`],
            createdBy: ownerId, updatedBy: ownerId,
            iocStatus: 'new',
            trashed: false,
            archived: false,
            version: 1,
            createdAt: now,
            updatedAt: now,
          }));

        if (iocValues.length > 0) {
          await tx.insert(standaloneIOCs).values(iocValues);
          iocCount = iocValues.length;
        }
      }

    });
  } catch (error) {
    if (error instanceof IngestAuthorizationError) return c.json({ error: error.message }, error.status);
    throw error;
  }
  if (created) logger.info('Webhook ingest: created owned investigation', { folderId, source });
  // Handoff execution is deliberately unavailable until policy parity is implemented.
  const agentsTriggered = 0;

  return c.json({
    ok: true,
    investigationId: folderId,
    created,
    noteId,
    iocs: iocCount,
    agentsTriggered,
    agentExecutionAvailable: false,
    ...(body.triggerAgents !== false ? { agentExecutionReason: HANDOFF_UNAVAILABLE } : {}),
    message: created
      ? `Investigation created with ${iocCount} IOCs. ${agentsTriggered} agents triggered.`
      : `Alert added to existing investigation. ${iocCount} IOCs created. ${agentsTriggered} agents triggered.`,
  });
});

export default app;
