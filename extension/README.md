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

For a local AI service, also enter its exact origin in the local-AI setting before approving the app. The endpoint must match that approval and have browser host permission. App pairing does not grant arbitrary local-network access.

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
npm run package:chrome   # Zip Chrome build → dist/threatcaddy-chrome.zip
npm run package:firefox  # Zip Firefox build → dist/threatcaddy-firefox.zip
```

The build script reads the `BROWSER` environment variable (`chrome` or `firefox`) and copies the appropriate manifest and source files into `dist/<browser>/`.

## Privacy

Captured clips stay in `chrome.storage.local` until you explicitly transfer or delete them. Approved app operations can send captures to ThreatCaddy, fetch configured sources or call the selected AI provider; those destinations receive the relevant request content. See the full [Privacy Policy](https://threatcaddy.com/privacy.html).
