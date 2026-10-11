# Security policy

Report suspected security problems privately. Do not include credentials, investigation content, personal data, or actionable vulnerability details in public issues or pull requests.

## Reporting a vulnerability

Use **Report a vulnerability** on the repository's [Security advisories page](https://github.com/peterhanily/threatcaddy/security/advisories) when that option is available. If it is unavailable, open a public issue requesting a private contact channel, without describing the vulnerability or attaching evidence. Wait for a private channel before sharing details.

Include the affected component, release version or commit, deployment type, expected security boundary, observed impact, and a minimal description using synthetic data. Redact tokens, cookies, connection strings, browser profiles, exports, and production logs. Coordinate disclosure with the maintainer; no response deadline or bounty is promised.

## Supported fixes

Security fixes target the current `main` branch. Older tags, forks, browser-store packages, and independently hosted deployments may not contain the same fixes; compare their source and version before relying on a fix. Backports are not guaranteed.

## Security boundaries

- Local investigation data lives in browser storage. Export a verified backup; browser storage and offline caches can be evicted.
- Local encryption covers supported content fields while locked. It is not whole-profile encryption, protection from a compromised browser, or end-to-end encryption for team synchronization.
- Optional AI, enrichment, map, backup, extension and team-server features can send data to their configured services. Review their configuration and permissions before use.
- A team-server operator controls its database, files and secrets. Preserve the existing encryption keys and follow the [deployment and recovery guidance](docs/deployment.md) before upgrading.

Test only systems and data you are authorized to use. Do not probe the hosted application, other users' data, third-party providers, or production servers to substantiate a report.
