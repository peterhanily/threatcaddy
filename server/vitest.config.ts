import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Inline jose so Uint8Array instanceof checks work correctly
    deps: {
      optimizer: {
        ssr: {
          include: ['jose'],
        },
      },
    },
  },
});
