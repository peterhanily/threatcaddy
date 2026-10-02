# Development and verification

The supported baseline is Node **24.21.0**, pnpm **10.29.1** for the client,
and npm **11.19.0** for the server and extension. `.node-version`, `.nvmrc`,
`packageManager`, and `engines` record this baseline. Keep TypeScript on the
existing 5.9 line until its compiler and lint dependencies can move together.

Run these commands from the repository root after selecting the recorded Node
version (`nvm install` once, then `nvm use`, when using nvm). Running a new login shell in a subdirectory
can select a different system Node; verify `node --version` and `npm --version`.

The 2 October runtime refresh stays on Node 24 LTS and includes the security
maintenance after the old 24.13 baseline. Node's bundled OpenSSL/HTTP runtime
is not covered by npm lockfile audits. See the official
[24.21.0 release](https://nodejs.org/en/blog/release/v24.21.0) and
[24.18.1 security release](https://nodejs.org/en/blog/release/v24.18.1).
Both Docker stages use the verified official 24.21.0 Alpine image digest.

```sh
pnpm install --frozen-lockfile
npm --prefix server ci
npm --prefix extension ci

pnpm lint
pnpm test:run
npm run test:server
npm run test:extension
pnpm build
pnpm build:single
npm --prefix server run build
npm run build:extension
pnpm exec playwright install chromium firefox webkit
PLAYWRIGHT_SKIP_BUILD=1 pnpm test:e2e
pnpm exec playwright test --config playwright.standalone.config.ts
```

The extension test command uses the client's locked Vitest installation, so
install the client first. It never downloads a test runner on demand. Normal
server unit tests only discover `src/**/*.test.ts`; PostgreSQL integration
tests require the separate command below and an explicit scratch target.

## PostgreSQL integration

Use PostgreSQL 17 and a disposable local coordinator database named
`threatcaddy_test` or `threatcaddy_test_*`. Its user must be allowed to create
databases. The harness creates randomly named databases, applies frozen
historical fixtures and current production migrations, and drops its own
scratch databases afterward. It does not read the application's `.env`.

```sh
npm --prefix server run test:integration:types
TEST_DATABASE_URL=postgres://tc_test:tc_test_password@127.0.0.1:5432/threatcaddy_test npm run test:integration
```

The example password is for an isolated local test cluster only. Never provide
a production connection string. Missing, remote, or incorrectly named targets
are rejected. The integration suite checks schema parity, historical upgrades,
preservation, reruns, and the actual compiled server's boot and restart.
See [the fixture inventory](../server/integration/README.md) for supported states
and outstanding migration failures.

## Publication

CI and both deployment workflows call the same required verification workflow.
All required jobs must succeed. High and critical advisories in any of the
three complete dependency graphs also block publication; audit errors do not
become successful checks. Scheduled audits retain their evidence.

Publication promotes the artifacts built and tested for that exact revision;
it does not rebuild them with deployment credentials. `pnpm deploy` dispatches
the gated Pages workflow through the GitHub CLI. It no longer downloads an
unpinned publisher or uploads an unchecked local build.

Pages must use **Settings → Pages → Source → GitHub Actions**. The publication
workflow checks this setting and fails with instructions when it is different.
Preserve the existing custom-domain and DNS settings during that one-time
change. Local development and test commands do not change repository settings
or publish anything.

The hosted browser suite covers Chromium, Firefox and WebKit. Its offline test
stops its own temporary HTTP origin before cached reload and new-tab checks;
it does not equate browser offline emulation with a verified network outage.
The standalone suite copies only the generated HTML into an empty temporary
directory and uses a fresh offline browser profile.

## Installed extension acceptance

After building the extension, run the disposable-profile checks with locally
installed Chrome and Firefox:

```sh
node scripts/verify-extension-chrome.mjs
node scripts/verify-extension-firefox.mjs
```

`CHROME_BIN` and `FIREFOX_BIN` can override the browser locations. The fixtures
use synthetic loopback origins and fresh profiles, check exact-origin pairing
and revocation, and verify explicit failure when notification permission is
absent. Firefox also checks positive browser API acceptance. Chrome's positive
native notification permission and actual operating-system notification display
still require manual acceptance; neither harness opens an existing user profile.

Before upgrading an existing server, rehearse migration on an authorized,
backed-up copy and follow [sync recovery](../server/docs/sync-recovery.md).
Private review notes, plans and local evidence are excluded from publication.
