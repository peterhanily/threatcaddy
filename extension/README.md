# ThreatCaddy Browser Extension

Clip text, images, and selections from web pages into ThreatCaddy. Works on Chrome and Firefox. Captures are stored locally; approved transfers and AI requests send data to the destinations you configure.

## Install — Chrome

**[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/threatcaddy-%E2%80%94-quick-captu/lakelgngpkkaeinfdlnmifookbeeffbh)**

<details>
<summary>Manual install (developer mode)</summary>

1. **[Download threatcaddy-chrome.zip](./threatcaddy-chrome.zip)**
2. Unzip the file
3. Open `chrome://extensions` in Chrome
4. Enable **Developer mode** (toggle in top-right)
5. Click **Load unpacked**
6. Select the unzipped folder

</details>

## Install — Firefox

1. **[Download threatcaddy-firefox.zip](./threatcaddy-firefox.zip)**
2. Unzip the file
3. Open `about:debugging#/runtime/this-firefox` in Firefox
4. Click **Load Temporary Add-on...**
5. Select `manifest.json` inside the unzipped folder

> Firefox temporary add-ons are removed when the browser closes. For permanent installation, the extension must be signed via [addons.mozilla.org](https://addons.mozilla.org).

## Features

- **Right-click to save** — Select text on any page, right-click, and choose "Save to ThreatCaddy"
- **Keyboard shortcut** — `Alt+Shift+X` (Mac: `Ctrl+Shift+X`) to capture the current selection
- **Rich content** — Preserves formatting, links, and inline images as Markdown
- **Confirmation bubble** — Visual feedback after each capture
- **Send to ThreatCaddy** — Confirm the destination workspace and transfer captured clips with per-clip save receipts
- **LLM Proxy** — Routes CaddyAI API calls from the web app through the extension's background script, bypassing CORS restrictions for Anthropic, OpenAI, Gemini, Mistral, and local LLM endpoints

## Usage

After installing, browse any page and select text you want to save. Use the right-click menu or keyboard shortcut to capture it. Open the extension popup to see recent captures and send them to ThreatCaddy.

Before connecting an app, open the popup's settings, enter its URL and select **Approve app**. Accept the browser's host-permission prompt, then reload that app tab. No hosted, localhost or standalone app is trusted automatically. HTTP(S) approvals bind the exact origin, including its port; standalone approvals bind the exact file. Use **Revoke app approvals** to disconnect paired apps.

For a local AI service, select the approved app, enter the service URL in its
local-AI setting, and explicitly save it. The saved approval is the exact origin
(including its port); paths are not part of an origin. The endpoint must match
that approval and have browser host permission. Reopening settings or approving
the app again preserves its saved local-AI origin without requesting additional
permission. Use the separate Remove action to revoke that app's local-AI
approval. App pairing does not grant arbitrary local-network access.

Browser host permissions and ThreatCaddy approvals are separate: the browser
grant uses the scheme and hostname (all ports), because Firefox does not support
ports in [host match patterns](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Match_patterns#host).
ThreatCaddy still checks the saved exact origin, including its port, before
allowing that app to use a local AI endpoint. Removing an app's local-AI approval
does not revoke a host grant that another approved app may use; browser extension
settings can revoke the browser grant itself.

Desktop notifications require the separate **Enable desktop notifications** permission. A successful result means the browser accepted the notification, not that the operating system displayed it. ThreatCaddy provides an in-app warning when delivery is denied, unavailable or times out.

### Reliable clip delivery

The clip review page prepares an approved app tab and shows its actual workspace
before you confirm a transfer. An app URL does not identify a workspace: an
existing tab can have a different workspace selected from a newly opened tab.
Open the intended workspace first and check the destination shown by the review
page. The extension does not switch workspaces automatically.

A clip is confirmed only after the app commits its entity and a workspace-local
receipt in the same database transaction. A closed or locked app, a timeout, or
a partial delivery leaves unconfirmed clips available to retry. Retrying the
same saved revision in the same workspace does not create a second entity.
Changing a clip's destination options creates a new revision; it never silently
overwrites an analyst's existing note, task, or event.

The extension keeps at most 500 clips. Reaching capacity rejects a new capture
with an error; it does not evict older clips. Delete only clips you have reviewed
and no longer need. A failed popup save leaves its draft available. Clips marked
sent by an older extension have no verified commit receipt and remain unverified.
Updating both the app and extension is necessary for verified delivery.

Receipts contain identifiers, a content fingerprint and commit metadata, not a
second copy of clip content. They are local to that browser workspace and are
excluded from portable backups and team synchronization. Keep the extension's
original clips until you have checked the imported data; a delivery receipt is
not an independent backup. Deleting browser storage removes its local receipts.

## Outbound boundaries

- Only paired top-level app tabs can use the bridge; other origins, ports and embedded frames are rejected.
- General URL fetching accepts public HTTP(S) hostnames only, with separate browser host permission. Proxy requests additionally require a nonempty, per-app exact-host policy refreshed within 24 hours. Redirects and ambient cookies are not forwarded; responses are capped at 5 MiB.
- Literal IP addresses, localhost and local-network hostname suffixes are not general-fetch targets. The portable browser API cannot pin DNS resolution, so an approved public hostname is still a trust boundary; do not approve domains you do not trust.
- AI provider requests use the configured provider and explicit permissions. Changing app approvals aborts existing AI streams. Captured content is never transferred to a different origin after a redirect.

## Build

Requires Node.js 24.21.0+ (24.x) and npm 11.19.0+ (11.x).

```bash
cd extension
npm ci
npm run build            # Build both Chrome and Firefox → dist/chrome/, dist/firefox/
npm run build:chrome     # Build Chrome only → dist/chrome/
npm run build:firefox    # Build Firefox only → dist/firefox/
npm run package:check    # Read-only source/build/release ZIP verification
# After tests and disposable-browser qualification:
npm run package:write    # Refresh both extension archives and root download aliases
```

The build script reads the `BROWSER` environment variable (`chrome` or `firefox`) and copies the appropriate manifest and source files into `dist/<browser>/`.

Both browser manifests and package metadata use version **1.1.2**. The popup reads
its version from the installed manifest; translations only format that value.
Release verification requires exactly 34 regular files, including all 21 locale
catalogs, with source/build/archive parity. Unexpected files (even stale build
files), links, duplicate ZIP entries and version mismatches fail verification.
Archives are inspected without extracting members. Generated PNG encodings may
vary by platform; only the three validated, correctly sized icons are exempt
from archive byte equality (not a check of identical rendered pixels). Root
`chrome.zip` and `firefox.zip` must still match
their extension archives byte for byte. CI uses `package:check` and never repairs
archives silently; `package:write` is an explicit local release step, not a
browser-store publication.

## Privacy

Captured clips stay in `chrome.storage.local` until you explicitly transfer or delete them. Approved app operations can send captures to ThreatCaddy, fetch configured sources or call the selected AI provider; those destinations receive the relevant request content. See the full [Privacy Policy](https://threatcaddy.com/privacy.html).
