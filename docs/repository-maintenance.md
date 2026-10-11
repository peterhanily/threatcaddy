# Repository and release maintenance

Keep source, tested artifacts and published versions traceable. Local checks do not publish anything; changes to GitHub settings, deployment environments, browser stores or a running team server require separate maintainer approval.

## Repository settings

An administrator should review these settings deliberately; this file does not apply them:

- Protect `main` against force pushes and deletion. Require pull requests, resolved conversations and the successful **Publication gate** check from the required verification workflow. Select its actual check name from a recent successful run, require the branch to be up to date, and verify the rule on a test pull request.
- Require an independent approving review and code-owner review when another eligible maintainer is available. A sole maintainer cannot approve their own pull request; agree the review and emergency-access process before enforcing that requirement. `.github/CODEOWNERS` routes reviews but does not enable protection itself.
- Review administrator bypass and squash/linear-history policy explicitly. Preserve a documented recovery path; do not enable a merge queue without adding and testing its verification event.

See GitHub's [branch protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) and [code ownership](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) guidance.

Enable [private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository), arrange maintainer notifications and test that the private reporting option is available. Keep [SECURITY.md](../SECURITY.md) aligned with the available channel. Retain secret scanning and push protection; findings still need human review and credential rotation where appropriate.

Review Dependabot alerts and security updates, and [CodeQL default setup](https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/configure-code-scanning/configure-code-scanning) for JavaScript/TypeScript. Enabling these services and their notifications or automatic update pull requests is an administrative choice. Do not enable automatic merging of dependency updates. Independently of those settings, CI audits all three complete lockfiles on pull requests, main pushes and its weekly schedule; high/critical advisories and audit-service failures block publication.

## Version and artifact policy

The client, team server and extension have distinct manifests; their version numbers need not be equal. Coordinate client/server compatibility separately from semantic version numbers. Both browser extension manifests, its package and lockfile metadata must share one version that increases for a new extension release. The displayed extension version comes from its manifest.

Maintain user-facing changes under **Unreleased** until an approved release assigns its version and tag. A Git tag, browser-store listing, hosted deployment and GHCR image are separate publication targets; do not imply that updating one updates the others.

The four checked-in extension downloads are release artifacts: `chrome.zip` and `firefox.zip` must be byte-identical to their corresponding `extension/threatcaddy-*.zip` archives. Build and test first, then regenerate the downloads explicitly. CI checks their member allowlist, source/build parity and version consistency. Generated PNG icons have a narrowly scoped cross-platform comparison exception; source SVG and expected icon dimensions remain checked. Never include an arbitrary directory, development profile or test evidence in a release archive.

## Publication and recovery

Follow [Development and verification](development-verification.md#publication) for the required workflow. Publication promotes the same immutable artifact IDs from the successful verification run, checks source identity and SHA-256 digests, and rejects a superseded main revision. Do not rebuild in a privileged publication job or substitute files after verification.

Retain the verified client archive, source SHA and checksum, and the server image ID/digest and source identity as approved release records before short-lived CI artifacts expire. A checksum confirms byte identity, not publisher trust or an independent security audit. Verify it against a trusted release record.

The Pages post-deployment smoke check verifies live bytes and synthetic offline save/reopen behavior against the same artifact. A failed smoke check means the release was published but not qualified; investigate before further publication. There is no automatic rollback.

Image publication does not roll out a running team server. Follow [deployment and recovery](deployment.md#6-upgrading), preserve the database, files and existing encryption keys together, and rehearse recovery before an upgrade. Do not roll an older binary back over a migrated database without a documented compatible restore path.
