# BrowserNotes

A privacy-first, browser-based note-taking and threat intelligence analysis app. All data is stored locally in your browser — no server, no tracking, no accounts.

**Live at [browsernotes.online](https://browsernotes.online)**

## Features

### Core
- **Markdown Notes** — Write in markdown with live preview, split editor, syntax highlighting
- **Task Manager** — Priorities, due dates, statuses with list and kanban views
- **Quick Capture** — Clip articles, bookmarks, code snippets, quotes, and meeting notes with templates
- **Folders & Tags** — Organize everything with color-coded folders and tags
- **Full-Text Search** — Instantly search across all notes, tasks, timeline events, and whiteboards

### Threat Intelligence & Analysis
- **IOC Extraction** — Automatically extract IPv4, IPv6, domains, URLs, emails, hashes (MD5/SHA-1/SHA-256), CVEs, MITRE ATT&CK IDs, YARA rules, and file paths from note content
- **Type-Constrained Subtypes** — IOC subtypes scoped per IOC type (e.g. "C2 Server" for IPs, "Phishing Domain" for domains) with built-in defaults and custom overrides
- **Many-to-Many Relationships** — Link IOCs with typed, directional relationships (e.g. domain "resolves-to" IP, hash "exploits" CVE) with source/target type constraints
- **Entity Graph View** — Visualize IOCs, notes, tasks, and timeline events as an interactive graph with force-directed, circle, and breadth-first layouts, node/edge filtering, and detail panel
- **Attribution & Classification** — Tag IOCs with threat actors, classification levels, and statuses
- **IOC Export** — Download IOCs as JSON or CSV (grouped or flat), push to OCI object storage

### Timeline & Whiteboard
- **Incident Timeline** — Map events to MITRE ATT&CK tactics with timestamps, confidence levels, linked IOCs, and multi-timeline support
- **Whiteboards** — Freeform drawing with Excalidraw integration
- **Activity Log** — Track all actions across notes, tasks, timeline, and IOCs

### Platform
- **Dark & Light Mode** — Dark by default, toggle anytime
- **Export & Import** — Full JSON backup/restore with timeline and whiteboard data
- **Standalone HTML** — Download a single-file version that works offline from `file://`
- **Chrome Extension** — Clip web content directly into BrowserNotes
- **Keyboard Shortcuts** — Ctrl+N, Ctrl+K, Ctrl+S, and more
- **OCI Sync** — Optional sync via Oracle Cloud object storage pre-authenticated requests

## Tech Stack

- React 19 + TypeScript 5
- Vite 7
- Tailwind CSS 4
- Dexie.js (IndexedDB)
- Cytoscape.js (entity graph visualization)
- Excalidraw (whiteboards)
- marked + highlight.js
- lucide-react

## Development

```bash
pnpm install
pnpm dev          # Dev server at localhost:5173
```

## Build

```bash
pnpm build        # Production build → dist/
pnpm build:single # Standalone HTML → dist-single/index.html
```

## Deploy

The `dist/` output is configured for GitHub Pages with a custom domain (`browsernotes.online`). Push to `main` and deploy via GitHub Pages settings pointing at the `dist/` directory or a GitHub Actions workflow.

## License

MIT
