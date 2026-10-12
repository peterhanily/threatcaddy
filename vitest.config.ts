import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/vitest.setup.ts'],
    // Node-owned script tests have a separate required CI command; they must not
    // be loaded into Vitest's jsdom environment or run twice under two runners.
    exclude: ['server/**', 'node_modules/**', 'e2e/**', 'standalone-tests/**', 'scripts/**/*.test.mjs', 'dist/**', 'dist-single/**', '.claude/**'],
    css: false,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/vitest.setup.ts', 'src/**/*.d.ts'],
    },
  },
})
