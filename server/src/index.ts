import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { bodyLimit } from 'hono/body-limit';
import { compress } from 'hono/compress';
import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { sql as drizzleSql, lt } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { access, readFile } from 'node:fs/promises';

import authRoutes from './routes/auth.js';
import syncRoutes from './routes/sync.js';
import investigationRoutes from './routes/investigations.js';
import caddyshackRoutes from './routes/caddyshack.js';
import llmRoutes from './routes/llm.js';
import fileRoutes from './routes/files.js';
import backupRoutes from './routes/backups.js';
import auditRoutes from './routes/audit.js';
import notificationRoutes from './routes/notifications.js';
import userRoutes from './routes/users.js';
import botRoutes from './routes/bots.js';
import integrationRoutes from './routes/integrations.js';
import savedSearchRoutes from './routes/saved-searches.js';
import taxiiRoutes from './routes/taxii.js';
import adminRoutes from './routes/admin/index.js';
import { botManager } from './bots/bot-manager.js';
import { prePullSandboxImages } from './bots/sandbox.js';
import { initAdminSecret, initRegistrationMode, initServerName, getServerName, backfillFolderOwners, initAdminSystemUser } from './services/admin-secret.js';
import { pruneOldData } from './services/cleanup-service.js';
import { initAdminKey } from './middleware/admin-auth.js';
import { handleWSConnection, handleWSMessage, handleWSClose } from './ws/handler.js';
import { db, sql as pgSql } from './db/index.js';
import { sessions } from './db/schema.js';
import { rateLimiter } from './middleware/rate-limit.js';
import { requestId } from './middleware/request-id.js';
import { globalErrorHandler } from './middleware/error-handler.js';
import { logger } from './lib/logger.js';

const app = new Hono();
app.onError(globalErrorHandler);
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// Configurable CORS
const allowedOriginsEnv = process.env.ALLOWED_ORIGINS?.trim();
if (!allowedOriginsEnv) {
  logger.warn('ALLOWED_ORIGINS not set — CORS will deny all cross-origin requests. Set this env var to allow origins.');
}
const corsOrigin: string | string[] = allowedOriginsEnv === '*'
  ? '*'
  : allowedOriginsEnv
    ? allowedOriginsEnv.split(',').map((o) => o.trim())
    : [];

const redactingLogger = honoLogger((str: string, ...rest: string[]) => {
  console.log(str.replace(/token=[^\s&]+/g, 'token=[REDACTED]'), ...rest);
});

// ─── Security headers ──────────────────────────────────────────
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  c.header('X-DNS-Prefetch-Control', 'off');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
});

app.use('*', requestId);
app.use('*', cors({
  origin: corsOrigin,
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  exposeHeaders: ['Content-Length'],
  maxAge: 86400,
}));
app.use('*', redactingLogger);
app.use('*', compress());

// Body limits — file/backup routes get larger limits, other API routes get 1 MB
app.use('/api/files/*', bodyLimit({ maxSize: 50 * 1024 * 1024 }));
app.use('/api/backups/*', bodyLimit({ maxSize: 100 * 1024 * 1024 }));
app.use('/api/*', bodyLimit({ maxSize: 1024 * 1024 }));

// Rate limiting
app.use('/api/auth/login', rateLimiter({ windowMs: 60_000, max: 10 }));
app.use('/api/auth/register', rateLimiter({ windowMs: 60_000, max: 5 }));
app.use('/api/auth/refresh', rateLimiter({ windowMs: 60_000, max: 20 }));
app.use('/api/llm/chat', rateLimiter({ windowMs: 60_000, max: 20 }));
app.use('/api/caddyshack/posts', rateLimiter({ windowMs: 60_000, max: 30 }));
app.use('/api/backups', rateLimiter({ windowMs: 60_000, max: 5 }));
app.use('/api/bots/*/webhook', rateLimiter({ windowMs: 60_000, max: 30 }));

// Read version once at startup
let serverVersion = 'unknown';
try {
  const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../package.json');
  const pkgRaw = await readFile(pkgPath, 'utf-8');
  serverVersion = (JSON.parse(pkgRaw) as { version?: string }).version ?? 'unknown';
} catch { /* leave as unknown */ }

// Health check with DB connectivity, file storage, memory & uptime
app.get('/health', async (c) => {
  const checks: Record<string, string> = {};

  // DB check with 5-second timeout
  try {
    const dbResult = await Promise.race([
      db.execute(drizzleSql`SELECT 1`).then(() => 'connected' as const),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 5000)),
    ]);
    checks.db = dbResult;
  } catch {
    checks.db = 'disconnected';
  }

  // File storage check
  const storagePath = process.env.FILE_STORAGE_PATH || '/data/files';
  try {
    await access(storagePath);
    checks.storage = 'accessible';
  } catch {
    checks.storage = 'inaccessible';
  }

  const ok = Object.values(checks).every(v => v === 'connected' || v === 'accessible');

  const mem = process.memoryUsage();
  return c.json({
    status: ok ? 'ok' : 'degraded',
    ...checks,
    version: serverVersion,
    uptime: Math.round(process.uptime()),
    memory: {
      rss: Math.round(mem.rss / 1024 / 1024),
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
    },
    timestamp: new Date().toISOString(),
  }, ok ? 200 : 503);
});

