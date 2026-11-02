# Dependency and code-scanning review — 2 November 2026

Keep the complete audit and publication gates enabled. Settings, repository
changes, published artifacts and running server deployments are separate states.

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

Server and extension audits are clean. The root full audit still reports four
moderate occurrences and one low occurrence across these build-time packages:

| Package/advisory | Reachability and remaining action |
| --- | --- |
| [minimatch / GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) | ESLint, TypeScript ESLint and Workbox consume repository-controlled patterns. The advisory concerns amplification with optimization level 2. Fixed 11.x is incompatible with several 3.x/5.x callers. Await compatible parent updates/backports; do not globally force 11.x. |
| [glob / GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) | Workbox enumerates local build files with glob 11.x. Cancellation may fail to stop traversal; fixed in 14.0.2. Latest Workbox 7.4.1 still requires 11.x. Await a supported parent update. |
| [deepmerge / GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) | Workbox's Rollup node-resolve plugin merges build configuration. Latest deepmerge 4.3.1 has no published patch. Await an upstream fix or reviewed parent replacement. |

These packages are not imported by application/server request handlers. Build
inputs/configuration must remain trusted; CI jobs retain their time limits.
This is a scoped exposure assessment, not a claim the dependencies are patched.
Leave alerts open and recheck weekly. No severity threshold, development-package
coverage or audit failure handling is relaxed, and no advisory is ignored.

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
