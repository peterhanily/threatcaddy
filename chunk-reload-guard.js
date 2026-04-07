// Catch stale-deploy chunk failures before main.tsx boots.
// GitHub Pages caches index.html for up to 600s, so after a deploy the
// browser may load old HTML referencing hashed chunks that no longer exist.
// This script runs early (before the module bundle) and auto-reloads once
// with a cache-busting query param to force a fresh HTML fetch.
(function () {
  var KEY = 'tc_chunk_reload';

  function shouldReload() {
    if (sessionStorage.getItem(KEY)) return false;
    sessionStorage.setItem(KEY, '1');
    return true;
  }

  function isChunkFailure(msg) {
    msg = String(msg || '');
    return (
      msg.indexOf('ChunkLoadError') !== -1 ||
      msg.indexOf('Loading chunk') !== -1 ||
      msg.indexOf('dynamically imported module') !== -1 ||
      msg.indexOf('Failed to fetch dynamically imported module') !== -1 ||
      msg.indexOf('Importing a module script failed') !== -1
    );
  }

  function reload() {
    var u = new URL(location.href);
    u.searchParams.set('_r', Date.now().toString());
    location.replace(u.toString());
  }

  window.addEventListener('error', function (e) {
    if (isChunkFailure(e.message || (e.error && e.error.message)) && shouldReload()) reload();
  });

  window.addEventListener('unhandledrejection', function (e) {
    var reason = e.reason;
    if (isChunkFailure(reason && reason.message ? reason.message : reason) && shouldReload()) reload();
  });

  // Clear guard after successful boot
  setTimeout(function () { sessionStorage.removeItem(KEY); }, 8000);
})();
