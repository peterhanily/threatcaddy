# BrowserNotes

A privacy-first, browser-based note-taking app and task manager. All data is stored locally in your browser — no server, no tracking, no accounts.

**Live at [browsernotes.online](https://browsernotes.online)**

## Features

- **Markdown Notes** — Write in markdown with live preview, split editor, syntax highlighting
- **Task Manager** — Priorities, due dates, statuses with list and kanban views
- **Quick Capture** — Clip articles, bookmarks, code snippets, quotes, and meeting notes with templates
- **Folders & Tags** — Organize everything with color-coded folders and tags
- **Full-Text Search** — Instantly search across all notes and tasks
- **Dark & Light Mode** — Dark by default, toggle anytime
- **Export & Import** — JSON backup/restore, Markdown export
- **Standalone HTML** — Download a single-file version that works offline from `file://`
- **Keyboard Shortcuts** — Ctrl+N, Ctrl+K, Ctrl+S, and more

## Tech Stack

- React 19 + TypeScript 5
- Vite 7
- Tailwind CSS 4
- Dexie.js (IndexedDB)
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
