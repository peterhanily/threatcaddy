# Contributing to ThreatCaddy

Use a focused pull request with a clear user-visible outcome, regression tests, and compatibility notes. Discuss substantial feature or architecture changes in an issue first. For security concerns, follow [SECURITY.md](SECURITY.md), not the public bug template.

## Set up and verify

Follow [Development and verification](docs/development-verification.md) for the pinned Node, pnpm and npm versions, installation, browser checks and disposable database setup. Keep all three lockfiles consistent with their own manifests; do not replace one package manager's lockfile with another's.

At minimum, run the relevant unit tests, `pnpm lint`, `pnpm locales:check`, `pnpm test:ci`, and the affected production builds. Add actual browser coverage for UI or browser-storage changes, real PostgreSQL coverage for database behavior, and installed-extension coverage for browser API changes. Test both hosted and standalone editions when shared client code changes. State what was not tested rather than treating mocks as a runtime pass.

## Change safely

- Preserve saved data, drafts, current permissions and existing compatibility contracts. Validate before mutation; report partial or failed operations accurately.
- Keep new code lint-clean. The per-file, per-rule warning baseline records existing debt, not an allowance for new warnings. Reduce it when fixing old warnings; do not raise it to make a change pass.
- Use existing components, TypeScript types and localization patterns. Add keys and matching parameters to every supported app or extension locale. Structural locale checks do not replace fluent-language review.
- Keep migrations append-only. Use disposable synthetic databases and exercise upgrades, restart and recovery. Never run the integration harness against retained or production data.
- Keep network, native-permission and deployment effects explicit. Tests should use synthetic local fixtures and inert providers; never use a normal browser profile or live credentials.
- For dependencies, inspect the complete audit report and release compatibility. Do not suppress an advisory or force a major transitive upgrade just to obtain a green audit.

## Before opening a pull request

Review the complete diff and generated artifacts. Exclude `.env` files, keys, profiles, logs, investigation exports, internal plans and review evidence. The ignored `plans/`, `docs/reviews/` and test-output directories are not release inputs. Share only sanitized summaries or deliberately reviewed fixtures.

Describe behavior changes, tests, data-migration implications and any manual checks still needed. Update public documentation and the Unreleased changelog where behavior changes. Extension downloads must match the tested build; see [repository maintenance](docs/repository-maintenance.md).

Pushing to `main` can publish verified client and server artifacts automatically. A local build or successful test run is not permission to merge, push, deploy, change GitHub settings, or roll out a team server.
