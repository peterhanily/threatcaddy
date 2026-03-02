# ThreatCaddy Browser Extension

Clip text, images, and selections from any web page directly into ThreatCaddy. Works on Chrome and Firefox. All data stays local.

## Install — Chrome

1. **[Download threatcaddy-chrome.zip](./dist/threatcaddy-chrome.zip)**
2. Unzip the file
3. Open `chrome://extensions` in Chrome
4. Enable **Developer mode** (toggle in top-right)
5. Click **Load unpacked**
6. Select the unzipped folder

## Install — Firefox

1. **[Download threatcaddy-firefox.zip](./dist/threatcaddy-firefox.zip)**
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
- **Send to ThreatCaddy** — Transfer all captured clips to the web app with one click
- **LLM Proxy** — Routes AI chat API calls from the web app through the extension's background script, bypassing CORS restrictions for Anthropic, OpenAI, Gemini, Mistral, and local LLM endpoints

## Usage

After installing, browse any page and select text you want to save. Use the right-click menu or keyboard shortcut to capture it. Open the extension popup to see recent captures and send them to ThreatCaddy.

## Build

Requires Node.js 18+.

```bash
cd extension
npm install
npm run build            # Build both Chrome and Firefox → dist/chrome/, dist/firefox/
npm run build:chrome     # Build Chrome only → dist/chrome/
npm run build:firefox    # Build Firefox only → dist/firefox/
npm run package:chrome   # Zip Chrome build → dist/threatcaddy-chrome.zip
npm run package:firefox  # Zip Firefox build → dist/threatcaddy-firefox.zip
```

The build script reads the `BROWSER` environment variable (`chrome` or `firefox`) and copies the appropriate manifest and source files into `dist/<browser>/`.
