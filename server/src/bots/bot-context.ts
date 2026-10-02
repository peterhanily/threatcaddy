import { nanoid } from 'nanoid';
import { lookup } from 'node:dns/promises';
import { createHash, timingSafeEqual } from 'node:crypto';
import { requestPinned, withAbort } from '../lib/bounded-http.js';
import { setTimeout as delay } from 'node:timers/promises';
import { Client as SSHClient } from 'ssh2';
import { eq, and, or, isNull, ilike, inArray } from 'drizzle-orm';
import { executeCode, type CodeExecutionResult } from './sandbox.js';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { processPush, lookupEntityFolderId } from '../services/sync-service.js';
import { createNotification } from '../services/notification-service.js';
import { logActivity } from '../services/audit-service.js';
import { broadcastToFolder } from '../ws/handler.js';
import type { BotContext, BotCapability, BotRunLogEntry } from './types.js';

const BOT_WRITABLE_TABLES = new Set(['notes', 'tasks', 'standaloneIOCs', 'timelineEvents']);

/** Escape LIKE/ILIKE wildcard characters so user input is treated as literals */
export function escapeLikePattern(s: string): string {
  return s.replace(/[%_\\]/g, '\\$&');
}

export function isPrivateIP(ip: string): boolean {
  // IPv6 checks
  if (ip === '::1' || ip === '::' || ip === '0:0:0:0:0:0:0:0') return true;
  const lowerIp = ip.toLowerCase();
  if (lowerIp.startsWith('fc') || lowerIp.startsWith('fd')) return true; // fc00::/7
  if (/^fe[89ab]/i.test(lowerIp)) return true;
  if (lowerIp.startsWith('ff')) return true;

  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1) — strip prefix and check as IPv4
  if (lowerIp.startsWith('::ffff:')) {
    const mapped = lowerIp.replace(/^::ffff:/, '');
    return isPrivateIP(mapped);
  }

  // IPv4 checks
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return false;
  const [a, b] = parts;
  if (a === 127) return true;                              // 127.0.0.0/8
  if (a === 10) return true;                               // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true;        // 172.16.0.0/12
  if (a === 192 && b === 168) return true;                 // 192.168.0.0/16
  if (a === 169 && b === 254) return true;                 // 169.254.0.0/16
  if (a === 0) return true;                                // 0.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true;       // 100.64.0.0/10 (CGNAT)
  if (a === 198 && (b === 18 || b === 19)) return true;    // 198.18.0.0/15 (benchmarking)
  if (a >= 240) return true;                               // 240.0.0.0/4 (reserved + broadcast)
  return false;
}

/**
 * Provides safe, capability-gated operations for bot execution.
 * Every action is audited and attributed to the bot's user ID.
 */
export class BotExecutionContext {
  constructor(private ctx: BotContext) {}

  // ─── Capability Check ─────────────────────────────────────────

  private requireCapability(cap: BotCapability): void {
    if (!this.ctx.botConfig.capabilities.includes(cap)) {
      throw new Error(`Bot "${this.ctx.botConfig.name}" lacks capability: ${cap}`);
    }
  }

  // ─── Scope Check ───────────────────────────────────────────────

  private requireScope(folderId: string): void {
    const config = this.ctx.botConfig;
    if (config.scopeType === 'global') return;
    if (config.scopeFolderIds.includes(folderId)) return;
    throw new Error(`Bot "${config.name}" not authorized for folder ${folderId}`);
  }

  // ─── Domain Check (for outbound HTTP) ─────────────────────────

