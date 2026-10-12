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

Start with [CONTRIBUTING.md](../CONTRIBUTING.md) for change scope and review,
[SECURITY.md](../SECURITY.md) for vulnerability reporting, and
[repository maintenance](repository-maintenance.md) for maintainer release checks.
The root [`.env.example`](../.env.example) is for Docker Compose; the separate
[`server/.env.example`](../server/.env.example) is for direct server execution.
Do not copy real credentials into tests or commit either local `.env` file.

```sh
pnpm install --frozen-lockfile
npm --prefix server ci
npm --prefix extension ci

pnpm lint
pnpm locales:check
pnpm test:ci
pnpm exec tsc -b
pnpm test:run
npm run test:server
npm run test:extension
pnpm build
pnpm build:single
cp dist-single/index.html dist/threatcaddy-standalone.html
touch dist/.nojekyll
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

## Installed-extension clip recovery

After building the hosted app and both extensions, the local acceptance runners
exercise the real extension/background bridge and the app's IndexedDB writes:

```sh
node scripts/verify-clip-delivery-chrome.mjs
node scripts/verify-clip-delivery-firefox.mjs
```

They require installed Chrome and Firefox (override discovery with `CHROME_BIN`
or `FIREFOX_BIN`), create disposable profiles and loopback origins, and block
external browser traffic through a deny-only proxy. They never use your normal
browser profile, production investigations, or notification permission. Evidence
and screenshots stay in the temporary directory printed at startup; do not
include that directory in a release.

Coverage includes concurrent saves, the 500-clip limit, retained popup drafts,
explicit workspace confirmation, multi-batch imports, duplicate and partial
recovery, changed destinations, revoked approvals, and encrypted workspace
lock/unlock. Permission grants in these disposable profiles are test setup, not
proof that native permission dialogs or operating-system notifications work.
Those remain separate human checks. Run the ordinary unit suites too: they
cover storage failures, worker restart, stale acknowledgements and cancellation
at deterministic boundaries that the installed-browser checks do not simulate.

## Client lifecycle checks

The hosted suite's `e2e/client-lifecycle.spec.ts` exercises startup file delivery,
encrypted lock/unlock, workspace switching, bounded image attachments, signed-out
local edits and paused legacy sync history in Chromium, Firefox and WebKit.
Its files, accounts and responses are synthetic; no provider calls are needed.
After building the hosted app and extensions, also run:

```sh
node scripts/verify-client-lifecycle.mjs chrome
node scripts/verify-client-lifecycle.mjs firefox
```

These disposable-profile checks exercise the actual popup and Clips-page
local-AI approval controls, including a port-bearing origin, restoring saved
values, app-only updates and explicit removal. They compare host grants before
and after updates, but do not assert native permission-dialog behavior.

Local Markdown/text imports retain at most 20 file handles in this tab and read
only when the workspace is unlocked. Each file is limited to 5 MiB, and a read
has a 30-second deadline. Invalid, over-capacity or failed imports are reported;
reopen the original file to retry. The original file is never modified. Queued
handles are not crash recovery and are not stored in backups or synced.

Unsent CaddyAI text and accepted images belong to their originating conversation
and survive view changes in memory. They are not persisted, backed up or synced,
and closing/reloading the tab can lose them. Each draft accepts 200,000 text
characters and four PNG/JPEG/GIF/WebP images (5 MiB per file, 10 MiB total). Across
all drafts in a tab, limits are 1,000,000 text characters, 16 images and 20 MiB of
image data. Pending reads reserve capacity before reading. Finish the work or
explicitly discard unsent drafts before switching workspaces or preparing a
data snapshot. Browser unload warnings are advisory, not durable storage.

A previously bound workspace captures local changes even while signed out; it
does not transmit them without the matching server/account session. Upgrades
with potentially incomplete historical capture pause sync before applying or
pushing data. Recovery requires a verified encrypted archive and explicit
reconciliation. The current local row supersedes stale queued versions;
ambiguous missing rows block recovery rather than inventing deletes. Historical
deletions that were never captured cannot be reconstructed automatically.

Integration cancellation propagates through request waits, retry delays, bridge
requests and known local write transactions. A canceled run cannot start later
outputs, but earlier committed writes remain and are reported in its counts.
Cancellation is not rollback of work already committed or of a request already
processed by a remote service. Deterministic unit tests cover commit/abort races
that browser checks cannot reliably schedule.

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

Each main push runs the required verification workflow **once**, through CI.
Only its successful main-push run can automatically call the reusable Pages
and server publishers; pull requests, scheduled audits and manual CI runs are
verification-only. Explicit manual Pages/server deployment workflows remain
available and each performs its own full verification before using those same
publishers. All required jobs must succeed. High and critical advisories in any of the
three complete dependency graphs also block publication; audit errors do not
become successful checks. Scheduled audits retain their evidence.

Publication promotes the artifacts built and tested for that exact revision;
it does not rebuild them with deployment credentials. `pnpm deploy` dispatches
the gated Pages workflow through the GitHub CLI. It no longer downloads an
unpinned publisher or uploads an unchecked local build.

Automatic server image publication retains its existing path scope:
`server/**`, `.github/workflows/**`, `scripts/ci-*.mjs` and `.node-version`.
The existing client-check job computes the complete main-push before/after Git
diff, including multi-commit pushes, deletions and renames out of those paths.
Unavailable comparison history conservatively includes server publication
instead of silently skipping it; every normal verification and source-identity
gate still applies. An explicit manual server deployment does not require a
matching path change. Image publication updates GHCR, not a running team server.
If a server-changing main revision is superseded before promotion, the latest-main
guard rejects it. A subsequent client-only push does not automatically publish
that server change; use the gated manual server workflow if promotion is needed.

Verification has read-only repository permissions. Write permissions are scoped
to main-only publication jobs, which download immutable artifact IDs from the
same run, verify source identity/checksums and reject a superseded main revision.
No cross-run `workflow_run` handoff, inherited secrets or privileged rebuild is
used. A shared Pages workflow lock spans both publication and its production
smoke check; manual and automatic releases cannot replace the live bytes during
that check. Server publication has its own shared lock. Main runs are not
canceled in progress; superseded PR verification may be canceled, with manual
and scheduled CI runs in separate concurrency groups.

Run `pnpm test:ci` for parsed-workflow trust-boundary contracts, executable input
and publication-gate checks, isolated Git release-scope fixtures, and the
documented sync/feed schema and blank environment-template contracts. These
Node-owned tests have a separate required CI step; Vitest does not discover them.
`actionlint` can additionally validate all workflow syntax and reusable wiring.

Pages must use **Settings → Pages → Source → GitHub Actions**. The publication
workflow checks this setting and fails with instructions when it is different.
Preserve the existing custom-domain and DNS settings during that one-time
change. Local development and test commands do not change repository settings
or publish anything.

The hosted browser suite covers Chromium, Firefox and WebKit. Its offline test
stops its own temporary HTTP origin before cached reload and new-tab checks;
it does not equate browser offline emulation with a verified network outage.
The standalone suite copies only the assembled download,
`dist/threatcaddy-standalone.html`, into an empty temporary directory and uses a
fresh offline browser profile. Assemble that file before running the suite, as
shown above; testing only `dist-single/index.html` would not verify the file that
is packaged for publication.

### Post-deployment verification

After Pages publication, a separate read-only job downloads the same immutable
client artifact by ID and checks the live HTTPS site against it. It does not
rebuild the app or derive expected hashes from production. The checks use fresh
disposable browser contexts and synthetic local data only: hosted save/reload,
service-worker activation and offline recovery, and a downloaded standalone HTML
file opened offline without sibling assets. Third-party requests, network writes
and WebSockets are disallowed.

Run the contract tests locally with `pnpm test:release:unit`. An explicitly
targeted release check uses this layout and command:

```text
verified-client/
  source-sha.txt
  client.tar
  client.tar.sha256
```

The checker validates the source identity, archive checksum and member paths
before extracting into its own disposable directory. Do not pre-extract an
unchecked archive. An optional existing `site/` copy is accepted only if every
file matches the verified archive.

```sh
pnpm test:release --url https://YOUR-APP.example/ \
  --source-sha APPROVED_40_CHARACTER_COMMIT_SHA --artifact-dir verified-client
```

Use an artifact from the approved deployment, not a locally rebuilt substitute.
Only CDN propagation is retried within a fixed deadline; browser assertions are
not retried into success. Evidence is written to ignored
`test-results/release-smoke/` and retained separately from the published site.
The job has no Pages or package-write permissions. A failure here means
**published, but post-deployment verification failed**; it does not claim the
site was never deployed or automatically roll it back.

The standalone build uses `build/standalone-html.ts` to combine exactly one
entry script and at most one stylesheet. Unexpected emitted assets, external
imports, ambiguous HTML attributes or unsafe script/style embedding fail the
build. This replaces the glob-based single-file plugin. The narrow Excalidraw
Sass override removes the other transitive `braces` dependency path; neither
change suppresses an audit finding or bypasses the package-age policy. See
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).

Hosted and standalone builds also verify the versions of the math and locale
modules actually emitted by Rollup. Package-relative provenance reports stay in
`node_modules/.cache/threatcaddy/`, outside the published site. Browser acceptance
checks real HTTP locale loading, regional RTL selection, Mermaid math rendering,
whiteboard conversion/persistence, and PNG export. The converter currently keeps
formula labels as literal TeX in the editable whiteboard and exported PNG; these
checks preserve that existing behavior, not typeset-export support. The tested
browser engines use native MathML; legacy non-MathML rendering needs separate
qualification.

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

For that human-assisted Chrome check, run:

```sh
node scripts/verify-extension-chrome-manual.mjs
```

Follow its four steps in the separate Chrome window: approve the synthetic app
and Chrome's local-site prompt; wait for the denied-notification check; enable
desktop notifications and allow the native prompt; record whether the actual
OS notification appeared, then revoke all app connections. Do not enable AI or
URL-fetch access. Check only prompts you actually saw, and do not mistake browser
API acceptance for desktop display. If display is suppressed by OS settings,
report it as incomplete instead of marking the check passed.

The script uses a new temporary profile, never changes an existing profile or
OS settings, and removes its profile after closing Chrome. It prints the local
`result.json` path with the overall outcome, completed checks, API responses,
human observations and any failure. That local receipt is not a release artifact.

Before upgrading an existing server, rehearse migration on an authorized,
backed-up copy and follow [sync recovery](../server/docs/sync-recovery.md).
Private review notes, plans and local evidence are excluded from publication.
