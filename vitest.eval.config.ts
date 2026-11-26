import { mergeConfig } from 'vitest/config'
import base from './vitest.config'

// `pnpm eval:agents` only. `pnpm test:run` and CI use vitest.config.ts, whose
// default include (*.test.*, *.spec.*) never matches an *.eval.ts file.
export default mergeConfig(base, {
  test: { include: ['src/evals/**/*.eval.ts'], testTimeout: 900_000 },
})