  private requireDomain(url: string): void {
    this.requireCapability('call_external_apis');
    const allowed = this.ctx.botConfig.allowedDomains;
    if (allowed.length === 0) {
      throw new Error('No allowed domains configured — outbound HTTP is blocked');
    }

    try {
      const hostname = new URL(url).hostname;
      const match = allowed.some((d) => hostname === d || hostname.endsWith(`.${d}`));
      if (!match) {
        throw new Error(`Bot "${this.ctx.botConfig.name}" not allowed to call ${hostname}. Allowed: ${allowed.join(', ')}`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('not allowed')) throw err;
      throw new Error(`Invalid URL: ${url}`);
    }
  }

  // ─── Config Access ──────────────────────────────────────────

  /** Get the decrypted bot config (secrets are already decrypted) */
  getConfig(): Record<string, unknown> {
    return (this.ctx.botConfig.config ?? {}) as Record<string, unknown>;
  }

  // ─── Abort Check ──────────────────────────────────────────────

  checkAborted(): void {
    this.ctx.signal.throwIfAborted();
  }

  get signal(): AbortSignal { return this.ctx.signal; }

  // ─── Read Operations ──────────────────────────────────────────

  async searchNotes(folderId: string, query: string, limit = 20): Promise<Record<string, unknown>[]> {
    limit = Math.min(limit, 100);
    this.checkAborted();
    this.requireCapability('read_entities');
    this.requireScope(folderId);

    const conditions = [
      eq(schema.notes.folderId, folderId),
      eq(schema.notes.trashed, false),
      isNull(schema.notes.deletedAt),
    ];
    if (query) {
      const escaped = escapeLikePattern(query);
      conditions.push(
        or(
          ilike(schema.notes.title, `%${escaped}%`),
          ilike(schema.notes.content, `%${escaped}%`),
        )!
      );
    }

    const rows = await db.select({
      id: schema.notes.id,
      title: schema.notes.title,
      content: schema.notes.content,
      folderId: schema.notes.folderId,
      tags: schema.notes.tags,
      createdAt: schema.notes.createdAt,
      updatedAt: schema.notes.updatedAt,
    }).from(schema.notes)
      .where(and(...conditions))
      .limit(limit);

    return rows.map((n) => ({ id: n.id, title: n.title, snippet: n.content.slice(0, 200), tags: n.tags }));
  }

  async readNote(noteId: string): Promise<Record<string, unknown> | null> {
    this.checkAborted();
    this.requireCapability('read_entities');

    const rows = await db.select().from(schema.notes).where(eq(schema.notes.id, noteId)).limit(1);
    if (rows.length === 0) return null;

    const note = rows[0];
    if (note.folderId) {
      this.requireScope(note.folderId);
    } else {
      // Note has no folderId — only global bots may access unscoped entities
      if (this.ctx.botConfig.scopeType !== 'global') {
        throw new Error(`Bot "${this.ctx.botConfig.name}" cannot access unscoped note (non-global bot)`);
      }
    }
    return note as Record<string, unknown>;
  }

  async listIOCs(folderId: string, typeFilter?: string, limit = 500): Promise<Record<string, unknown>[]> {
    limit = Math.min(limit, 500);
    this.checkAborted();
    this.requireCapability('read_entities');
    this.requireScope(folderId);

    const conditions = [
      eq(schema.standaloneIOCs.folderId, folderId),
      eq(schema.standaloneIOCs.trashed, false),
      isNull(schema.standaloneIOCs.deletedAt),
    ];
    if (typeFilter) {
      conditions.push(eq(schema.standaloneIOCs.type, typeFilter));
    }

    return db.select().from(schema.standaloneIOCs)
      .where(and(...conditions))
      .limit(limit);
  }

  /**
   * Batch-fetch IOCs for multiple folder IDs in a single query.
   * Returns a Map from folderId to the array of IOC rows for that folder.
   */
  async listIOCsBatch(folderIds: string[]): Promise<Map<string, Record<string, unknown>[]>> {
    this.checkAborted();
    this.requireCapability('read_entities');
    for (const fid of folderIds) this.requireScope(fid);

    const result = new Map<string, Record<string, unknown>[]>();
    if (folderIds.length === 0) return result;

    const rows = await db.select().from(schema.standaloneIOCs)
      .where(and(
        inArray(schema.standaloneIOCs.folderId, folderIds),
        eq(schema.standaloneIOCs.trashed, false),
        isNull(schema.standaloneIOCs.deletedAt),
      ));

    for (const row of rows) {
      const fid = (row as Record<string, unknown>).folderId as string;
      let arr = result.get(fid);
      if (!arr) { arr = []; result.set(fid, arr); }
      arr.push(row as Record<string, unknown>);
    }
    return result;
  }

  async listTasks(folderId: string, statusFilter?: string, limit = 500): Promise<Record<string, unknown>[]> {
    limit = Math.min(limit, 500);
    this.checkAborted();
    this.requireCapability('read_entities');
    this.requireScope(folderId);

    const conditions = [
      eq(schema.tasks.folderId, folderId),
      eq(schema.tasks.trashed, false),
      isNull(schema.tasks.deletedAt),
    ];
    if (statusFilter) {
      conditions.push(eq(schema.tasks.status, statusFilter as 'todo' | 'in-progress' | 'done'));
    }

    return db.select().from(schema.tasks)
      .where(and(...conditions))
      .limit(limit);
  }

  /**
   * Batch-fetch tasks for multiple folder IDs in a single query.
   * Returns a Map from folderId to the array of task rows for that folder.
   */
  async listTasksBatch(folderIds: string[]): Promise<Map<string, Record<string, unknown>[]>> {
    this.checkAborted();
    this.requireCapability('read_entities');
    for (const fid of folderIds) this.requireScope(fid);

    const result = new Map<string, Record<string, unknown>[]>();
    if (folderIds.length === 0) return result;

    const rows = await db.select().from(schema.tasks)
      .where(and(
        inArray(schema.tasks.folderId, folderIds),
        eq(schema.tasks.trashed, false),
        isNull(schema.tasks.deletedAt),
      ));

    for (const row of rows) {
      const fid = (row as Record<string, unknown>).folderId as string;
      let arr = result.get(fid);
      if (!arr) { arr = []; result.set(fid, arr); }
      arr.push(row as Record<string, unknown>);
    }
    return result;
  }

  async listTimelineEvents(folderId: string, limit = 500): Promise<Record<string, unknown>[]> {
    limit = Math.min(limit, 500);
    this.checkAborted();
    this.requireCapability('read_entities');
    this.requireScope(folderId);

    return db.select().from(schema.timelineEvents).where(
      and(
        eq(schema.timelineEvents.folderId, folderId),
        eq(schema.timelineEvents.trashed, false),
        isNull(schema.timelineEvents.deletedAt),
      )
    ).limit(limit);
  }

  async getInvestigation(folderId: string): Promise<Record<string, unknown> | null> {
    this.checkAborted();
    this.requireCapability('read_entities');
    this.requireScope(folderId);

    const rows = await db.select().from(schema.folders).where(
      and(eq(schema.folders.id, folderId), isNull(schema.folders.deletedAt))
    ).limit(1);
    return rows.length > 0 ? (rows[0] as Record<string, unknown>) : null;
  }

  async listInvestigations(): Promise<Record<string, unknown>[]> {
    this.checkAborted();
    this.requireCapability('read_entities');

    const config = this.ctx.botConfig;
    const conditions = [isNull(schema.folders.deletedAt)];

    if (config.scopeType !== 'global' && config.scopeFolderIds.length > 0) {
      conditions.push(inArray(schema.folders.id, config.scopeFolderIds));
    } else if (config.scopeType !== 'global') {
      // Non-global bot with no scopeFolderIds — return nothing
      return [];
    }

    return db.select().from(schema.folders).where(and(...conditions));
  }

  async searchAcrossInvestigations(query: string): Promise<Record<string, unknown>[]> {
    this.checkAborted();
    this.requireCapability('cross_investigation');

    const config = this.ctx.botConfig;
    const q = `%${escapeLikePattern(query)}%`;

    const conditions = [
      ilike(schema.standaloneIOCs.value, q),
      eq(schema.standaloneIOCs.trashed, false),
      isNull(schema.standaloneIOCs.deletedAt),
    ];

    // Restrict to scoped folders unless global
    if (config.scopeType !== 'global' && config.scopeFolderIds.length > 0) {
      conditions.push(inArray(schema.standaloneIOCs.folderId, config.scopeFolderIds));
    } else if (config.scopeType !== 'global') {
      return [];
    }

    return db.select().from(schema.standaloneIOCs).where(and(...conditions)).limit(500);
  }

  // ─── Write Operations (via sync-service) ──────────────────────

  async createEntity(table: string, entityId: string, data: Record<string, unknown>): Promise<void> {
    if (!BOT_WRITABLE_TABLES.has(table)) {
      throw new Error(`Bot "${this.ctx.botConfig.name}" cannot write to table "${table}"`);
    }
    this.checkAborted();
    this.requireCapability('create_entities');

    if (data.folderId && typeof data.folderId === 'string') {
      this.requireScope(data.folderId);
    } else if (this.ctx.botConfig.scopeType !== 'global') {
      throw new Error(`Bot "${this.ctx.botConfig.name}" must specify folderId for entity creation (non-global scope)`);
    }

    const results = await processPush(
      [{ table, op: 'put', entityId, data, clientVersion: 0 }],
      this.ctx.botUserId,
    );

    const result = results[0];
    if (result.status !== 'accepted') {
      throw new Error(`Failed to create ${table}/${entityId}: ${result.status}`);
    }

    this.ctx.entitiesCreated++;

    // Broadcast entity change for real-time sync
    const folderId = data.folderId as string | undefined;
    if (folderId) {
      broadcastToFolder(folderId, {
        type: 'entity-change',
        table,
        op: 'put',
        entityId,
        data: result.serverRecord,
        updatedBy: this.ctx.botUserId,
      }, this.ctx.botUserId);
    }
  }

  async updateEntity(table: string, entityId: string, data: Record<string, unknown>, clientVersion?: number): Promise<void> {
    if (!BOT_WRITABLE_TABLES.has(table)) {
      throw new Error(`Bot "${this.ctx.botConfig.name}" cannot write to table "${table}"`);
    }
    this.checkAborted();
    this.requireCapability('update_entities');

    // Check scope against the existing entity's folder
    const existingFolderId = await lookupEntityFolderId(table, entityId);
    if (existingFolderId) {
      this.requireScope(existingFolderId);
    } else if (this.ctx.botConfig.scopeType !== 'global') {
      throw new Error(`Bot "${this.ctx.botConfig.name}" cannot update entity without verifiable scope (folderId not found)`);
    }

    if (data.folderId && typeof data.folderId === 'string' && data.folderId !== existingFolderId) {
      this.requireScope(data.folderId);
    }

    const results = await processPush(
      [{ table, op: 'put', entityId, data, clientVersion }],
      this.ctx.botUserId,
      // Built-in updates are field patches. If no observed revision is supplied,
      // the service merges only these fields under its transaction writer lock.
      { trustedInternal: true },
    );

    const result = results[0];
    if (result.status !== 'accepted') {
      throw new Error(`Failed to update ${table}/${entityId}: ${result.status}`);
    }

    this.ctx.entitiesUpdated++;

    const folderId = (result.serverRecord?.folderId as string | undefined) || existingFolderId;
    if (existingFolderId && folderId && existingFolderId !== folderId) {
      await broadcastToFolder(existingFolderId, {
        type: 'entity-change', table, op: 'delete', entityId, updatedBy: this.ctx.botUserId,
      }, this.ctx.botUserId);
    }
    if (folderId) {
      broadcastToFolder(folderId, {
        type: 'entity-change',
        table,
        op: 'put',
        entityId,
        data: result.serverRecord,
        updatedBy: this.ctx.botUserId,
      }, this.ctx.botUserId);
    }
  }

  // ─── Convenience: Create Specific Entities ────────────────────

  async createNote(folderId: string, title: string, content: string, tags: string[] = []): Promise<string> {
    this.requireScope(folderId);
    const id = nanoid();
    await this.createEntity('notes', id, {
      title, content, folderId, tags,
      pinned: false, archived: false, trashed: false,
    });
    return id;
  }

  async createIOC(folderId: string, type: string, value: string, confidence = 'medium', analystNotes?: string): Promise<string> {
    this.requireScope(folderId);
    const id = nanoid();
    await this.createEntity('standaloneIOCs', id, {
      type, value, confidence, analystNotes: analystNotes ?? null,
      folderId, tags: [], trashed: false, archived: false,
      relationships: [], linkedNoteIds: [], linkedTaskIds: [], linkedTimelineEventIds: [],
    });
    return id;
  }

  async createTask(folderId: string, title: string, description?: string, priority = 'none'): Promise<string> {
    this.requireScope(folderId);
    const id = nanoid();
    await this.createEntity('tasks', id, {
      title, description: description ?? '', priority, status: 'todo',
      folderId, tags: [], completed: false, order: 0,
      trashed: false, archived: false,
      linkedNoteIds: [], linkedTaskIds: [], linkedTimelineEventIds: [],
    });
    return id;
  }

  async createTimelineEvent(folderId: string, title: string, eventType: string, timestamp: Date, opts?: {
    description?: string; source?: string; confidence?: string;
    mitreAttackIds?: string[]; linkedIOCIds?: string[];
  }): Promise<string> {
    this.requireScope(folderId);
    const id = nanoid();

    // Resolve timelineId from folder
    const folder = await this.getInvestigation(folderId);
    const timelineId = (folder?.timelineId as string) || '';

    await this.createEntity('timelineEvents', id, {
      title, eventType, timestamp, folderId, timelineId,
      description: opts?.description ?? '', source: opts?.source ?? 'bot',
      confidence: opts?.confidence ?? 'medium',
      mitreAttackIds: opts?.mitreAttackIds ?? [],
      linkedIOCIds: opts?.linkedIOCIds ?? [],
      linkedNoteIds: [], linkedTaskIds: [],
      tags: [], assets: [], trashed: false, archived: false, starred: false,
    });
    return id;
  }

  // ─── Team Feed (route path + table name retain the CaddyShack codename) ─

  async postToFeed(content: string, folderId?: string): Promise<string> {
    this.requireCapability('post_to_feed');
    this.checkAborted();
    if (folderId) {
      this.requireScope(folderId);
    } else if (this.ctx.botConfig.scopeType !== 'global') {
      throw new Error(`Bot "${this.ctx.botConfig.name}" cannot post to global feed (non-global bot)`);
    }

    const id = nanoid();
    await db.insert(schema.posts).values({
      id,
      authorId: this.ctx.botUserId,
      content,
      attachments: [],
      folderId: folderId ?? null,
      mentions: [],
      deleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Broadcast new post
    if (folderId) {
      broadcastToFolder(folderId, { type: 'new-post', postId: id, folderId }, this.ctx.botUserId);
    }

    await logActivity({
      userId: this.ctx.botUserId,
      category: 'bot',
      action: 'post.create',
      detail: `Bot "${this.ctx.botConfig.name}" posted to feed`,
      itemId: id,
      folderId,
    });

    return id;
  }

  // ─── Notifications ───────────────────────────────────────────

  async notifyUser(userId: string, message: string, folderId?: string): Promise<void> {
    this.requireCapability('notify_users');
    this.checkAborted();

    await createNotification({
      userId,
      type: 'bot',
      sourceUserId: this.ctx.botUserId,
      folderId,
      message: `[${this.ctx.botConfig.name}] ${message}`,
    });
  }

  // ─── External HTTP (domain-restricted) ────────────────────────

  async fetchExternal(url: string, opts?: RequestInit): Promise<Response> {
    this.requireDomain(url);
    this.checkAborted();

    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(`Bot "${this.ctx.botConfig.name}": only HTTPS and HTTP URLs are allowed`);
    }
    const hostname = parsed.hostname;

    // Resolve once and pin the checked address, retaining the hostname for TLS.
    const signal = AbortSignal.any([this.ctx.signal, AbortSignal.timeout(30_000), ...(opts?.signal ? [opts.signal] : [])]);
    const resolved = await withAbort(lookup(hostname), signal);
    const resolvedAddress = resolved.address;
    const resolvedFamily = resolved.family;
    if (isPrivateIP(resolvedAddress)) {
      throw new Error(`Bot "${this.ctx.botConfig.name}" blocked from accessing private IP ${resolvedAddress} (resolved from ${hostname})`);
    }

    this.checkAborted();
    this.ctx.apiCallsMade++;
    const headers = new Headers(opts?.headers);
    if (!headers.has('user-agent')) headers.set('user-agent', 'ThreatCaddy-Bot/1.0');
    return requestPinned(parsed, { address: resolvedAddress, family: resolvedFamily }, { ...opts, headers }, { signal });
  }

  // ─── SSH Execution (execute_remote) ─────────────────────────

  async execSSH(host: string, command: string, opts?: { port?: number; timeout?: number }): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    this.requireCapability('execute_remote');
    this.checkAborted();

    const config = this.ctx.botConfig;
    const port = opts?.port ?? 22;
    const timeout = Math.min(opts?.timeout ?? 30_000, 120_000);
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isFinite(timeout) || timeout <= 0) throw new Error('Invalid SSH port or timeout');
    const MAX_OUTPUT = 50 * 1024; // 50KB per stream

    // Validate host: must be non-empty, no control chars, no whitespace, no colons (IPv6 literals), no slashes
    // eslint-disable-next-line no-control-regex, no-useless-escape -- intentional: blocking control chars and special chars in SSH hostnames
    if (!host || typeof host !== 'string' || /[\s\x00-\x1f:\/\\@]/.test(host)) {
      throw new Error(`Bot "${config.name}": invalid SSH host — must be a plain hostname or IPv4 address`);
    }

    // Host allowlist check
    const allowedHosts = (this.getConfig().allowedHosts as string[] | undefined) || [];
    if (allowedHosts.length === 0) {
      throw new Error(`Bot "${config.name}": no allowedHosts configured — SSH is blocked`);
    }
    if (!allowedHosts.includes(host)) {
      throw new Error(`Bot "${config.name}": host "${host}" not in allowedHosts. Allowed: ${allowedHosts.join(', ')}`);
    }

    // DNS resolve + private IP check (reuse SSRF guard)
    // Resolve FIRST, then verify the resolved address is allowed (prevents DNS rebinding)
    const { address } = await withAbort(lookup(host), AbortSignal.any([this.ctx.signal, AbortSignal.timeout(timeout)]));
    if (isPrivateIP(address)) {
      throw new Error(`Bot "${config.name}" blocked from SSH to private IP ${address} (resolved from ${host})`);
    }

    const operations = this.getConfig().sshOperations as Record<string, { executable?: unknown; args?: unknown }> | undefined;
    const operation = operations && Object.hasOwn(operations, command) ? operations[command] : undefined;
    if (!operation || typeof operation.executable !== 'string' || !operation.executable.startsWith('/')
      || !Array.isArray(operation.args) || operation.args.length > 50
      || [operation.executable, ...operation.args].some(value => typeof value !== 'string' || value.length > 4096 || /[\0\r\n]/.test(value))) {
      throw new Error('Configure a named sshOperations entry with an absolute executable and fixed string args; legacy command prefixes are not accepted.');
    }
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    const approvedCommand = [operation.executable, ...operation.args as string[]].map(quote).join(' ');

    // Resolve credentials from config
    const sshCreds = (this.getConfig().sshCredentials as Record<string, Record<string, string>> | undefined) || {};
    const hostCreds = sshCreds[host];
    if (!hostCreds) {
      throw new Error(`Bot "${config.name}": no SSH credentials configured for host "${host}"`);
    }
    const fingerprint = hostCreds.hostFingerprint;
    if (!hostCreds.username || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(fingerprint ?? '')) {
      throw new Error('SSH credentials require an explicit username and verified SHA256 hostFingerprint.');
    }
    this.checkAborted();

    this.ctx.apiCallsMade++;

    return new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve, reject) => {
      const conn = new SSHClient();
      let stdoutBuf = '';
      let stderrBuf = '';
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.ctx.signal.removeEventListener('abort', onAbort);
          conn.end();
          reject(new Error(`SSH command timed out after ${timeout}ms`));
        }
      }, timeout);

      const onAbort = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          this.ctx.signal.removeEventListener('abort', onAbort);
          conn.end();
          reject(new Error('Bot execution aborted'));
        }
      };
      this.ctx.signal.addEventListener('abort', onAbort, { once: true });

      conn.on('ready', () => {
        if (resolved || this.ctx.signal.aborted) { onAbort(); conn.end(); return; }
        conn.exec(approvedCommand, (err, stream) => {
          if (err) {
            resolved = true;
            clearTimeout(timer);
            this.ctx.signal.removeEventListener('abort', onAbort);
            conn.end();
            reject(err);
            return;
          }

          stream.on('data', (data: Buffer) => {
            if (stdoutBuf.length < MAX_OUTPUT) {
              stdoutBuf += data.toString('utf8').slice(0, MAX_OUTPUT - stdoutBuf.length);
            }
          });
          stream.stderr.on('data', (data: Buffer) => {
            if (stderrBuf.length < MAX_OUTPUT) {
              stderrBuf += data.toString('utf8').slice(0, MAX_OUTPUT - stderrBuf.length);
            }
          });
          stream.on('close', (code: number) => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              this.ctx.signal.removeEventListener('abort', onAbort);
              conn.end();
              // Audit the command execution
              this.audit('ssh.exec', `SSH ${host}: ${command.slice(0, 200)} → exit ${code}`).catch(() => {});
              resolve({ exitCode: code ?? 1, stdout: stdoutBuf, stderr: stderrBuf });
            }
          });
        });
      });

      conn.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          this.ctx.signal.removeEventListener('abort', onAbort);
          conn.end();
          reject(new Error(`SSH connection failed: ${err.message}`));
        }
      });

      conn.connect({
        host: address,
        port,
        username: hostCreds.username,
        hostVerifier: (key: Buffer) => {
          const actual = Buffer.from(`SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`);
          const expected = Buffer.from(fingerprint);
          return actual.length === expected.length && timingSafeEqual(actual, expected);
        },
        privateKey: hostCreds.privateKey || undefined,
        passphrase: hostCreds.passphrase || undefined,
        password: hostCreds.password || undefined,
        readyTimeout: 10_000,
      });
    });
  }

  // ─── Fetch and Poll (execute_remote) ──────────────────────────

  async fetchAndPoll(
    url: string,
    pollUrl: string,
    opts?: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      pollIntervalMs?: number;
      pollTimeoutMs?: number;
      completionPath?: string;
      completionValues?: string[];
    },
  ): Promise<{ initialResponse: { status: number; data: unknown }; pollResult: { status: number; data: unknown; pollCount: number } }> {
    this.requireCapability('execute_remote');
    this.checkAborted();

    const pollInterval = Math.max(opts?.pollIntervalMs || 5000, 2000);
    const pollTimeout = Math.min(opts?.pollTimeoutMs || 60_000, 300_000);
    const completionPath = opts?.completionPath || 'status';
    const completionValues = opts?.completionValues || ['completed', 'done', 'finished', 'success', 'failed', 'error'];

    // Initial request
    const initResponse = await this.fetchExternal(url, {
      method: opts?.method || 'POST',
      headers: opts?.headers ? { ...opts.headers } : undefined,
      body: opts?.body,
    });
    const initData = await initResponse.json().catch(() => ({})) as unknown;

    // Poll loop
    const startTime = Date.now();
    let pollCount = 0;
    let backoff = pollInterval;

    while (Date.now() - startTime < pollTimeout) {
      this.checkAborted();
      await delay(backoff, undefined, { signal: this.ctx.signal });
      pollCount++;

      const pollResponse = await this.fetchExternal(pollUrl, {
        headers: opts?.headers ? { ...opts.headers } : undefined,
      });
      const pollData = await pollResponse.json().catch(() => ({})) as Record<string, unknown>;

      // Check completion by traversing the path
      const pathParts = completionPath.split('.');
      let current: unknown = pollData;
      for (const part of pathParts) {
        if (current && typeof current === 'object') {
          current = (current as Record<string, unknown>)[part];
        } else {
          current = undefined;
          break;
        }
      }

      if (typeof current === 'string' && completionValues.includes(current.toLowerCase())) {
        await this.audit('remote.poll', `Poll completed: ${pollUrl} after ${pollCount} polls`);
        return {
          initialResponse: { status: initResponse.status, data: initData },
          pollResult: { status: pollResponse.status, data: pollData, pollCount },
        };
      }

      // Exponential backoff after 5 polls
      if (pollCount > 5 && backoff < 30_000) {
        backoff = Math.min(backoff * 1.5, 30_000);
      }
    }

    throw new Error(`Polling timed out after ${pollTimeout}ms (${pollCount} polls) for ${pollUrl}`);
  }

  // ─── Code Execution (run_code) ──────────────────────────────

  async runCode(language: string, code: string, opts?: { timeout?: number; stdin?: string }): Promise<CodeExecutionResult> {
    this.requireCapability('run_code');
    this.checkAborted();

    const result = await executeCode(language, code, {
      timeout: opts?.timeout,
      stdin: opts?.stdin,
      signal: this.ctx.signal,
    });

    await this.audit('code.execute', `Ran ${language} code (${result.durationMs}ms, exit ${result.exitCode})`).catch(() => {});

    return result;
  }

  // ─── Execution Log ───────────────────────────────────────────

  addLogEntry(entry: BotRunLogEntry): void {
    // Cap at 200 entries to prevent unbounded growth
    if (this.ctx.log.length < 200) {
      this.ctx.log.push(entry);
    }
  }

  // ─── Audit Helper ────────────────────────────────────────────

  async audit(action: string, detail: string, opts?: { itemId?: string; itemTitle?: string; folderId?: string }): Promise<void> {
    await logActivity({
      userId: this.ctx.botUserId,
      category: 'bot',
      action,
      detail: `[${this.ctx.botConfig.name}] ${detail}`,
      ...opts,
    });
  }
}
