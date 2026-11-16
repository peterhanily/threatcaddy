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
  use: { ...devices['Desktop Chrome'], offline: true, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  // WebKit workers at a file:// origin cannot read a posted File or Blob, which
  // broke every standalone evidence import there; keep that engine covered.
  projects: [{ name: 'chromium' }, { name: 'webkit', use: { ...devices['Desktop Safari'] } }],
});
