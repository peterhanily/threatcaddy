// Content script (ISOLATED world) — bridges postMessage between web app and background SW

// Protocol version — increment when message shapes change in breaking ways.
// The webapp reads this to know which features/messages the extension supports.
var TC_PROTOCOL_VERSION = 1;
var TC_CAPABILITIES = ['llm_streaming', 'fetch_url', 'clip_import', 'proxy_fetch'];

// On file:// pages, window.location.origin is the string "null".
// postMessage(data, "null") silently drops the message. Use '*' instead.
// This is the root cause of the extension not working on standalone (file://) builds.
function postOrigin() {
  return window.location.protocol === 'file:' ? '*' : window.location.origin;
}

// For incoming message origin checks: on file:// both event.origin and
// window.location.origin are "null", so the comparison works. But we still
// need to accept messages from the same window via event.source === window.
function isOwnOrigin(event) {
  if (window.location.protocol === 'file:') return event.source === window;
  return event.origin === window.location.origin;
}

function readyPayload() {
  return {
    type: 'TC_EXTENSION_READY',
    protocolVersion: TC_PROTOCOL_VERSION,
    capabilities: TC_CAPABILITIES,
  };
}

// Guard against duplicate injection (static content_scripts + dynamic executeScript)
if (document.documentElement.dataset.tcBridgeLoaded) {
  // Already loaded — just re-signal readiness and bail out
  if (chrome && chrome.runtime && chrome.runtime.id) {
    window.postMessage(readyPayload(), postOrigin());
  }
} else {
document.documentElement.dataset.tcBridgeLoaded = '1';
document.documentElement.dataset.tcBridgeCaps = TC_CAPABILITIES.join(',');

var ports = new Map(); // requestId → Port

function isExtensionValid() {
  try {
    return !!(chrome && chrome.runtime && chrome.runtime.id);
  } catch (e) {
    return false;
  }
}

// Signal extension presence
if (isExtensionValid()) {
  window.postMessage(readyPayload(), postOrigin());
}

// Re-signal readiness when page is restored from BFCache (back/forward navigation)
document.addEventListener('pageshow', function (event) {
  if (event.persisted && isExtensionValid()) {
    window.postMessage(readyPayload(), postOrigin());
  }
});

// Re-signal when tab becomes visible again (covers additional edge cases)
document.addEventListener('visibilitychange', function () {
  if (!document.hidden && isExtensionValid()) {
    window.postMessage(readyPayload(), postOrigin());
  }
});

// Respond to ping requests from the web app (handles race condition)
window.addEventListener('message', function (event) {
  if (!isOwnOrigin(event)) return;
  if (event.source === window && event.data && event.data.type === 'TC_EXTENSION_PING') {
    if (isExtensionValid()) {
      window.postMessage(readyPayload(), postOrigin());
    }
  }
});

// Listen for LLM requests from the web app
window.addEventListener('message', function (event) {
  if (!isOwnOrigin(event)) return;
  if (event.source !== window) return;
  if (!event.data) return;

  if (event.data.type === 'TC_LLM_REQUEST') {
    var requestId = event.data.requestId;
    var payload = event.data.payload;

    if (!isExtensionValid()) {
      window.postMessage({
        type: 'TC_LLM_ERROR',
        requestId: requestId,
        error: chrome.i18n.getMessage('errorExtensionInvalidated')
      }, postOrigin());
      return;
    }

    try {
      var port = chrome.runtime.connect({ name: 'llm-' + requestId });
      ports.set(requestId, port);

      port.onMessage.addListener(function (msg) {
        if (msg.type === 'chunk') {
          window.postMessage({ type: 'TC_LLM_CHUNK', requestId: requestId, content: msg.content }, postOrigin());
        } else if (msg.type === 'done') {
          window.postMessage({ type: 'TC_LLM_DONE', requestId: requestId, stopReason: msg.stopReason, contentBlocks: msg.contentBlocks, usage: msg.usage || null }, postOrigin());
          ports.delete(requestId);
        } else if (msg.type === 'error') {
          window.postMessage({ type: 'TC_LLM_ERROR', requestId: requestId, error: msg.error }, postOrigin());
          ports.delete(requestId);
        }
      });

      port.onDisconnect.addListener(function () {
        var lastError = chrome.runtime.lastError;
        if (lastError) {
          window.postMessage({
            type: 'TC_LLM_ERROR',
            requestId: requestId,
            error: lastError.message || chrome.i18n.getMessage('errorExtensionDisconnected')
          }, postOrigin());
        }
        ports.delete(requestId);
      });

      port.postMessage(payload);
    } catch (err) {
      window.postMessage({
        type: 'TC_LLM_ERROR',
        requestId: requestId,
        error: chrome.i18n.getMessage('errorExtensionUnknown', [err.message || 'unknown'])
      }, postOrigin());
    }
  }

  if (event.data.type === 'TC_FETCH_URL') {
    var fetchRequestId = event.data.requestId;
    var fetchUrl = event.data.url;

    if (!isExtensionValid()) {
      window.postMessage({
        type: 'TC_FETCH_URL_RESULT',
        requestId: fetchRequestId,
        success: false,
        error: chrome.i18n.getMessage('errorExtensionInvalidated')
      }, postOrigin());
      return;
    }

    try {
      chrome.runtime.sendMessage({ type: 'FETCH_URL', url: fetchUrl }, function (response) {
        var lastError = chrome.runtime.lastError;
        if (lastError) {
          window.postMessage({
            type: 'TC_FETCH_URL_RESULT',
            requestId: fetchRequestId,
            success: false,
            error: lastError.message || chrome.i18n.getMessage('errorExtensionError')
          }, postOrigin());
        } else if (!response) {
          window.postMessage({
            type: 'TC_FETCH_URL_RESULT',
            requestId: fetchRequestId,
            success: false,
            error: chrome.i18n.getMessage('errorNoResponse')
          }, postOrigin());
        } else {
          window.postMessage({
            type: 'TC_FETCH_URL_RESULT',
            requestId: fetchRequestId,
            success: response.success,
            title: response.title,
            content: response.content,
            url: response.url,
            error: response.error
          }, postOrigin());
        }
      });
    } catch (err) {
      window.postMessage({
        type: 'TC_FETCH_URL_RESULT',
        requestId: fetchRequestId,
        success: false,
        error: chrome.i18n.getMessage('errorExtensionUnknown', [err.message || 'unknown'])
      }, postOrigin());
    }
  }

  if (event.data.type === 'TC_PROXY_FETCH') {
    var proxyId = event.data.requestId;
    var proxyPayload = {
      type: 'PROXY_FETCH',
      url: event.data.url,
      method: event.data.method || 'GET',
      headers: event.data.headers || {},
      body: event.data.body || null,
    };

    if (!isExtensionValid()) {
      window.postMessage({
        type: 'TC_PROXY_FETCH_RESULT',
        requestId: proxyId,
        success: false,
        error: chrome.i18n.getMessage('errorExtensionInvalidated')
      }, postOrigin());
      return;
    }

    try {
      chrome.runtime.sendMessage(proxyPayload, function (response) {
        var lastError = chrome.runtime.lastError;
        if (lastError) {
          window.postMessage({
            type: 'TC_PROXY_FETCH_RESULT',
            requestId: proxyId,
            success: false,
            error: lastError.message || chrome.i18n.getMessage('errorExtensionError')
          }, postOrigin());
        } else if (!response) {
          window.postMessage({
            type: 'TC_PROXY_FETCH_RESULT',
            requestId: proxyId,
            success: false,
            error: chrome.i18n.getMessage('errorNoResponse')
          }, postOrigin());
        } else {
          window.postMessage({
            type: 'TC_PROXY_FETCH_RESULT',
            requestId: proxyId,
            success: response.success,
            status: response.status,
            statusText: response.statusText,
            data: response.data,
            headers: response.headers,
            error: response.error
          }, postOrigin());
        }
      });
    } catch (err) {
      window.postMessage({
        type: 'TC_PROXY_FETCH_RESULT',
        requestId: proxyId,
        success: false,
        error: chrome.i18n.getMessage('errorExtensionUnknown', [err.message || 'unknown'])
      }, postOrigin());
    }
  }

  if (event.data.type === 'TC_SET_PROXY_DOMAINS') {
    // Web app sends its configured integration domains so the proxy can enforce an allowlist
    if (!isExtensionValid()) return;
    var domains = Array.isArray(event.data.domains) ? event.data.domains : [];
    try {
      chrome.runtime.sendMessage({ type: 'SET_PROXY_DOMAINS', domains: domains });
    } catch (e) { /* ignore */ }
  }

  if (event.data.type === 'TC_LLM_ABORT') {
    var abortId = event.data.requestId;
    var abortPort = ports.get(abortId);
    if (abortPort) {
      try { abortPort.disconnect(); } catch (e) { /* ignore */ }
      ports.delete(abortId);
    }
  }

  if (event.data.type === 'TC_SEND_NOTIFICATION') {
    if (!isExtensionValid()) return;
    var notifPayload = event.data.payload || {};
    try {
      chrome.runtime.sendMessage({
        type: 'SEND_NOTIFICATION',
        title: notifPayload.title || 'CaddyAgent',
        message: notifPayload.message || '',
        severity: notifPayload.severity || 'warning',
      });
    } catch (e) { /* ignore */ }
  }
});

// Handle messages from background script (works on both Chrome and Firefox)
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (sender.id !== chrome.runtime.id) return;
  if (message.type === 'THREATCADDY_PING') {
    sendResponse({ pong: true });
    return;
  }
  if (message.type === 'INJECT_CLIPS_TO_PAGE') {
    window.postMessage({ type: 'THREATCADDY_IMPORT_CLIPS', clips: message.clips }, postOrigin());
    sendResponse({ success: true });
  }
});

} // end duplicate-injection guard
