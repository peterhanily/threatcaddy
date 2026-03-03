import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { bodyLimit } from 'hono/body-limit';
import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { sql as drizzleSql } from 'drizzle-orm';
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
import { handleWSConnection, handleWSMessage, handleWSClose } from './ws/handler.js';
import { db, sql as pgSql } from './db/index.js';
import { rateLimiter } from './middleware/rate-limit.js';
import { logger } from './lib/logger.js';

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// Configurable CORS
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : ['*'];

app.use('*', cors({
  origin: allowedOrigins,
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  exposeHeaders: ['Content-Length'],
  maxAge: 86400,
}));
app.use('*', honoLogger((str: string, ...rest: string[]) => {
  // Redact JWT tokens from WS connection logs
  console.log(str.replace(/token=[^\s&]+/g, 'token=[REDACTED]'), ...rest);
}));

// Body limits — file routes get 50 MB, other API routes get 1 MB
app.use('/api/files/*', bodyLimit({ maxSize: 50 * 1024 * 1024 }));
app.use('/api/*', bodyLimit({ maxSize: 1024 * 1024 }));

// Rate limiting on auth endpoints
app.use('/api/auth/login', rateLimiter({ windowMs: 60_000, max: 10 }));
app.use('/api/auth/register', rateLimiter({ windowMs: 60_000, max: 5 }));

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

// WebSocket endpoint
app.get('/ws', upgradeWebSocket((c) => {
  const token = c.req.query('token') || '';
  return {
    onOpen: (_event, ws) => {
      handleWSConnection(ws, token);
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

const port = parseInt(process.env.PORT || '3001', 10);

async function main() {
  // Run database migrations
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = resolve(__dirname, 'db/migrations');
  logger.info('Running database migrations...', { migrationsFolder });
  await migrate(db, { migrationsFolder });
  logger.info('Database migrations complete');

  const server = serve({
    fetch: app.fetch,
    port,
  }, (info) => {
    logger.info(`Server running on http://localhost:${info.port}`, { port: info.port });
  });

  injectWebSocket(server);

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    server.close();
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
