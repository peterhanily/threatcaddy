import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n' // Initialize i18next before React renders
import { AppShell } from './components/Encryption/AppShell'
import { migrateStorageKeys } from './lib/storage-migration'
import { migrateIndexedDB } from './lib/db-migration'
import { clipBuffer } from './lib/clipBuffer'
import { installAgentBridge } from './lib/agent-bridge'
import { installFileHandler } from './lib/file-handler'

// Start buffering clip messages immediately — before React mounts and before
// the encryption lock screen is dismissed — so no postMessage events are lost.
clipBuffer.startListening();

// Register PWA file handler so double-clicking a .md file opens it in ThreatCaddy
installFileHandler();

// Expose window.threatcaddy for external AI agents (Claude Code, Codex, etc.)
installAgentBridge();

// Migrate legacy BrowserNotes data before React renders
migrateStorageKeys();

// When a new service worker takes control after a deploy, stale chunk
// references may fail to load. Rather than force-reloading the page
// (which disrupts user flow), we rely on chunk-reload-guard.js to
// detect actual chunk-load failures and reload only when necessary.

// Run DB migration in the background — don't block first render
migrateIndexedDB().catch(console.error);

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppShell />
  </StrictMode>,
);
