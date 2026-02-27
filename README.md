# ThreatCaddy

Threat Investigation Workspace. Notes, IOCs, Timelines & Graphs. No server. No tracking.

**Live at [threatcaddy.com](https://threatcaddy.com)**

## Features

### Core
- **Markdown Notes** — Write in markdown with live preview, split editor, syntax highlighting
- **Task Manager** — Priorities, due dates, statuses with list and kanban views
- **Quick Capture** — Clip articles, bookmarks, code snippets, quotes, and meeting notes with templates
- **Investigations & Tags** — Organize everything with color-coded investigations (active/closed/archived) and tags, with scoped entity counts and navigation
- **Full-Text Search** — Instantly search across all notes, tasks, timeline events, and whiteboards with saved searches and investigation-scoped search

### Threat Intelligence & Analysis
- **IOC Extraction** — Automatically extract IPv4, IPv6, domains, URLs, emails, hashes (MD5/SHA-1/SHA-256), CVEs, MITRE ATT&CK IDs, YARA rules, and file paths from note content
- **Type-Constrained Subtypes** — IOC subtypes scoped per IOC type (e.g. "C2 Server" for IPs, "Phishing Domain" for domains) with built-in defaults and custom overrides
- **Many-to-Many Relationships** — Link IOCs with typed, directional relationships (e.g. domain "resolves-to" IP, hash "exploits" CVE) with source/target type constraints
- **Entity Graph View** — Visualize IOCs, notes, tasks, and timeline events as an interactive graph with force-directed, circle, and breadth-first layouts, node/edge filtering, and detail panel
- **Graph Drag-to-Link** — Alt+drag between graph nodes to create IOC relationships or entity links directly on the canvas
- **IOC Statistics Dashboard** — Aggregate view of all IOCs across the database: type/confidence distribution, top actors, timeline, frequency tables, and source breakdown
- **Attribution & Classification** — Tag IOCs with threat actors, classification levels, and statuses
- **TLP/PAP Classification** — Assign Traffic Light Protocol and Permissible Actions Protocol levels to entities and investigations with screenshare-safe filtering
- **IOC Export** — Download IOCs as JSON, CSV (grouped or flat), or STIX 2.1 bundles; push to OCI object storage

### Timeline & Whiteboard
- **Incident Timeline** — Map events to MITRE ATT&CK tactics with timestamps, confidence levels, linked IOCs, and multi-timeline support
- **Whiteboards** — Freeform drawing with Excalidraw integration
- **Activity Log** — Track all actions across notes, tasks, timeline, and IOCs

### Platform
- **Dark & Light Mode** — Dark by default, toggle anytime
- **Export & Import** — Full JSON backup/restore with timeline and whiteboard data
- **Standalone HTML** — Download a single-file version that works offline from `file://`
- **Chrome Extension** — Clip web content directly into ThreatCaddy
- **Keyboard Shortcuts** — Ctrl+N, Ctrl+K, Ctrl+S, and more
- **Guided Tour** — Interactive onboarding tour for new users
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

## Chrome Extension

The `extension/` directory contains a Chrome extension for clipping web content into ThreatCaddy.

To load during development:
1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the `extension/` directory

## Deploy

The `dist/` output is configured for GitHub Pages with a custom domain (`threatcaddy.com`). Push to `main` and deploy via GitHub Pages settings pointing at the `dist/` directory or a GitHub Actions workflow.

## License

MIT