// Public server info (no auth required — needed by CaddyShack)
app.get('/api/server/info', async (c) => {
  const serverName = await getServerName();
  return c.json({ serverName });
});

// API routes
app.route('/api/auth', authRoutes);
app.route('/api/sync', syncRoutes);
app.route('/api/investigations', investigationRoutes);
app.route('/api/caddyshack', caddyshackRoutes);
app.route('/api/llm', llmRoutes);
app.route('/api/files', fileRoutes);
app.route('/api/backups', backupRoutes);
app.route('/api/audit', auditRoutes);
app.route('/api/notifications', notificationRoutes);
app.route('/api/users', userRoutes);
app.route('/api/bots', botRoutes);
app.route('/api/integrations', integrationRoutes);
app.route('/api/saved-searches', savedSearchRoutes);
app.route('/api/taxii', taxiiRoutes);

// WebSocket endpoint — token sent as first message, not in URL
app.get('/ws', upgradeWebSocket(() => {
  return {
    onOpen: (_event, ws) => {
      handleWSConnection(ws);
    },
    onMessage: (event, ws) => {
      const data = typeof event.data === 'string' ? event.data : event.data.toString();
      void handleWSMessage(ws, data);
    },
    onClose: (_event, ws) => {
      handleWSClose(ws);
    },
  };
}));

// ─── Admin panel on a separate port ─────────────────────────────
const adminApp = new Hono();
adminApp.onError(globalErrorHandler);

// Admin security headers
adminApp.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  c.header('X-DNS-Prefetch-Control', 'off');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
});

adminApp.use('*', requestId);

// Admin CORS: reject all cross-origin requests (admin UI is same-origin)
adminApp.use('*', cors({
  origin: (origin) => {
    const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const adminPort = process.env.ADMIN_PORT || '3002';
    allowed.push(`http://localhost:${adminPort}`, `http://127.0.0.1:${adminPort}`);
    return allowed.includes(origin) ? origin : '';
  },
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  maxAge: 86400,
  credentials: true,
}));
adminApp.use('*', redactingLogger);
adminApp.use('*', compress());
adminApp.use('/admin/api/*', bodyLimit({ maxSize: 1024 * 1024 }));
adminApp.use('/admin/api/login', rateLimiter({ windowMs: 60_000, max: 5 }));
adminApp.route('/admin', adminRoutes);

const port = parseInt(process.env.PORT || '3001', 10);
const adminPort = parseInt(process.env.ADMIN_PORT || '3002', 10);

async function main() {
  // Validate required environment variables
  const requiredEnvVars = ['JWT_PRIVATE_KEY', 'JWT_PUBLIC_KEY', 'DATABASE_URL'] as const;
  const missing = requiredEnvVars.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    logger.error(`Missing required environment variables: ${missing.join(', ')}`);
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  if (process.env.NODE_ENV === 'production' && !process.env.BOT_MASTER_KEY) {
    logger.warn(
      'BOT_MASTER_KEY is not set in production. Bot secrets will use a random key that ' +
      'will NOT survive server restarts — any previously encrypted secrets will become unreadable. ' +
      'Set BOT_MASTER_KEY to a stable 64-char hex string.',
    );
  }

  // Run database migrations
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = resolve(__dirname, 'db/migrations');
  logger.info('Running database migrations...', { migrationsFolder });
  await migrate(db, { migrationsFolder });
  logger.info('Database migrations complete');

  initAdminKey();
  await initAdminSecret();
  await initAdminSystemUser();
  await initRegistrationMode();
  await initServerName();
  await backfillFolderOwners();

  const server = serve({
    fetch: app.fetch,
    port,
  }, (info) => {
    logger.info(`Server running on http://localhost:${info.port}`, { port: info.port });
  });

  injectWebSocket(server);

  const adminServer = serve({
    fetch: adminApp.fetch,
    port: adminPort,
  }, (info) => {
    logger.info(`Admin panel running on http://localhost:${info.port}`, { port: info.port });
  });

  // Initialize bot runtime
  await botManager.init();

  // Pre-pull Docker sandbox images (fire-and-forget — don't block startup)
  prePullSandboxImages().catch(() => {});

  // Data pruning on startup (fire-and-forget) + every 6 hours
  pruneOldData().catch(() => {});
  const dataPruning = setInterval(() => {
    pruneOldData().catch(() => {});
  }, 6 * 60 * 60 * 1000);
  dataPruning.unref();

  // Periodic expired session cleanup (every hour)
  const sessionCleanup = setInterval(async () => {
    try {
      const result = await db
        .delete(sessions)
        .where(lt(sessions.expiresAt, new Date()))
        .returning({ id: sessions.id });
      if (result.length > 0) {
        logger.info(`Cleaned up ${result.length} expired session(s)`);
      }
    } catch (err) {
      logger.error('Session cleanup failed', { error: String(err) });
    }
  }, 60 * 60 * 1000);
  sessionCleanup.unref();

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    clearInterval(sessionCleanup);
    clearInterval(dataPruning);
    await botManager.shutdown();
    server.close();
    adminServer.close();
    await pgSql.end();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// ─── Process-level error tracking ────────────────────────────────
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', {
    error: String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

main().catch((err) => {
  logger.error('Failed to start server', { error: String(err) });
  process.exit(1);
});

export default app;
