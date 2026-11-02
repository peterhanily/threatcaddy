import { defineConfig } from 'vitest/config';

// Run only through scripts/test-validation-resources.mjs: its external deadline
// can stop synchronous validation even when the worker event loop is blocked.
export default defineConfig({
  // The child receives only its synthetic fixture environment.
  envDir: false,
  test: {
    include: ['resource/validation-resource.fixture.ts'],
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
    execArgv: ['--max-old-space-size=512', '--expose-gc'],
    testTimeout: 9_000,
    deps: { optimizer: { ssr: { include: ['jose'] } } },
  },
});
