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

async function boot() {
  await migrateIndexedDB();
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppShell />
    </StrictMode>,
  );
}

boot();
