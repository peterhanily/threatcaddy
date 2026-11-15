import { afterEach, expect, it, vi } from 'vitest';

const end = vi.hoisted(() => vi.fn(async () => undefined));
const rotate = vi.hoisted(() => vi.fn(async () => 'synthetic-generation'));
vi.mock('../db/index.js', () => ({ sql: { end } }));
vi.mock('../db/rotate-sync-history.js', () => ({ rotateSyncHistory: rotate }));

const argv = process.argv;
afterEach(() => { process.argv = argv; });

it('prints a usage line that works in the npm-free image and does not rotate without confirmation', async () => {
  process.argv = [argv[0], 'dist/db/rotate-sync-history-cli.js', '--confirm-restor'];
  await expect(import('../db/rotate-sync-history-cli.js')).rejects
    .toThrow(/^Usage: node dist\/db\/rotate-sync-history-cli\.js --confirm-restore/);
  expect(rotate).not.toHaveBeenCalled();
  expect(end).toHaveBeenCalledOnce();
});
