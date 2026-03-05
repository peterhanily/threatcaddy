import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { AppShell } from './components/Encryption/AppShell'
import { migrateStorageKeys } from './lib/storage-migration'
import { migrateIndexedDB } from './lib/db-migration'

// Migrate legacy BrowserNotes data before React renders
migrateStorageKeys();

// Auto-reload when a new service worker takes control (after deploy).
// Without this, the old HTML may reference JS bundles that no longer exist
// in the new SW's precache, causing the app to hang at the loading spinner.
if ('serviceWorker' in navigator) {
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!reloading) {
      reloading = true;
      window.location.reload();
    }
  });
}

// Auto-recover from stale deploys: if an old cached index.html references
// hashed chunks that no longer exist, the dynamic import fails. Reload once
// to pick up the new index.html and matching assets.
window.addEventListener('error', (event) => {
  const msg = event.message || '';
  if (msg.includes('Failed to fetch dynamically imported module') ||
      msg.includes('ChunkLoadError') ||
      msg.includes('Loading chunk')) {
    if (!sessionStorage.getItem('tc-chunk-reload')) {
      sessionStorage.setItem('tc-chunk-reload', '1');
      window.location.reload();
    }
  }
}, true);
window.addEventListener('unhandledrejection', (event) => {
  const msg = String(event.reason?.message || event.reason || '');
  if (msg.includes('Failed to fetch dynamically imported module') ||
      msg.includes('ChunkLoadError') ||
      msg.includes('Loading chunk')) {
    if (!sessionStorage.getItem('tc-chunk-reload')) {
      sessionStorage.setItem('tc-chunk-reload', '1');
      window.location.reload();
    }
  }
});

async function boot() {
  // Clear the chunk-reload guard on successful boot
  sessionStorage.removeItem('tc-chunk-reload');
  await migrateIndexedDB();
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppShell />
    </StrictMode>,
  );
}

boot();
