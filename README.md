# ThreatCaddy

Threat Investigation Workspace. Notes, IOCs, Timelines & Graphs. No server. No tracking.

**Live at [threatcaddy.com](https://threatcaddy.com)**

Try it instantly: [threatcaddy.com/?demo=1](https://threatcaddy.com/?demo=1) loads a sample investigation with a guided walkthrough.

## Features

### Notes & Editor
- **Markdown Notes** — Write in markdown with live preview, split editor, and syntax highlighting for 20+ languages
- **Wiki-Link Internal Linking** — Type `[[note title]]` to create clickable links between notes, with case-insensitive matching and broken-link indicators
- **Slash Commands** — Type `/` for a Notion-style command menu with formatting, blocks, threat intel templates (IOC tables, MITRE references, TLP headers), and quick inserts (date, callouts, wiki-links)
- **Note Annotations** — Add timestamped comments and annotations to any note
- **Defang/Refang Toggle** — Preview network IOCs in defanged form (e.g. `hxxps://`, `example[.]com`) with one click
- **Quick Capture** — Clip articles, bookmarks, code snippets, quotes, and meeting notes with templates

### Task Management
- **Task Manager** — Priorities, due dates, statuses with list and kanban views
- **Task Comments** — Threaded comments on tasks

### Threat Intelligence & Analysis
- **IOC Extraction** — Automatically extract IPv4, IPv6, domains, URLs, emails, hashes (MD5/SHA-1/SHA-256), CVEs, MITRE ATT&CK IDs, YARA rules, and file paths from note content
- **Standalone IOCs** — Create and manage IOCs independently with type, confidence, analyst notes, attribution, and classification
- **Type-Constrained Subtypes** — IOC subtypes scoped per IOC type (e.g. "C2 Server" for IPs, "Phishing Domain" for domains) with built-in defaults and custom overrides
- **Many-to-Many Relationships** — Link IOCs with typed, directional relationships (e.g. domain "resolves-to" IP, hash "exploits" CVE) with source/target type constraints
- **Entity Graph View** — Visualize IOCs, notes, tasks, and timeline events as an interactive graph with force-directed, circle, and breadth-first layouts, node/edge filtering, and detail panel
- **Graph Drag-to-Link** — Alt+drag between graph nodes to create IOC relationships or entity links directly on the canvas
- **IOC Statistics Dashboard** — Aggregate view of all IOCs: type/confidence distribution, top actors, timeline, frequency tables, and source breakdown
- **Attribution & Classification** — Tag IOCs with threat actors, classification levels, and statuses
- **TLP/PAP Classification** — Assign Traffic Light Protocol and Permissible Actions Protocol levels to entities and investigations with screenshare-safe filtering
- **IOC Export** — Download IOCs as JSON, CSV (grouped or flat), or STIX 2.1 bundles; push to OCI object storage

### Timeline & Whiteboard
- **Incident Timeline** — Map events to MITRE ATT&CK tactics with timestamps, confidence levels, linked IOCs, and multi-timeline support
- **Whiteboards** — Freeform drawing with Excalidraw integration
- **Activity Log** — Track all actions across notes, tasks, timeline, and IOCs

### Organization
- **Investigations** — Color-coded investigations with active/closed/archived lifecycle, scoped entity counts, and bulk archive/trash operations
- **Entity Cross-Linking** — Link notes, tasks, and timeline events to each other with a searchable linker
- **Tags** — Color-coded tags with rename and delete support
- **Full-Text Search** — Instantly search across all notes, tasks, timeline events, and whiteboards with saved searches and investigation-scoped filtering
- **Unified Trash & Archive** — Manage deleted and archived items across all entity types in one view, with 30-day auto-delete for trashed items

### Platform
- **Quick Links Dashboard** — Configurable shortcut tiles for threat intel tools (VirusTotal, Shodan, AbuseIPDB, etc.) as the default home view
- **Shareable Demo Link** — Visit `?demo=1` to auto-load a sample investigation with a welcome modal offering explore, guided tour, or fresh start options
- **Dark & Light Mode** — Dark by default, toggle anytime
- **Guided Tour** — Interactive onboarding tour highlighting key features
- **Browser Navigation** — Back/forward buttons navigate between views; navigation state persists across page refresh
- **Export & Import** — Full JSON backup/restore including all entity types; per-investigation export
- **Standalone HTML** — Download a single-file version that works offline from `file://`
- **Chrome Extension** — Clip web content directly into ThreatCaddy with smart clip (selection or full page)
- **Keyboard Shortcuts** — Ctrl+N (new note), Ctrl+K (search), Ctrl+S (backup), Ctrl+E (toggle preview), and more
- **OCI Sync** — Optional sync via Oracle Cloud object storage pre-authenticated requests

## Tech Stack

- React 19 + TypeScript 5
- Vite 7
- Tailwind CSS 4
- Dexie.js (IndexedDB)
- Cytoscape.js (entity graph visualization)
- Excalidraw (whiteboards)
- marked + highlight.js + DOMPurify
- lucide-react

## Development

```bash
pnpm install
pnpm dev          # Dev server at localhost:5173
pnpm test:run     # Run test suite
pnpm lint         # Run ESLint
pnpm tsc -b       # Type check
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
