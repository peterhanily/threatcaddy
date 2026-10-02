import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './standalone-tests',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  reporter: 'list',
  outputDir: 'test-results/standalone',
  use: { ...devices['Desktop Chrome'], offline: true, screenshot: 'only-on-failure' },
});
