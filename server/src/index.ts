import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { bodyLimit } from 'hono/body-limit';
import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { sql as drizzleSql, lt } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import authRoutes from './routes/auth.js';
import syncRoutes from './routes/sync.js';
import investigationRoutes from './routes/investigations.js';
import feedRoutes from './routes/feed.js';
import llmRoutes from './routes/llm.js';
import fileRoutes from './routes/files.js';
import auditRoutes from './routes/audit.js';
import notificationRoutes from './routes/notifications.js';
import userRoutes from './routes/users.js';
import adminRoutes from './routes/admin.js';
import { initAdminSecret, initRegistrationMode, backfillFolderOwners } from './services/admin-secret.js';
import { initAdminKey } from './middleware/admin-auth.js';
import { handleWSConnection, handleWSMessage, handleWSClose } from './ws/handler.js';
import { db, sql as pgSql } from './db/index.js';
import { sessions } from './db/schema.js';
import { rateLimiter } from './middleware/rate-limit.js';
import { logger } from './lib/logger.js';

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// Configurable CORS
const allowedOriginsEnv = process.env.ALLOWED_ORIGINS?.trim();
if (!allowedOriginsEnv) {
  logger.warn('ALLOWED_ORIGINS not set — defaulting to wildcard (*). Set this in production!');
}
const corsOrigin = !allowedOriginsEnv || allowedOriginsEnv === '*'
  ? '*'
  : allowedOriginsEnv.split(',').map((o) => o.trim());

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
});

app.use('*', cors({
  origin: corsOrigin,
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  exposeHeaders: ['Content-Length'],
  maxAge: 86400,
}));
app.use('*', redactingLogger);

// Body limits — file routes get 50 MB, other API routes get 1 MB
app.use('/api/files/*', bodyLimit({ maxSize: 50 * 1024 * 1024 }));
app.use('/api/*', bodyLimit({ maxSize: 1024 * 1024 }));

// Rate limiting
app.use('/api/auth/login', rateLimiter({ windowMs: 60_000, max: 10 }));
app.use('/api/auth/register', rateLimiter({ windowMs: 60_000, max: 5 }));
app.use('/api/auth/refresh', rateLimiter({ windowMs: 60_000, max: 20 }));
app.use('/api/llm/chat', rateLimiter({ windowMs: 60_000, max: 20 }));

// Health check with DB connectivity
app.get('/health', async (c) => {
  try {
    await db.execute(drizzleSql`SELECT 1`);
    return c.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
  } catch {
    return c.json({ status: 'error', db: 'disconnected', timestamp: new Date().toISOString() }, 503);
  }
});

// API routes
app.route('/api/auth', authRoutes);
app.route('/api/sync', syncRoutes);
app.route('/api/investigations', investigationRoutes);
app.route('/api/feed', feedRoutes);
app.route('/api/llm', llmRoutes);
app.route('/api/files', fileRoutes);
app.route('/api/audit', auditRoutes);
app.route('/api/notifications', notificationRoutes);
app.route('/api/users', userRoutes);

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

// Admin security headers
adminApp.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  c.header('X-DNS-Prefetch-Control', 'off');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
});

// Admin CORS: same-origin only (block cross-origin requests)
adminApp.use('*', cors({
  origin: (origin) => origin, // Reflect origin (restrictive: only same-origin JS can reach it)
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  maxAge: 86400,
  credentials: true,
}));
adminApp.use('*', redactingLogger);
adminApp.use('/admin/api/*', bodyLimit({ maxSize: 1024 * 1024 }));
adminApp.use('/admin/api/login', rateLimiter({ windowMs: 60_000, max: 5 }));
adminApp.route('/admin', adminRoutes);

const port = parseInt(process.env.PORT || '3001', 10);
const adminPort = parseInt(process.env.ADMIN_PORT || '3002', 10);

async function main() {
  // Run database migrations
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = resolve(__dirname, 'db/migrations');
  logger.info('Running database migrations...', { migrationsFolder });
  await migrate(db, { migrationsFolder });
  logger.info('Database migrations complete');

  initAdminKey();
  await initAdminSecret();
  await initRegistrationMode();
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
    server.close();
    adminServer.close();
    await pgSql.end();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.error('Failed to start server', { error: String(err) });
  process.exit(1);
});

export default app;
