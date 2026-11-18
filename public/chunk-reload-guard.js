// Catch stale-deploy chunk failures before main.tsx boots.
// GitHub Pages caches index.html for up to 600s, so after a deploy the
// browser may load old HTML referencing hashed chunks that no longer exist.
// This script runs early (before the module bundle) and auto-reloads once
// with a cache-busting query param to force a fresh HTML fetch.
(function () {
  var KEY = 'tc_chunk_reload';

  // ErrorBoundary claims 'view:<entry script>' when it reloads for a view;
  // that claim blocks only while the same build runs.
  function viewClaim() {
    var entry = document.querySelector('script[type="module"][src]');
    return 'view:' + (entry ? entry.getAttribute('src') : '');
  }

  function shouldReload() {
    var claim = sessionStorage.getItem(KEY);
    if (claim === '1' || claim === viewClaim()) return false;
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
      msg.indexOf('Importing a module script failed') !== -1 ||
      msg.indexOf('error loading dynamically imported module') !== -1 ||
      msg.indexOf('Failed to load module script') !== -1
    );
  }

  function reload() {
    // Replace the loading spinner with a brief "Updating..." message
    var root = document.getElementById('root');
    if (root) {
      root.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:16px">' +
        '<div style="width:36px;height:36px;border:3px solid rgba(139,92,246,.25);border-top-color:#8b5cf6;border-radius:50%;animation:tc-spin .8s linear infinite"></div>' +
        '<span style="color:#9ca3af;font-size:13px;font-family:system-ui,sans-serif">Updating ThreatCaddy\u2026</span>' +
        '</div>';
    }
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

  // Clear guard after successful boot so future deploys can trigger reload.
  // ErrorBoundary shares KEY for views that fail to load later; its claim
  // stays, so the two never reload the same build twice.
  setTimeout(function () { if (sessionStorage.getItem(KEY) === '1') sessionStorage.removeItem(KEY); }, 8000);
})();
