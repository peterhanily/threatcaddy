# Repository and release maintenance

Keep source, tested artifacts and published versions traceable. Local checks do not publish anything; changes to GitHub settings, deployment environments, browser stores or a running team server require separate maintainer approval.

## Repository settings

An administrator should review these settings deliberately; this file does not apply them:

- Protect `main` against force pushes and deletion. Require pull requests, resolved conversations and the successful **Publication gate** check from the required verification workflow. Select its actual check name from a recent successful run, require the branch to be up to date, and verify the rule on a test pull request.
- Require an independent approving review and code-owner review when another eligible maintainer is available. A sole maintainer cannot approve their own pull request; agree the review and emergency-access process before enforcing that requirement. `.github/CODEOWNERS` routes reviews but does not enable protection itself.
- Review administrator bypass and squash/linear-history policy explicitly. Preserve a documented recovery path; do not enable a merge queue without adding and testing its verification event.

On 13 November 2026, `main` protection was enabled with required pull requests,
resolved conversations, an up-to-date branch and the exact
`verify / Publication gate` check from GitHub Actions (app ID 15368). The rule
applies to administrators; force pushes and branch deletion are disabled.
Only one collaborator is currently available, so the required independent
approval count is zero. Add an eligible reviewer and require their approval
before treating this as independent release oversight. Repository documentation
and code-owner assignments alone do not enforce these settings; recheck the
GitHub API or settings after administrative changes.

See GitHub's [branch protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) and [code ownership](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) guidance.

Enable [private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository), arrange maintainer notifications and test that the private reporting option is available. Keep [SECURITY.md](../SECURITY.md) aligned with the available channel. Retain secret scanning and push protection; findings still need human review and credential rotation where appropriate.

Review Dependabot alerts and security updates, and [CodeQL default setup](https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/configure-code-scanning/configure-code-scanning) for JavaScript/TypeScript. Enabling these services and their notifications or automatic update pull requests is an administrative choice. Do not enable automatic merging of dependency updates. Independently of those settings, CI audits all three complete lockfiles on pull requests, main pushes and its weekly schedule; high/critical advisories and audit-service failures block publication.

The checked-in `.github/dependabot.yml` proposes weekly updates separately for
root pnpm, server npm, extension npm and GitHub Actions, and daily updates for
the server image's Node 24 Alpine base, once merged to the default branch. A
Node base proposal must also
update `.node-version`, `.nvmrc` and `README.md`; the CI contract tests fail
until it does. Update the other guides that state the runtime version
(`server/README.md`, `docs/deployment.md`, `docs/development-verification.md`)
in the same change.
Keep action references pinned to full commit SHAs. Root Vitest
and its coverage packages update together; review resolved dependency versions
and full audits rather than assuming a tooling version bump removes every
vulnerable transitive package. Proposals do not bypass verification or authorize
publication.

Routine minor/patch proposals are grouped per manifest, with a seven-day
version-update cooldown and smaller open-PR limits. Security proposals have
separate groups and bypass that cooldown. Docker receives no Dependabot
security updates, so the Node base image check uses a two-day cooldown instead.
Major upgrades remain individually
reviewable (the root Vitest/coverage pair stays aligned). The weekly full audit
is unchanged. Dependabot alerts, security updates and weekly CodeQL analysis
for JavaScript/TypeScript and Actions were enabled on 2 November 2026.
See the [dependency and scan review](dependency-security-review.md) for findings,
compatibility pins and remaining upstream advisories.

## Version and artifact policy

The client, team server and extension have distinct manifests; their version numbers need not be equal. Coordinate client/server compatibility separately from semantic version numbers. Both browser extension manifests, its package and lockfile metadata must share one version that increases for a new extension release. The displayed extension version comes from its manifest.

Maintain user-facing changes under **Unreleased** until an approved release assigns its version and tag. A Git tag, browser-store listing, hosted deployment and GHCR image are separate publication targets; do not imply that updating one updates the others.

The four checked-in extension downloads are release artifacts: `chrome.zip` and `firefox.zip` must be byte-identical to their corresponding `extension/threatcaddy-*.zip` archives. Build and test first, then regenerate the downloads explicitly. CI checks their member allowlist, source/build parity and version consistency. Generated PNG icons have a narrowly scoped cross-platform comparison exception; source SVG and expected icon dimensions remain checked. Never include an arbitrary directory, development profile or test evidence in a release archive.

## Publication and recovery

### Versioned downloads

Every release correction needs a new version and tag. The README links to the
latest stable release; update its version badge and release-notes link with the
coordinated client/server version, and publish the release promptly after the
merge so that link does not keep pointing at the previous release. Preserve historical tags and
asset bytes. Browser stores and retained team servers remain separate rollouts.

After the exact main revision passes CI and hosted smoke, download its immutable
verified client/server artifacts by ID and check the GitHub archive digests,
source files, packaged tar hashes and server config/revision. Copy the standalone
from that client archive and the checked extension ZIPs from the same source.
Create a release manifest with the source, versions, successful CI URL/run ID,
artifact IDs/hashes, asset sizes/hashes and immutable GHCR image reference.
Generate `SHA256SUMS` over the three downloads and `release-manifest.json`, with
sorted filenames. Enable GitHub immutable releases, assemble all assets in a
draft and verify them before publishing. Do not use asset replacement or move a
historical tag to repair a release.

After publication, fetch the published release metadata, resolve its tag to a
commit, and download all five assets again. Run:

```bash
node scripts/verify-release-channel.mjs RECEIPT.json DOWNLOAD_DIRECTORY
```

The JSON receipt supplies independently retrieved `release` and `run` API
objects; `sourceSHA`, `tagSourceSHA`, `version`, `extensionVersion`;
`artifactDirectory` pointing to the verified client archive; its numeric
`clientArtifactId` and `serverArtifactId`; `serverArchiveHash`, `serverImageId`
and registry `serverDigest`; and `extensionHashes` keyed by the two ZIP filenames.
The checker reads the actual downloaded manifest/assets and fails on stale
versions/source, mutable/draft releases, CI identity mismatch, substituted
artifacts/images, wrong download hashes or incomplete checksums. Its adversarial
contracts run in the required `pnpm test:ci` suite.

Also execute the downloaded standalone in an isolated offline browser. A matching
hash ties it to the qualified artifact; runtime checks confirm the user-facing
download route and operation. Retain the verification receipt outside the
repository with the dated release record. A hosted-only update is not evidence
that the versioned download was updated.

See GitHub's [immutable release documentation](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases#immutable-releases).

### Hosted and server promotion

Follow [Development and verification](development-verification.md#publication) for the required workflow. Publication promotes the same immutable artifact IDs from the successful verification run, checks source identity and SHA-256 digests, and rejects a superseded main revision. Do not rebuild in a privileged publication job or substitute files after verification.

CI keeps the verified client and server artifacts for 90 days. Retain the verified client archive, source SHA and checksum, and the server image ID/digest and source identity as approved release records before they expire. A checksum confirms byte identity, not publisher trust or an independent security audit. Verify it against a trusted release record.

The Pages post-deployment smoke check verifies live bytes and synthetic offline save/reopen behavior against the same artifact. A failed smoke check means the release was published but not qualified; investigate before further publication. There is no automatic rollback.

Image publication does not roll out a running team server. Follow [deployment and recovery](deployment.md#6-upgrading), preserve the database, files and existing encryption keys together, and rehearse recovery before an upgrade. Do not roll an older binary back over a migrated database without a documented compatible restore path.
