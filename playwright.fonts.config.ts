import { defineConfig, devices } from '@playwright/test';
// The test starts and stops its own loopback origin. This URL supplies the build
// base path only; TC_FONT_TEST_OUTPUT_DIR selects an already-built directory.
// For a subpath build pass both its output directory and matching base URL.
const baseURL = process.env.TC_FONT_TEST_BASE_URL || 'http://localhost:4173/';
const target = new URL(baseURL);
if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) throw new Error('Font acceptance requires a local preview');
export default defineConfig({
  testDir: './e2e', testMatch: 'fonts.spec.ts', workers: 1, retries: 0, timeout: 60_000,
  reporter: 'list', outputDir: 'test-results/fonts',
  use: { ...devices['Desktop Chrome'], baseURL, screenshot: 'only-on-failure' },
});
