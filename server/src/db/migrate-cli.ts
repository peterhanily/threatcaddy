import { fileURLToPath } from 'node:url';
import { sql } from './index.js';
import { migrateDatabase } from './migrate.js';

try {
  await migrateDatabase(sql, fileURLToPath(new URL('./migrations', import.meta.url)));
  console.log('Database migrations complete.');
} finally {
  await sql.end({ timeout: 5 });
}
