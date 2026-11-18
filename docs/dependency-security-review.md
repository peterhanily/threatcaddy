# Dependency and code-scanning review — 2 November 2026

Keep the complete audit and publication gates enabled. Settings, repository
changes, published artifacts and running server deployments are separate states.

## 18 November 2026 picomatch audit exception

GitHub reviewed [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)
on 17 November: picomatch backtracks exponentially on single-branch repeated
extglobs such as `+(*)` (ReDoS, CWE-1333, CVSS 7.5, high). Every release up to
4.0.7, the latest, is affected, and no patched version exists. npm's only
suggested fix downgrades Vitest to 3.1.4, against the exact 5.0.5 alignment
below. Since then the root and server audits report it and exit 1; the
extension audit is clean.

This advisory is the only exception. `scripts/dependency-audit-exceptions.json`
lists it for the root and server audits with its reason, review date and end
condition. picomatch matches glob patterns that this repository controls, in
lint, build and test tooling: TypeScript ESLint, tinyglobby, fdir, Rollup plugin
utilities, Vite and Vitest. In the server it is a development dependency only.
The runtime image installs production dependencies, removes npm and is scanned
separately by Trivy. The root lockfile also classifies one path as production:
Excalidraw declares Sass as a dependency, and Sass's optional `@parcel/watcher` uses
picomatch only for Sass's `--watch` command. ThreatCaddy has no Sass sources,
and the client bundle contains none of these three packages.

The audit commands are unchanged: complete graphs, `--audit-level=high`, no
omitted dependency types and no tolerance for registry errors.
`scripts/ci-dependency-audit.mjs` reads their JSON output. It accepts a failing
audit only when every high or critical advisory is listed for that project and
still matches its review. The job fails on any other high or critical advisory,
on an audit or registry error, when the advisory's range or severity changes,
and once it is no longer reported. It fails once a fix exists: pnpm reports a
patched version, or npm finds a published picomatch outside the range. It also
fails when the advisory reaches production by another path. For the server,
every reported location must be `dev: true` in `server/package-lock.json`. For
the root, the check walks `pnpm-lock.yaml`, because pnpm's report lists only
the first path it finds, development paths first, and marks no path as
development; only the Excalidraw path above is accepted. pnpm's own
`auditConfig.ignoreGhsas` would hide the advisory before any of this is
checked, and a pnpmfile's `updateConfig` hook can set it. The CI contract test
therefore forbids pnpm audit settings, pnpmfiles, and npm or pnpm settings in
the workflow or audit job environment. An ignored advisory still counts in the
registry's summary, which counts each finding path, so the root high and
critical counts must equal the listed findings. `pnpm audit --ignore` does not
audit at all: it writes the id into `auditConfig.ignoreCves`, which matches CVE
ids only. npm 11 has no per-advisory ignore.

The scheduled CI run audits all three lockfiles again every Monday. Maintainers
also recheck the advisory and picomatch releases weekly and update the review
date. Once a fixed picomatch has passed the seven-day release window, update
both lockfiles and delete the exception.

## 15 November 2026 Hono update

