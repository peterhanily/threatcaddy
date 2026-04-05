/**
 * Webhook ingest endpoint — accepts alerts from SIEMs, SOAR platforms, and
 * other external systems. Auto-creates investigations and triggers agents.
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
 *   "triggerAgents": true          // optional — auto-start agents (default: true)
 * }
 */

import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import { folders, notes, standaloneIOCs } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { logger } from '../lib/logger.js';
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

app.post('/ingest', async (c) => {
  let body: IngestPayload;
  try {
    const rawBody = c.get('rawBody' as never) as string | undefined;
    body = rawBody ? JSON.parse(rawBody) : await c.req.json<IngestPayload>();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.source || !body.title) {
    return c.json({ error: 'source and title are required' }, 400);
  }

  const now = new Date();
  let folderId = body.investigationId;
  let created = false;

  // Find or create investigation
  if (folderId) {
    const existing = await db.select({ id: folders.id }).from(folders).where(eq(folders.id, folderId)).limit(1);
    if (existing.length === 0) {
      return c.json({ error: `Investigation ${folderId} not found` }, 404);
    }
  } else {
    // Auto-create investigation from alert
    folderId = nanoid();
    const severityIcon = body.severity === 'critical' ? '🚨' : body.severity === 'high' ? '⚠️' : body.severity === 'medium' ? '🔶' : '📋';
    await db.insert(folders).values({
      id: folderId,
      name: `${severityIcon} ${body.title}`,
      description: body.description || `Auto-created from ${body.source} alert`,
      status: 'active',
      tags: JSON.stringify([...(body.tags || []), `source:${body.source}`, 'auto-ingested']),
      createdAt: now,
      updatedAt: now,
    });
    created = true;
    logger.info('Webhook ingest: created investigation', { folderId, source: body.source, title: body.title });
  }

  // Create alert note with raw payload
  const noteId = nanoid();
  const noteContent = [
    `# Alert: ${body.title}`,
    '',
    `**Source:** ${body.source}`,
    body.severity ? `**Severity:** ${body.severity}` : '',
    body.description ? `\n${body.description}` : '',
    '',
    body.raw ? `## Raw Alert Data\n\`\`\`json\n${JSON.stringify(body.raw, null, 2).substring(0, 5000)}\n\`\`\`` : '',
  ].filter(Boolean).join('\n');

  await db.insert(notes).values({
    id: noteId,
    folderId,
    title: `[${body.source.toUpperCase()}] ${body.title}`,
    content: noteContent,
    tags: JSON.stringify(['alert', `source:${body.source}`, ...(body.severity ? [`severity:${body.severity}`] : [])]),
    pinned: body.severity === 'critical' || body.severity === 'high',
    trashed: false,
    archived: false,
    version: 1,
    createdAt: now,
    updatedAt: now,
  });

  // Auto-create IOCs if provided
  let iocCount = 0;
  if (body.iocs?.length) {
    for (const ioc of body.iocs.slice(0, 100)) {
      if (!ioc.type || !ioc.value) continue;
      await db.insert(standaloneIOCs).values({
        id: nanoid(),
        folderId,
        type: ioc.type,
        value: ioc.value,
        confidence: (ioc.confidence || 'medium') as 'low' | 'medium' | 'high' | 'confirmed',
        analystNotes: `Auto-extracted from ${body.source} alert`,
        tags: JSON.stringify(['auto-ingested', `source:${body.source}`]),
        iocStatus: 'new',
        trashed: false,
        archived: false,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
      iocCount++;
    }
  }

  // Trigger agents if requested (default: true)
  const triggerAgents = body.triggerAgents !== false;
  let agentsTriggered = 0;
  if (triggerAgents) {
    try {
      // Import caddy-agents trigger logic
      const { botConfigs: botConfigsTable } = await import('../db/schema.js');
      const bots = await db.select()
        .from(botConfigsTable)
        .where(and(eq(botConfigsTable.sourceType, 'caddy-agent'), eq(botConfigsTable.enabled, true)));

      const matchingBots = bots.filter(b =>
        Array.isArray(b.scopeFolderIds) && (b.scopeFolderIds as string[]).includes(folderId!)
      );
      agentsTriggered = matchingBots.length;

      if (agentsTriggered > 0) {
        logger.info('Webhook ingest: triggering agents', { folderId, agents: agentsTriggered });
      }
    } catch (err) {
      logger.warn('Webhook ingest: failed to trigger agents', { error: String(err) });
    }
  }

  return c.json({
    ok: true,
    investigationId: folderId,
    created,
    noteId,
    iocs: iocCount,
    agentsTriggered,
    message: created
      ? `Investigation created with ${iocCount} IOCs. ${agentsTriggered} agents triggered.`
      : `Alert added to existing investigation. ${iocCount} IOCs created. ${agentsTriggered} agents triggered.`,
  });
});

export default app;
