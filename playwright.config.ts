import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Local runs report a first-attempt failure directly, as the CI gate does.
  retries: process.env.CI ? 1 : 0,
  // A retry is diagnostic evidence, never a substitute for a clean release gate.
  failOnFlakyTests: !!process.env.CI,
  // A broad regression stops early, and a stuck run ends with its report
  // before the per-browser CI job limit in verify.yml cancels it.
  maxFailures: process.env.CI ? 10 : 0,
  globalTimeout: process.env.CI ? 20 * 60_000 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:4173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    // CI tests the same assembled artifact that it publishes after verification.
    command: process.env.PLAYWRIGHT_SKIP_BUILD === '1'
      ? 'pnpm preview --port 4173 --strictPort'
      : 'pnpm build && pnpm preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