The server's Hono dependency is pinned to exactly 4.13.18, the maintainer's
[security release](https://github.com/honojs/hono/releases/tag/v4.13.18) for
GHSA-39q9-qp46-w8xg: `bodyLimit()` in 4.12.16–4.13.17 kept every transfer chunk
in memory, and the server applies it before authentication. A 1 MiB body sent
in 1-byte chunks retained about 269 MB of heap on 4.13.16 and about 3 MB on
4.13.18. This is a documented exception to the seven-day release window: the
release is four days old, and neither `npm audit` nor Dependabot reported the
repository-level advisory. Only the `hono` lockfile entry changed.

A fixed `bodyLimit()` still buffers a body without `Content-Length` up to its
limit before the route runs. The server therefore applies the larger sync, file
and backup limits (16, 51 and 101 MiB) only after authentication; anonymous
requests are read no further than the 1 MiB API limit.

## 13 November 2026 remediation update

The server's Hono dependency is pinned to 4.13.16, the maintainer's
[security release](https://github.com/honojs/hono/releases/tag/v4.13.16).
This fixes the newly reported middleware-routing, mount-prefix, form-validation,
CSS interpolation and CSRF advisories. The patch predates the seven-day release
window; no package-age exception or audit suppression is required. The complete
server audit is clear after the update. The root audit currently reports two
moderate and one low finding in the build-time dependencies described below;
the extension audit is clear. These results are point-in-time checks, not a
claim that future advisories cannot affect the lockfiles.

## Compatibility

- Root/server Vitest and root coverage use exactly 5.0.5 to keep tested tooling
  aligned. Lucide 1.61.0 and i18next-http-backend 4.0.6 are mature reviewed
  releases; newer versions had not passed the local seven-day release policy.
  Dependabot can propose later updates. Lucide's retired brand icons use
  supported replacements with the same labels and destinations.
- `@hono/node-ws@1.3.1` still declares a node-server 1.x peer despite importing
  no node-server runtime internals. Its narrowly scoped npm peer override uses
  patched direct node-server 2.1.6. Do not force installs or skip peer checks.
  The packaged-server PostgreSQL test covers HTTP login/sync, real WebSocket
  upgrade, authentication, denied/permitted subscriptions, committed broadcasts
  and live account revocation. Remove the override when upstream declares
  support for the patched adapter.
- Pako 3 uses bundled types, namespace exports and `toText`. Bounded share
  decompression remains tested. jose 6 key types derive from its import APIs;
  exported test keys explicitly request extractability.
- The admin cancellation fixture retains its synthetic Request until abort,
  matching a live transport's request lifetime. It asserts request/provider
  cancellation without raising timeouts. See the upstream
  [Undici request finalization issue](https://github.com/nodejs/undici/issues/4068).

## Remaining dependency advisories

On 18 November 2026 the extension audit is clean, and the server audit reports
only the excepted picomatch advisory. The root full audit reports that advisory
and two moderate advisories, minimatch and glob below; deepmerge is no longer
reported. These build-time packages remain under review:

| Package/advisory | Reachability and remaining action |
| --- | --- |
| [minimatch / GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) | ESLint, TypeScript ESLint and Workbox consume repository-controlled patterns. The advisory concerns amplification with optimization level 2. Fixed 11.x is incompatible with several 3.x/5.x callers. Await compatible parent updates/backports; do not globally force 11.x. |
| [glob / GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) | Workbox enumerates local build files with glob 11.x. Cancellation may fail to stop traversal; fixed in 14.0.2. Latest Workbox 7.4.1 still requires 11.x. Await a supported parent update. |

These packages are not imported by application/server request handlers. Build
inputs/configuration must remain trusted; CI jobs retain their time limits.
This is a scoped exposure assessment, not a claim the dependencies are patched.
Leave alerts open and recheck weekly. No severity threshold or development-package
coverage is relaxed, and audit and registry errors still fail. No advisory is
ignored except the reviewed picomatch exception above, which CI rechecks on every run.

## CodeQL triage

The first default scan completed and reported 15 findings. Tag stripping for
text extraction is not the HTML security boundary: `renderMarkdown` and
`sanitizeHtml` in `src/lib/markdown.ts` use DOMPurify before mounting HTML.

| Alert numbers | Assessment/action |
| --- | --- |
| 1–3, Pages smoke checkout/cache | Hardened: check the verified revision before checkout, use the event SHA directly, and repeat the main/event restriction. Artifact identity checks remain mandatory. |
| 5, extension entity decoding | Fixed: decode one layer in a single pass, preserve Unicode code points and replace invalid numeric entities. Regression covers double encoding and non-BMP characters. |
| 10, CTI Markdown code spans | Fixed: choose a delimiter longer than embedded backtick runs. Backslashes do not escape CommonMark code spans. Regression checks rendered literal text and absence of injected links/images. |
| 4, STIX export test | False positive: substring search selects a synthetic output indicator for a relationship assertion; it is not a URL allowlist. |
| 9, admin generated-UI test | False positive: extracts the known generated script for syntax verification by node:vm; does not filter untrusted HTML or execute remote text. |
| 6–7, standalone builder | False positives: checks the known Vite output shape, rejects ambiguous references/unsafe script delimiters, and does not sanitize user HTML. Script raw-text comment states differ from ordinary HTML comments. Standalone tests cover embedding boundaries. |
| 8, 11–13, extension extraction | False positives for executable HTML injection: produces untrusted note/LLM text, never safe HTML. It does not bypass DOMPurify. Regex extraction can be imperfect on malformed HTML; consumers must treat the result as untrusted. |
| 14, evidence XML extraction | False positive for executable HTML injection: extracted document text becomes note content, whose HTML renderer is separately sanitized. No safe-HTML guarantee is made. |
| 15, standalone config | False positive: removes the known hosted chunk guard from the repository's index.html; not an untrusted HTML sanitizer. |

Dismiss confirmed false positives individually with this evidence, without
disabling queries or excluding source directories. Reopen if these helpers
become sanitizers or acquire a new HTML sink.

## Release record

Record the tested PR/main revision, immutable artifact IDs and server digest
from the required verification/publishing workflows. Extension downloads move
to 1.1.3 for the decoding fix; downloads do not update browser stores. Publishing
an image does not upgrade running team servers. Follow existing deployment
instructions and preserve persistent data and keys.
