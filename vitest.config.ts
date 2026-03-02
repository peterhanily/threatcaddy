import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/vitest.setup.ts'],
    css: false,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/vitest.setup.ts', 'src/**/*.d.ts'],
    },
  },
})
