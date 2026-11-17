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
- AI tool calls are judged by where they reach, because investigation content can carry instructions aimed at CaddyAI and agents. The app checks every call again when it runs, and an approval covers only the exact call approved.
  - **Without approval:** CaddyAI reads the investigation a conversation works in; in YOLO mode it also changes that investigation and runs built-in vendor lookups. Deployed agents do what their investigation's auto-approve settings allow inside it; the only outbound calls those settings can allow are built-in vendor lookups and fetches from a fixed list of reference sites (NVD, CVE, CWE, MITRE ATT&CK, CISA, FIRST). The supervisor reads across investigations and writes in its own local-only investigation, as the auto-approve settings allow. With the agent bridge turned on, page scripts read and change the selected investigation.
  - **Always asks:** CaddyAI opening any web page, and agents opening one outside the reference list; other integrations, skills, SIEM and ticket calls; agent changes made from chat, and agents' proposals to spawn, define or dismiss agents or record a lesson; writes into another investigation from chat or the supervisor; chat reads of other investigations from an investigation that can sync; and writes, outbound calls or agent changes taken from reply text rather than sent as tool calls.
  - **Refused:** any read or write of a local-only investigation from AI working in an investigation that can sync; agents writing to other investigations, or reading them (except a profile that lists the cross-investigation tools, such as Pattern Hunter, deployed in a local-only investigation); agents deploying, stopping or running agents; in Plan mode, anything but reading the conversation's investigation; outbound calls and agent changes by the supervisor; and anything outside the selected investigation, off the device or changing agents through the agent bridge, which is off by default.
  - Web fetch refuses private, local, literal-IP and credentialed addresses and needs extension 1.1.3 or later. It cannot detect a public name that resolves to a private address.
- A team-server operator controls its database, files and secrets. Preserve the existing encryption keys and follow the [deployment and recovery guidance](docs/deployment.md) before upgrading.

Test only systems and data you are authorized to use. Do not probe the hosted application, other users' data, third-party providers, or production servers to substantiate a report.
