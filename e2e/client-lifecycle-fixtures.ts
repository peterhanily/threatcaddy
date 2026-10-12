import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { expect, type Page } from '@playwright/test';

export type Rows = Record<string, Array<Record<string, unknown>>>;
export type LaunchedFile = { name: string; content?: string; size?: number; deferred?: boolean; fail?: boolean };
type LaunchHarness = {
  enqueue(files: LaunchedFile[]): void;
  reads: Record<string, number>;
  releaseFiles(): void;
};
export type LaunchWindow = Window & typeof globalThis & { __lifecycleLaunch: LaunchHarness };
export const workspacePassword = 'fictional-lifecycle-workspace-password';

/** Only the browser's LaunchQueue/file-handle boundary is simulated. The app
 * receives native Files and uses its production reader and IndexedDB path. */
export async function installLaunchQueue(page: Page, initial: LaunchedFile[] = []) {
  await page.addInitScript(initial => {
    let consumer: ((params: { files: Array<{ getFile(): Promise<File> }> }) => unknown) | undefined;
    const releases: Array<() => void> = [];
    const reads = JSON.parse(sessionStorage.getItem('lifecycle-file-reads') || '{}') as Record<string, number>;
    const harness: LaunchHarness = {
      reads,
      releaseFiles() { for (const release of releases.splice(0)) release(); },
      enqueue(files) {
        if (!consumer) throw new Error('Launch consumer is not installed');
        consumer({ files: files.map(spec => ({
          name: spec.name, kind: 'file',
          async getFile() {
            reads[spec.name] = (reads[spec.name] || 0) + 1;
            sessionStorage.setItem('lifecycle-file-reads', JSON.stringify(reads));
            if (spec.fail) throw new DOMException('Synthetic file is no longer readable', 'NotReadableError');
            const file = new File([spec.size ? new Uint8Array(spec.size) : spec.content || ''], spec.name, {
              type: 'text/plain', lastModified: 1_740_000_000_000,
            });
            if (spec.deferred) await new Promise<void>(resolve => releases.push(resolve));
            return file;
          },
        })) });
      },
    };
    (window as LaunchWindow).__lifecycleLaunch = harness;
    Object.defineProperty(window, 'launchQueue', { configurable: true, value: {
      setConsumer(callback: typeof consumer) {
        consumer = callback;
        if (!sessionStorage.getItem('lifecycle-initial-launch')) {
          sessionStorage.setItem('lifecycle-initial-launch', '1');
          if (initial.length) harness.enqueue(initial);
        }
        const next: LaunchedFile[] = JSON.parse(sessionStorage.getItem('lifecycle-next-launch') || '[]');
        sessionStorage.removeItem('lifecycle-next-launch');
        if (next.length) harness.enqueue(next);
      },
    } });
  }, initial);
}

export async function readRows(page: Page, tables: string[], databaseName?: string): Promise<Rows> {
  return page.evaluate(({ tables, databaseName }) => new Promise<Rows>((resolve, reject) => {
    const workspace = sessionStorage.getItem('threatcaddy-active-workspace');
    const request = indexedDB.open(databaseName || (workspace && workspace !== 'default' ? `ThreatCaddyDB:${workspace}` : 'ThreatCaddyDB'));
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => { request.transaction?.abort(); reject(new Error('Expected an existing application database')); };
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(tables, 'readonly');
      const rows: Rows = {};
      transaction.oncomplete = () => { database.close(); resolve(rows); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
      for (const table of tables) {
        const read = transaction.objectStore(table).getAll();
        read.onsuccess = () => { rows[table] = read.result; };
      }
    };
  }), { tables, databaseName });
}

export async function seedRows(page: Page, rows: Rows) {
  await page.evaluate(rows => new Promise<void>((resolve, reject) => {
    if (localStorage.getItem('threatcaddy-encryption')) throw new Error('Do not seed plaintext into an encrypted workspace');
    const request = indexedDB.open('ThreatCaddyDB');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(Object.keys(rows), 'readwrite');
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
      for (const [table, records] of Object.entries(rows)) for (const record of records) transaction.objectStore(table).put(record);
    };
  }), rows);
}

export async function enableEncryption(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Data', exact: true }).click();
  await page.getByRole('button', { name: 'Enable Encryption', exact: true }).click();
  const setup = page.getByRole('dialog', { name: 'Enable Encryption', exact: true });
  await setup.getByPlaceholder('Enter passphrase...', { exact: true }).fill(workspacePassword);
  await setup.getByPlaceholder('Confirm passphrase...', { exact: true }).fill(workspacePassword);
  await setup.getByRole('button', { name: 'Continue', exact: true }).click();
  await setup.getByRole('checkbox', { name: "I've saved this recovery key in a secure location", exact: true }).check();
  await setup.getByRole('button', { name: 'Enable Encryption', exact: true }).click();
  await expect(setup).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText('Encryption is enabled', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
}

export async function exportBackup(page: Page): Promise<Rows> {
  const [download] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('button', { name: 'Save Backup', exact: true }).click(),
  ]);
  const path = await download.path();
  if (!path) throw new Error('Expected real browser backup download');
  return JSON.parse(await readFile(path, 'utf8')) as Rows;
}

/** Deterministic valid raster with incompressible pixels, not a large string
 * disguised as an image. 512 square produces a little over 1 MiB of PNG. */
export function pngFixture(side = 512): Buffer {
  const chunk = (name: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(name), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(side); header.writeUInt32BE(side, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc(side * (1 + side * 4));
  let random = 0x12345678;
  for (let row = 0; row < side; row++) for (let column = 1; column <= side * 4; column++) {
    random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
    pixels[row * (1 + side * 4) + column] = random & 0xff;
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
