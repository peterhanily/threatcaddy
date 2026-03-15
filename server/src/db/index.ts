import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString && process.env.NODE_ENV !== 'test') {
  throw new Error('DATABASE_URL environment variable is required. Set it in your .env file.');
}

const sql = postgres(connectionString || 'postgres://localhost:5432/test', { max: 20 });
export const db = drizzle(sql, { schema });

export { schema, sql };
export type DB = typeof db;
