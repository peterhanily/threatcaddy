import { sql } from './index.js';
import { rotateSyncHistory } from './rotate-sync-history.js';

try {
  if (process.argv.slice(2).join(' ') !== '--confirm-restore') throw new Error('Usage: node dist/db/rotate-sync-history-cli.js --confirm-restore (in a source checkout: npm run sync:rotate-history -- --confirm-restore). Stop the server and retain a verified backup first.');
  console.log(`Sync history rotated: ${await rotateSyncHistory(sql, true)}. Clients must reconcile before uploading.`);
} finally {
  await sql.end({ timeout: 5 });
}
