// Content script (ISOLATED world) — bridges postMessage between web app and background SW

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
  window.postMessage({ type: 'TC_EXTENSION_READY' }, '*');
}

// Respond to ping requests from the web app (handles race condition)
window.addEventListener('message', function (event) {
  if (event.source === window && event.data && event.data.type === 'TC_EXTENSION_PING') {
    if (isExtensionValid()) {
      window.postMessage({ type: 'TC_EXTENSION_READY' }, '*');
    }
  }
});

// Listen for LLM requests from the web app
window.addEventListener('message', function (event) {
  if (event.source !== window) return;
  if (!event.data) return;

  if (event.data.type === 'TC_LLM_REQUEST') {
    var requestId = event.data.requestId;
    var payload = event.data.payload;

    if (!isExtensionValid()) {
      window.postMessage({
        type: 'TC_LLM_ERROR',
        requestId: requestId,
        error: 'Extension context invalidated. Please reload this page.'
      }, '*');
      return;
    }

    try {
      var port = chrome.runtime.connect({ name: 'llm-' + requestId });
      ports.set(requestId, port);

      port.onMessage.addListener(function (msg) {
        if (msg.type === 'chunk') {
          window.postMessage({ type: 'TC_LLM_CHUNK', requestId: requestId, content: msg.content }, '*');
        } else if (msg.type === 'done') {
          window.postMessage({ type: 'TC_LLM_DONE', requestId: requestId, stopReason: msg.stopReason, contentBlocks: msg.contentBlocks }, '*');
          ports.delete(requestId);
        } else if (msg.type === 'error') {
          window.postMessage({ type: 'TC_LLM_ERROR', requestId: requestId, error: msg.error }, '*');
          ports.delete(requestId);
        }
      });

      port.onDisconnect.addListener(function () {
        var lastError = chrome.runtime.lastError;
        if (lastError) {
          window.postMessage({
            type: 'TC_LLM_ERROR',
            requestId: requestId,
            error: lastError.message || 'Extension disconnected'
          }, '*');
        }
        ports.delete(requestId);
      });

      port.postMessage(payload);
    } catch (err) {
      window.postMessage({
        type: 'TC_LLM_ERROR',
        requestId: requestId,
        error: 'Extension error: ' + (err.message || 'unknown. Try reloading the page.')
      }, '*');
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
        error: 'Extension context invalidated. Please reload this page.'
      }, '*');
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
            error: lastError.message || 'Extension error'
          }, '*');
        } else if (!response) {
          window.postMessage({
            type: 'TC_FETCH_URL_RESULT',
            requestId: fetchRequestId,
            success: false,
            error: 'No response from extension background'
          }, '*');
        } else {
          window.postMessage({
            type: 'TC_FETCH_URL_RESULT',
            requestId: fetchRequestId,
            success: response.success,
            title: response.title,
            content: response.content,
            url: response.url,
            error: response.error
          }, '*');
        }
      });
    } catch (err) {
      window.postMessage({
        type: 'TC_FETCH_URL_RESULT',
        requestId: fetchRequestId,
        success: false,
        error: 'Extension error: ' + (err.message || 'unknown')
      }, '*');
    }
  }

  if (event.data.type === 'TC_LLM_ABORT') {
    var abortId = event.data.requestId;
    var abortPort = ports.get(abortId);
    if (abortPort) {
      try { abortPort.disconnect(); } catch (e) { /* ignore */ }
      ports.delete(abortId);
    }
  }
});

// Handle clip injection from background script (works on both Chrome and Firefox)
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (sender.id !== chrome.runtime.id) return;
  if (message.type === 'INJECT_CLIPS_TO_PAGE') {
    var origin = window.location.protocol === 'file:' ? '*' : window.location.origin;
    window.postMessage({ type: 'BROWSERNOTES_IMPORT_CLIPS', clips: message.clips }, origin);
    sendResponse({ success: true });
  }
});
