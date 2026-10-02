import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Do not load application .env files. The harness accepts TEST_DATABASE_URL only.
  envDir: false,
  test: {
    include: ['integration/**/*.integration.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 45_000,
    hookTimeout: 30_000,
  },
});
