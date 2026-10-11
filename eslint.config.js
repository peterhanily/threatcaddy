import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'dist-single', 'server/dist', 'extension/dist', 'coverage', 'playwright-report', 'test-results', 'docs/reviews', 'plans']),
  // Client (React + TypeScript)
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // Downgrade React Compiler rules to warnings — pre-existing patterns
      // in hooks (setState in effects, manual memoization) trigger these
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  // Server and build tooling (TypeScript, no React)
  {
    files: ['server/src/**/*.ts', 'build/**/*.{ts,tsx}'],
    ignores: ['server/src/__tests__/**'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off',
    },
  },
  // Runtime/configuration JavaScript and offline verification tooling.
  {
    files: ['*.{js,mjs,cjs}', 'scripts/**/*.{js,mjs,cjs}', 'agents/**/scripts/**/*.{js,mjs,cjs}',
      'server/scripts/**/*.{js,mjs,cjs}', 'extension/scripts/**/*.{js,mjs,cjs}', 'extension/*.{js,mjs,cjs}',
      'extension/src/__tests__/**/*.js', 'src/__tests__/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 'latest', globals: globals.node },
  },
  // These harnesses contain functions evaluated in disposable browser pages.
  {
    files: ['scripts/release-smoke.mjs', 'scripts/measure-startup.mjs', 'scripts/verify-*.mjs',
      'extension/src/__tests__/**/*.js', 'src/__tests__/**/*.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.webextensions } },
  },
  {
    files: ['extension/src/**/*.js', 'public/*.js'],
    ignores: ['extension/src/__tests__/**'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'script', globals: { ...globals.browser, ...globals.webextensions } },
  },
  // ui.js is loaded before these classic extension-page scripts.
  { files: ['extension/src/popup.js', 'extension/src/pages/clips.js'], languageOptions: { globals: { TC_UI: 'readonly' } } },
  // Test tooling has real recommended rules too; fixture assertions remain
  // warnings and are individually capped by scripts/lint-warning-baseline.json.
  {
    files: ['*.{ts,mts,cts}', 'scripts/**/*.{ts,tsx,mts,cts}', 'server/*.{ts,mts,cts}',
      'server/src/__tests__/**/*.ts', 'server/integration/**/*.ts', 'e2e/**/*.{ts,tsx}', 'standalone-tests/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 'latest', globals: { ...globals.node, ...globals.browser } },
    rules: { '@typescript-eslint/no-non-null-assertion': 'warn', '@typescript-eslint/no-explicit-any': 'warn' },
  },
  // Playwright requires a destructured first parameter even for hooks using
  // only TestInfo. Empty assignment patterns remain errors.
  { files: ['e2e/**/*.ts', 'standalone-tests/**/*.ts'], rules: { 'no-empty-pattern': ['error', { allowObjectPatternsAsParameters: true }] } },
])
