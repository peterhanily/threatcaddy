import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../lib/logger.js';

/** Where a generated bootstrap secret is written for the operator to read once. */
export function bootstrapSecretFilePath(): string {
  return join(process.env.FILE_STORAGE_PATH || '/data/files', '.admin-secret');
}

/**
 * Once an administrator exists the plaintext is no longer needed, and the file
 * volume is backed up with the database, so delete it. The stored hash does not
 * change: a copy the operator kept still works, and ADMIN_SECRET replaces it at
 * the next restart.
 */
export async function removeBootstrapSecretFile(): Promise<void> {
  const path = bootstrapSecretFilePath();
  try {
    await unlink(path);
    logger.info(`Removed the generated admin bootstrap secret file ${path} because an administrator exists. If every administrator is lost, set ADMIN_SECRET and restart to create one again`);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') logger.warn(`Could not remove the admin bootstrap secret file ${path}; delete it manually`, { code });
  }
}
