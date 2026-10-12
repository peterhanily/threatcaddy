// Background service worker for ThreatCaddy extension

const MAX_CAPTURES = 500;
const APP_APPROVAL_KEY = 'approvedAppsV1';
const POLICY_MAX_AGE = 24 * 60 * 60 * 1000;
const MAX_FETCH_BYTES = 5 * 1024 * 1024;
const CLIP_STATE_KEY = 'clipDeliveryV2';
const CLIP_ACK_WAIT_MS = 10000;
const CLIP_SESSION_AGE_MS = 30 * 60 * 1000;
function approvalGeneration(approval) {
  // Existing installations retain their exact approval, but every new approval
  // receives fresh authority independent of the wall clock.
  return approval?.generation || (Number.isFinite(approval?.approvedAt) ? `legacy:${approval.approvedAt}` : undefined);
}

// The background is the only writer of capture and approval state. A rejected
// write must not poison later operations, and network waits never hold this queue.
let storageTail = Promise.resolve();
function serializeStorage(operation) {
  const next = storageTail.then(operation);
  storageTail = next.catch(() => {});
  return next;
}
function clipRevision(clip) { return Number.isSafeInteger(clip.revision) && clip.revision > 0 ? clip.revision : 1; }
function confirmedCapture(clip) { return clip.delivery?.status === 'confirmed' && clip.delivery.revision === clipRevision(clip); }
function normalizedClip(value) {
  const result = { id: value.id, revision: clipRevision(value), title: value.title ?? '', content: value.content ?? '',
    sourceUrl: value.sourceUrl ?? '', sourceTitle: value.sourceTitle ?? '', entityType: value.entityType || 'note',
    folderName: value.folderName ?? '', clsLevel: value.clsLevel ?? '', createdAt: value.createdAt };
  if (typeof result.id !== 'string' || !result.id || result.id.length > 128) throw new Error('Invalid capture ID');
  if (!Number.isSafeInteger(result.createdAt) || result.createdAt < 0 || result.createdAt > 8640000000000000) throw new Error('Invalid capture date');
  if (!['note', 'task', 'timeline-event'].includes(result.entityType)) throw new Error('Unsupported capture type');
  const limits = { title: 4096, content: 4 * 1024 * 1024, sourceUrl: 16384, sourceTitle: 4096 };
  for (const [field, limit] of Object.entries(limits)) {
    if (typeof result[field] !== 'string' || new TextEncoder().encode(result[field]).length > limit) throw new Error(`Capture ${field} is too large or invalid. The capture is retained.`);
  }
  if (typeof result.folderName !== 'string' || result.folderName.length > 256 || typeof result.clsLevel !== 'string' || result.clsLevel.length > 128) throw new Error('Invalid capture options');
  if (new TextEncoder().encode(JSON.stringify(result)).length > 5 * 1024 * 1024) throw new Error('Capture exceeds 5 MiB. The capture is retained.');
  return result;
}
async function fingerprintClip(clip) {
  // Byte-for-byte order shared with src/lib/clip-protocol.ts; fingerprint itself
  // and extension delivery metadata are deliberately excluded.
  const canonical = { id: clip.id, revision: clip.revision, title: clip.title, content: clip.content,
    sourceUrl: clip.sourceUrl, sourceTitle: clip.sourceTitle, entityType: clip.entityType,
    folderName: clip.folderName, clsLevel: clip.clsLevel, createdAt: clip.createdAt };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function deliveryState(stored) {
  return stored[CLIP_STATE_KEY] || { sourceId: crypto.randomUUID(), sessions: {}, attempts: {} };
}
function pruneDeliveryState(state, captures) {
  const pending = new Set(captures.filter(clip => clip.delivery?.status === 'pending').map(clip => clip.delivery.attemptId));
  for (const id of Object.keys(state.attempts)) if (!pending.has(id)) delete state.attempts[id];
  const required = new Set(Object.values(state.attempts).map(attempt => attempt.sessionId));
  for (const [id, session] of Object.entries(state.sessions)) if (!required.has(id) && Date.now() - session.createdAt > CLIP_SESSION_AGE_MS) delete state.sessions[id];
  const unused = Object.keys(state.sessions).filter(id => !required.has(id));
  for (const id of unused.slice(0, Math.max(0, unused.length - 31))) delete state.sessions[id];
}
function captureReferences(value) {
  if (!Array.isArray(value) || value.length > MAX_CAPTURES) throw new Error('Select at most 500 captures');
  return value.map(item => {
    if (!item || typeof item.id !== 'string' || !item.id || !Number.isSafeInteger(item.revision) || item.revision < 1) throw new Error('Invalid capture selection; refresh and retry');
    return { id: item.id, revision: item.revision };
  });
}
function editCapture(clip, values) {
  for (const [field, value] of Object.entries(values)) {
    if (!['entityType', 'folderName', 'clsLevel'].includes(field) || typeof value !== 'string') throw new Error('Unsupported capture edit');
    if (field === 'entityType' && !['note', 'task', 'timeline-event'].includes(value)) throw new Error('Unsupported capture type');
    if (value.length > (field === 'folderName' ? 256 : 128)) throw new Error('Capture option is too long');
  }
  if (Object.entries(values).every(([field, value]) => (clip[field] || '') === value)) return clip;
  if (clipRevision(clip) >= Number.MAX_SAFE_INTEGER) throw new Error('Capture revision exhausted; save a new capture');
  const updated = { ...clip, ...values, revision: clipRevision(clip) + 1, sent: false };
  delete updated.delivery;
  return updated;
}
async function mutateCaptures(message) {
  return serializeStorage(async () => {
    const stored = await chrome.storage.local.get(['captures', CLIP_STATE_KEY]);
    const captures = stored.captures || [];
    const refs = captureReferences(message.clips);
    const selected = new Map(refs.map(ref => [ref.id, ref.revision]));
    // A stale confirmation/edit may never delete or acknowledge a newer revision.
    if (captures.some(clip => selected.has(clip.id) && selected.get(clip.id) !== clipRevision(clip))) throw new Error('A capture changed in another window. Refresh and retry.');
    let updated;
    if (message.type === 'DELETE_CAPTURES') updated = captures.filter(clip => !selected.has(clip.id));
    else updated = captures.map(clip => selected.has(clip.id) ? editCapture(clip, message.values || {}) : clip);
    if (stored[CLIP_STATE_KEY]) pruneDeliveryState(stored[CLIP_STATE_KEY], updated);
    await chrome.storage.local.set({ captures: updated, ...(stored[CLIP_STATE_KEY] ? { [CLIP_STATE_KEY]: stored[CLIP_STATE_KEY] } : {}) });
    return { success: true };
  });
}

function appTargetKey(value) {
  const url = new URL(value);
  if (url.username || url.password) throw new Error('App addresses cannot contain credentials');
  if (url.protocol === 'file:') { url.hash = ''; url.search = ''; return url.href; }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Use an HTTP(S) app or an exact standalone file');
  return url.origin;
}

function isExtensionPage(sender) {
  return sender.id === chrome.runtime.id && typeof sender.url === 'string'
    && sender.url.startsWith(chrome.runtime.getURL('/')) && (!sender.frameId || sender.frameId === 0);
}

async function approvedSender(sender) {
  if (sender.id !== chrome.runtime.id) throw new Error('Unrecognized extension sender');
  if (isExtensionPage(sender)) return { internal: true, key: 'extension' };
  if (sender.frameId !== 0 || !sender.tab?.url || !sender.url) throw new Error('Only an approved top-level app may use this feature');
  const key = appTargetKey(sender.url);
  if (appTargetKey(sender.tab.url) !== key) throw new Error('The app tab changed; reconnect from extension settings');
  const stored = await chrome.storage.local.get([APP_APPROVAL_KEY]);
  const approval = stored[APP_APPROVAL_KEY]?.[key];
  if (!approval) throw new Error('Approve this exact app address in ThreatCaddy extension settings first');
  return { key, approval, internal: false };
}

function publicFetchURL(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use a credential-free HTTP(S) URL');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  // Public hostname policy shared by fetch and integration proxy. DNS cannot be
  // pinned by a portable WebExtension; host permission remains a separate boundary.
  if (!host.includes('.') || host.includes(':') || /^[\d.]+$/.test(host)
    || ['.localhost', '.local', '.internal', '.home', '.lan'].some(suffix => host.endsWith(suffix))) {
    throw new Error('Private, local, and literal-IP destinations are not allowed for web fetch or integration proxy');
  }
  return url;
}

async function readBoundedResponse(response, limit = MAX_FETCH_BYTES) {
  const size = Number(response.headers.get('content-length'));
  if (Number.isFinite(size) && size > limit) throw new Error('Response exceeds the 5 MiB limit');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let result = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new Error('Response exceeds the 5 MiB limit');
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
}
async function boundedFetch(url, options, timeout, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    controller.signal.throwIfAborted();
    const response = await fetch(url, { ...options, signal: controller.signal, redirect: 'error', credentials: 'omit' });
    const text = await readBoundedResponse(response);
    controller.signal.throwIfAborted();
    return { response, text };
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

// Short-lived cancellation records also cover an abort arriving during the
// request's asynchronous authorization read. They contain no body or credentials.
const proxyRequests = new Map();
function proxyRequestKey(message, sender, context) {
  if (typeof message.requestId !== 'string' || !message.requestId || message.requestId.length > 128
      || typeof message.documentToken !== 'string' || !message.documentToken || message.documentToken.length > 128) throw new Error('Invalid proxy request identity');
  return JSON.stringify([context.key, approvalGeneration(context.approval), sender.tab?.id,
    sender.frameId ?? 0, sender.documentId || '', message.documentToken, message.requestId]);
}
function proxyRequest(key) {
  if (proxyRequests.has(key)) return proxyRequests.get(key);
  if (proxyRequests.size >= 128) throw new Error('Too many pending proxy requests; wait and retry');
  const state = { controller: new AbortController(), started: false };
  state.timer = setTimeout(() => { state.controller.abort(); proxyRequests.delete(key); }, 60000);
  proxyRequests.set(key, state);
  return state;
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[APP_APPROVAL_KEY]) {
    for (const state of proxyRequests.values()) state.controller.abort();
  }
});

// ── Dynamic bridge.js registration (MV3) ────────────────────────────────
// No app is implicitly trusted. Only explicitly paired targets receive a bridge.
// HTTP(S) uses dynamic registration; exact approved files use tab injection.

const DYNAMIC_BRIDGE_SCRIPT_ID = 'dynamic-bridge';

function targetUrlToMatchPattern(targetUrl) {
  try {
    const key = appTargetKey(targetUrl);
    const parsed = new URL(key);
    if (parsed.protocol === 'file:') return null;
    // Match patterns cannot consistently constrain ports across browsers.
    // The background sender check and readiness handshake do constrain them.
    return parsed.protocol + '//' + parsed.hostname + '/*';
  } catch { return null; }
}

async function unregisterDynamicBridge() {
  try { await chrome.scripting.unregisterContentScripts({ ids: [DYNAMIC_BRIDGE_SCRIPT_ID] }); }
  catch { /* Not registered. */ }
}

let bridgeRegistrationTail = Promise.resolve();
function syncBridgeRegistration() {
  const next = bridgeRegistrationTail.then(reconcileBridgeRegistration);
  bridgeRegistrationTail = next.catch(() => {});
  return next;
}
async function reconcileBridgeRegistration() {
  const stored = await chrome.storage.local.get([APP_APPROVAL_KEY]);
  const patterns = [...new Set(Object.keys(stored[APP_APPROVAL_KEY] ?? {}).map(targetUrlToMatchPattern).filter(Boolean))];
  await unregisterDynamicBridge();
  if (!patterns.length) return;
  try {
    await chrome.scripting.registerContentScripts([{
      id: DYNAMIC_BRIDGE_SCRIPT_ID, matches: patterns, js: ['bridge.js'], runAt: 'document_idle', allFrames: false,
    }]);
  } catch (error) { console.warn('Approved app bridge registration failed:', error); }
}

syncBridgeRegistration();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[APP_APPROVAL_KEY]) syncBridgeRegistration();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url?.startsWith('file://')) return;
  const stored = await chrome.storage.local.get([APP_APPROVAL_KEY]);
  if (!stored[APP_APPROVAL_KEY]?.[appTargetKey(tab.url)]) return;
  try { await chrome.scripting.executeScript({ target: { tabId }, files: ['bridge.js'] }); }
  catch { /* File access was not granted. */ }
});

// Injected into the page to capture selection as markdown with inline images
async function getSelectionAsMarkdown() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return '';

  const range = sel.getRangeAt(0);
  const frag = range.cloneContents();

  // Put fragment in a temporary div so we can walk it
  const div = document.createElement('div');
  div.appendChild(frag);

  // If there are no element nodes, just return plain text
  if (!div.querySelector('*')) return sel.toString();

  // Resolve relative URLs to absolute
  div.querySelectorAll('img[src]').forEach(img => {
    try { img.src = new URL(img.getAttribute('src'), document.baseURI).href; } catch { /* Preserve the original attribute if it cannot be resolved. */ }
  });
  div.querySelectorAll('a[href]').forEach(a => {
    try { a.href = new URL(a.getAttribute('href'), document.baseURI).href; } catch { /* Preserve the original attribute if it cannot be resolved. */ }
  });

  // Convert images to inline base64 data URIs for offline use
  function drawToCanvas(img) {
    let w = img.naturalWidth, h = img.naturalHeight;
    const MAX = 1200;
    if (w > MAX || h > MAX) {
      const s = MAX / Math.max(w, h);
      w = Math.round(w * s);
      h = Math.round(h * s);
    }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/webp', 0.85);
  }

  const MAX_DATA_URI_LEN = 500_000; // ~375KB

  function capDataUri(uri) {
    return uri && uri.length <= MAX_DATA_URI_LEN ? uri : null;
  }

  function imgToDataUri(src) {
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(null), 5000);

      // Try 1: draw the page's already-loaded image (works for same-origin)
      for (const pi of document.querySelectorAll('img')) {
        if (pi.src === src && pi.complete && pi.naturalWidth > 0) {
          try { clearTimeout(timer); return resolve(capDataUri(drawToCanvas(pi))); } catch { /* Try the existing fetch fallback when canvas access is unavailable. */ }
          break;
        }
      }

      // Try 2: fetch as blob (works for CORS-enabled CDNs)
      fetch(src, { mode: 'cors' })
        .then(r => { if (!r.ok) throw 0; return r.blob(); })
        .then(blob => {
          const reader = new FileReader();
          reader.onload = () => {
            const img = new Image();
            img.onload = () => {
              try { clearTimeout(timer); resolve(capDataUri(drawToCanvas(img))); }
              catch { clearTimeout(timer); resolve(capDataUri(reader.result)); }
            };
            img.onerror = () => { clearTimeout(timer); resolve(capDataUri(reader.result)); };
            img.src = reader.result;
          };
          reader.onerror = () => { clearTimeout(timer); resolve(null); };
          reader.readAsDataURL(blob);
        })
        .catch(() => { clearTimeout(timer); resolve(null); });
    });
  }

  await Promise.all(Array.from(div.querySelectorAll('img[src]')).map(async imgEl => {
    const src = imgEl.getAttribute('src');
    if (!src || src.startsWith('data:')) return;
    const dataUri = await imgToDataUri(src);
    if (dataUri) imgEl.setAttribute('src', dataUri);
  }));

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style') return '';

    if (tag === 'img') {
      const src = node.getAttribute('src') || '';
      const alt = node.getAttribute('alt') || '';
      return `![${alt}](${src})`;
    }

    const inner = Array.from(node.childNodes).map(c => walk(c)).join('');

    switch (tag) {
      case 'a': {
        const href = node.getAttribute('href') || '';
        return inner.trim() ? `[${inner.trim()}](${href})` : '';
      }
      case 'strong': case 'b':
        return inner.trim() ? `**${inner.trim()}**` : '';
      case 'em': case 'i':
        return inner.trim() ? `*${inner.trim()}*` : '';
      case 'h1': return `\n\n# ${inner.trim()}\n\n`;
      case 'h2': return `\n\n## ${inner.trim()}\n\n`;
      case 'h3': return `\n\n### ${inner.trim()}\n\n`;
      case 'h4': return `\n\n#### ${inner.trim()}\n\n`;
      case 'h5': return `\n\n##### ${inner.trim()}\n\n`;
      case 'h6': return `\n\n###### ${inner.trim()}\n\n`;
      case 'p': return `\n\n${inner.trim()}\n\n`;
      case 'br': return '\n';
      case 'hr': return '\n\n---\n\n';
      case 'pre': {
        const code = node.querySelector('code');
        const text = code ? code.textContent : node.textContent;
        return `\n\n\`\`\`\n${text}\n\`\`\`\n\n`;
      }
      case 'code':
        if (node.parentElement && node.parentElement.tagName.toLowerCase() === 'pre') return inner;
        return `\`${inner}\``;
      case 'blockquote':
        return '\n\n' + inner.trim().split('\n').map(l => `> ${l}`).join('\n') + '\n\n';
      case 'ul': case 'ol':
        return `\n\n${inner}\n\n`;
      case 'li': {
        const parent = node.parentElement;
        const ordered = parent && parent.tagName.toLowerCase() === 'ol';
        const idx = ordered ? Array.from(parent.children).indexOf(node) + 1 : 0;
        const prefix = ordered ? `${idx}. ` : '- ';
        return `${prefix}${inner.trim()}\n`;
      }
      default:
        return inner;
    }
  }

  let md = walk(div);
  // Clean up excessive newlines
  md = md.replace(/\n{3,}/g, '\n\n').trim();
  return md || sel.toString();
}

// Injected into the page to capture the full page body as markdown
async function getPageAsMarkdown() {
  const MAX_OUTPUT = 50000; // 50KB text limit

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'svg') return '';

    const inner = Array.from(node.childNodes).map(c => walk(c)).join('');

    switch (tag) {
      case 'a': {
        const href = node.getAttribute('href') || '';
        return inner.trim() ? `[${inner.trim()}](${href})` : '';
      }
      case 'strong': case 'b':
        return inner.trim() ? `**${inner.trim()}**` : '';
      case 'em': case 'i':
        return inner.trim() ? `*${inner.trim()}*` : '';
      case 'h1': return `\n\n# ${inner.trim()}\n\n`;
      case 'h2': return `\n\n## ${inner.trim()}\n\n`;
      case 'h3': return `\n\n### ${inner.trim()}\n\n`;
      case 'h4': return `\n\n#### ${inner.trim()}\n\n`;
      case 'h5': return `\n\n##### ${inner.trim()}\n\n`;
      case 'h6': return `\n\n###### ${inner.trim()}\n\n`;
      case 'p': return `\n\n${inner.trim()}\n\n`;
      case 'br': return '\n';
      case 'hr': return '\n\n---\n\n';
      case 'pre': {
        const code = node.querySelector('code');
        const text = code ? code.textContent : node.textContent;
        return `\n\n\`\`\`\n${text}\n\`\`\`\n\n`;
      }
      case 'code':
        if (node.parentElement && node.parentElement.tagName.toLowerCase() === 'pre') return inner;
        return `\`${inner}\``;
      case 'blockquote':
        return '\n\n' + inner.trim().split('\n').map(l => `> ${l}`).join('\n') + '\n\n';
      case 'ul': case 'ol':
        return `\n\n${inner}\n\n`;
      case 'li': {
        const parent = node.parentElement;
        const ordered = parent && parent.tagName.toLowerCase() === 'ol';
        const idx = ordered ? Array.from(parent.children).indexOf(node) + 1 : 0;
        const prefix = ordered ? `${idx}. ` : '- ';
        return `${prefix}${inner.trim()}\n`;
      }
      case 'img': {
        const alt = node.getAttribute('alt') || '';
        const src = node.getAttribute('src') || '';
        return `![${alt}](${src})`;
      }
      default:
        return inner;
    }
  }

  let md = `# ${document.title}\n\n` + walk(document.body);
  md = md.replace(/\n{3,}/g, '\n\n').trim();
  if (md.length > MAX_OUTPUT) md = md.substring(0, MAX_OUTPUT) + '\n\n...(truncated)';
  return md;
}

// Create context menu on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'save-to-threatcaddy',
    title: chrome.i18n.getMessage('contextMenuSaveToThreatCaddy'),
    contexts: ['selection']
  });
  // Re-sync dynamic bridge registration on install/update
  syncBridgeRegistration();
});

// Handle context menu click
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'save-to-threatcaddy' && info.selectionText) {
    let text = info.selectionText;
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: getSelectionAsMarkdown
      });
      if (result && result.result) text = result.result;
    } catch {
      // Restricted page — fall back to info.selectionText
    }
    await captureAndSave(text, tab);
  }
});

// Handle keyboard shortcut — capture selection if any, otherwise capture full page
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'capture-selection') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    try {
      // Try selection first
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: getSelectionAsMarkdown
      });

      if (result && result.result) {
        await captureAndSave(result.result, tab);
        return;
      }

      // No selection — capture full page
      const [pageResult] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: getPageAsMarkdown
      });

      if (pageResult && pageResult.result) {
        await captureAndSave(pageResult.result, tab);
      }
    } catch (error) {
      console.error('Failed to capture:', error);
    }
  }
});

// Convert raw HTML to readable markdown text (regex-based, no DOM needed)
function htmlToText(html) {
  // Cap input to 2MB to prevent regex backtracking on giant pages
  if (html.length > 2_000_000) {
    html = html.substring(0, 2_000_000);
  }

  // Extract title before any processing
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';

  let text = html;

  // Remove scripts, styles, and noscript blocks (non-greedy, tag-to-tag)
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  text = text.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '');
  text = text.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '');
  text = text.replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '');
  text = text.replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '');
  text = text.replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '');

  // Convert headings to markdown
  for (let i = 1; i <= 6; i++) {
    const hashes = '#'.repeat(i);
    text = text.replace(new RegExp(`<h${i}[^>]*>([^<]*(?:<(?!/h${i})[^<]*)*)</h${i}>`, 'gi'),
      `\n\n${hashes} $1\n\n`);
  }

  // Convert links: <a href="url">text</a> → [text](url)
  text = text.replace(/<a[^>]+href="([^"]*)"[^>]*>([^<]*(?:<(?!\/a)[^<]*)*)<\/a>/gi, '[$2]($1)');

  // Convert bold and italic
  text = text.replace(/<(?:strong|b)\b[^>]*>([^<]*(?:<(?!\/(?:strong|b)>)[^<]*)*)<\/(?:strong|b)>/gi, '**$1**');
  text = text.replace(/<(?:em|i)\b[^>]*>([^<]*(?:<(?!\/(?:em|i)>)[^<]*)*)<\/(?:em|i)>/gi, '*$1*');

  // Convert code blocks
  text = text.replace(/<pre[^>]*>(?:<code[^>]*>)?([^<]*(?:<(?!\/(?:code|pre)>)[^<]*)*?)(?:<\/code>)?<\/pre>/gi, '\n\n```\n$1\n```\n\n');
  text = text.replace(/<code[^>]*>([^<]*)<\/code>/gi, '`$1`');

  // Convert lists
  text = text.replace(/<li[^>]*>([^<]*(?:<(?!\/li>)[^<]*)*)<\/li>/gi, '- $1\n');

  // Convert paragraphs and line breaks
  text = text.replace(/<p[^>]*>/gi, '\n\n');
  text = text.replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<hr\s*\/?>/gi, '\n\n---\n\n');
  text = text.replace(/<\/(?:div|section|article)>/gi, '\n');

  // Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode common HTML entities
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
  text = text.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

  // Clean up whitespace
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n[ \t]+/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.trim();

  // Truncate to 50KB
  if (text.length > 50000) {
    text = text.substring(0, 50000) + '\n\n...(truncated)';
  }

  return { title, content: text };
}

// Handle messages from popup and content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (sender.id === chrome.runtime.id && message.type === 'OPEN_CLIPS_PAGE') {
      await chrome.tabs.create({ url: chrome.runtime.getURL('pages/clips.html') });
      sendResponse({ success: true }); return;
    }
    const context = await approvedSender(sender);
    const appMessages = ['PING', 'SET_PROXY_DOMAINS', 'FETCH_URL', 'PROXY_FETCH', 'PROXY_ABORT', 'SEND_NOTIFICATION', 'CLIP_IMPORT_RESULT'];
    if (!context.internal && !appMessages.includes(message.type)) throw new Error('This operation is available only from the extension');
    if (message.type === 'APPROVE_APP' || message.type === 'UPDATE_LOCAL_LLM_APPROVAL') {
      const key = appTargetKey(message.targetUrl);
      // Firefox preserves undefined properties while Chrome may omit them.
      // Only an explicit string updates the approval; '' is explicit removal.
      const updatesLocalAI = typeof message.localLLMUrl === 'string';
      if (!updatesLocalAI && message.localLLMUrl !== undefined) throw new Error('Invalid local AI endpoint');
      let localLLMOrigin = message.localLLMUrl ? new URL(message.localLLMUrl).origin : undefined;
      if (localLLMOrigin && !/^https?:\/\//.test(localLLMOrigin)) throw new Error('Local AI endpoint must be HTTP(S)');
      if (message.localLLMUrl && (new URL(message.localLLMUrl).username || new URL(message.localLLMUrl).password)) throw new Error('Local AI endpoint must not contain credentials');
      await serializeStorage(async () => {
        const stored = await chrome.storage.local.get([APP_APPROVAL_KEY, 'settings', 'appApprovalSequenceV1']);
        if (message.type === 'UPDATE_LOCAL_LLM_APPROVAL' && (!stored[APP_APPROVAL_KEY]?.[key] || !updatesLocalAI)) throw new Error('Approve this app first, then explicitly save or remove its local AI endpoint');
        if (!updatesLocalAI) localLLMOrigin = stored[APP_APPROVAL_KEY]?.[key]?.localLLMOrigin;
        if (message.type === 'UPDATE_LOCAL_LLM_APPROVAL' && localLLMOrigin
            && !await chrome.permissions.contains({ origins: [targetUrlToMatchPattern(localLLMOrigin)] })) throw new Error('Local AI host permission was not granted');
        const approvedAt = Math.max(Date.now(), (stored.appApprovalSequenceV1 || 0) + 1);
        await chrome.storage.local.set({
          [APP_APPROVAL_KEY]: { ...stored[APP_APPROVAL_KEY], [key]: { approvedAt, generation: crypto.randomUUID(), localLLMOrigin } },
          appApprovalSequenceV1: approvedAt,
          settings: message.type === 'APPROVE_APP' ? { ...stored.settings, targetUrl: message.targetUrl } : stored.settings || {},
        });
        await chrome.storage.local.remove('proxyPolicyV1:' + key);
        await syncBridgeRegistration();
      });
      sendResponse({ success: true });
      return;
    }
    if (message.type === 'PROXY_ABORT') {
      const state = proxyRequest(proxyRequestKey(message, sender, context));
      state.controller.abort();
      sendResponse({ success: true }); return;
    }
    if (message.type === 'REVOKE_APPS') {
      await serializeStorage(async () => {
        await chrome.storage.local.set({ [APP_APPROVAL_KEY]: {}, proxyPoliciesV1: {} });
        await syncBridgeRegistration();
      });
      sendResponse({ success: true });
      return;
    }
    if (['DELETE_CAPTURES', 'UPDATE_CAPTURES'].includes(message.type)) {
      sendResponse(await mutateCaptures(message)); return;
    }
    if (message.type === 'PREPARE_CLIP_DELIVERY') {
      sendResponse(await prepareClipDelivery(message.targetUrl)); return;
    }
    if (message.type === 'CLIP_IMPORT_RESULT') {
      sendResponse(await acknowledgeClips(message.result, sender, context)); return;
    }
    handleApprovedMessage(message, sender, sendResponse, context);
  })().catch(error => sendResponse({ success: false, loaded: false, error: error.message }));
  return true;
});

function handleApprovedMessage(message, sender, sendResponse, context) {
  if (message.type === 'SET_PROXY_DOMAINS') {
    const domains = Array.isArray(message.domains)
      ? [...new Set(message.domains.filter(d => typeof d === 'string' && d.length < 254).map(d => d.toLowerCase().replace(/\.$/, '')).filter(d => {
        try { return publicFetchURL('https://' + d).hostname === d; } catch { return false; }
      }))].slice(0, 100)
      : [];
    // Separate storage keys prevent simultaneous app tabs overwriting each other's policy.
    chrome.storage.local.set({ ['proxyPolicyV1:' + context.key]: { domains, updatedAt: Date.now(), approvedAt: context.approval?.approvedAt, approvalGeneration: approvalGeneration(context.approval) } })
      .then(() => sendResponse({ success: true }), error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (message.type === 'PING') {
    sendResponse({ loaded: true });
  } else if (message.type === 'FETCH_URL') {
    // Validate URL scheme
    let parsed;
    try {
      parsed = publicFetchURL(message.url);
    } catch {
      sendResponse({ success: false, error: chrome.i18n.getMessage('errorInvalidUrl') });
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      sendResponse({ success: false, error: chrome.i18n.getMessage('errorHttpHttpsOnly') });
      return;
    }
    (async () => {
      try {
        // Ensure we have host permission for this origin
        const origin = parsed.origin + '/*';
        const hasPermission = await chrome.permissions.contains({ origins: [origin] });
        if (!hasPermission) {
            sendResponse({
              success: false,
              error: chrome.i18n.getMessage('errorUrlPermissionRequired'),
            });
            return;
        }
        const { response: resp, text: html } = await boundedFetch(message.url, {
          headers: { 'Accept': 'text/html,application/xhtml+xml,*/*' },
        }, 15000);
        if (!resp.ok) {
          sendResponse({ success: false, error: `HTTP ${resp.status} ${resp.statusText}` });
          return;
        }
        const { title, content } = htmlToText(html);
        sendResponse({ success: true, title, content, url: message.url });
      } catch (err) {
        const msg = err.name === 'AbortError'
          ? chrome.i18n.getMessage('errorRequestTimedOut15')
          : (err.message || String(err));
        sendResponse({ success: false, error: msg });
      }
    })();
    return true;
  } else if (message.type === 'PROXY_FETCH') {
    // Fetch proxy for integration API calls (bypasses CSP/CORS).
    // Defense-in-depth: block private/internal IPs and validate against stored allowed domains.
    let parsed;
    try {
      parsed = publicFetchURL(message.url);
    } catch {
      sendResponse({ success: false, error: chrome.i18n.getMessage('errorInvalidUrl') });
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      sendResponse({ success: false, error: chrome.i18n.getMessage('errorHttpHttpsOnly') });
      return;
    }
    const hostname = parsed.hostname;
    const requestKey = message.requestId === undefined ? undefined : proxyRequestKey(message, sender, context);
    const request = requestKey ? proxyRequest(requestKey) : undefined;
    if (request?.started) throw new Error('Proxy request is already running');
    if (request) request.started = true;
    (async () => {
      try {
        request?.controller.signal.throwIfAborted();
        // Validate hostname against stored allowed proxy domains
        const policyKey = 'proxyPolicyV1:' + context.key;
        const stored = await chrome.storage.local.get([policyKey]);
        const policy = stored[policyKey];
        const policyGeneration = policy?.approvalGeneration || (Number.isFinite(policy?.approvedAt) ? `legacy:${policy.approvedAt}` : undefined);
        if (!policy || !Number.isFinite(policy.updatedAt) || policyGeneration !== approvalGeneration(context.approval)
            || Date.now() - policy.updatedAt > POLICY_MAX_AGE || !policy.domains?.includes(hostname)) {
            sendResponse({ success: false, error: chrome.i18n.getMessage('errorBlockedDomain', [hostname]) });
            return;
        }
        // Ensure we have host permission
        const origin = parsed.origin + '/*';
        const hasPermission = await chrome.permissions.contains({ origins: [origin] });
        if (!hasPermission) {
            sendResponse({ success: false, error: chrome.i18n.getMessage('errorHostPermissionRequired', [parsed.hostname]) });
            return;
        }
        const fetchOptions = {
          method: message.method || 'GET',
          headers: message.headers || {},
          redirect: 'error',
          credentials: 'omit',
        };
        if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(fetchOptions.method)) throw new Error('Unsupported HTTP method');
        if (message.body && (typeof message.body !== 'string' || new TextEncoder().encode(message.body).byteLength > 1024 * 1024)) throw new Error('Request body exceeds 1 MiB');
        if (message.body && message.method !== 'GET') {
          fetchOptions.body = message.body;
        }
        const fresh = await approvedSender(sender);
        if (approvalGeneration(fresh.approval) !== approvalGeneration(context.approval)) throw new Error('App approval changed; retry from the app');
        request?.controller.signal.throwIfAborted();
        const { response: resp, text } = await boundedFetch(message.url, fetchOptions, 30000, request?.controller.signal);
        let data;
        try { data = JSON.parse(text); } catch { data = text; }
        const headers = {};
        resp.headers.forEach((v, k) => { headers[k] = v; });
        sendResponse({
          success: resp.ok,
          status: resp.status,
          statusText: resp.statusText,
          data,
          headers,
          error: resp.ok ? null : `HTTP ${resp.status} ${resp.statusText}`,
        });
      } catch (err) {
        const msg = err.name === 'AbortError'
          ? chrome.i18n.getMessage('errorRequestTimedOut30')
          : (err.message || String(err));
        sendResponse({ success: false, error: msg });
      } finally {
        if (requestKey) { clearTimeout(request.timer); proxyRequests.delete(requestKey); }
      }
    })();
    return true;
  } else if (message.type === 'SAVE_NOTE') {
    saveCapture(message.note).then(capture => {
      sendResponse({ success: true, id: capture.id, revision: capture.revision });
    }).catch(error => {
      console.error('Failed to save:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  } else if (message.type === 'GET_STATS') {
    getStats().then(stats => {
      sendResponse(stats);
    });
    return true;
  } else if (message.type === 'OPEN_CLIPS_PAGE') {
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/clips.html') });
    sendResponse({ success: true });
  } else if (message.type === 'SEND_TO_TARGET') {
    sendToTarget(message.sessionId, message.clips).then(result => {
      sendResponse(result);
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  } else if (message.type === 'SEND_NOTIFICATION') {
    (async () => {
    if (!await chrome.permissions.contains({ permissions: ['notifications'] })) throw new Error('Desktop notifications are disabled. Enable them in extension settings; the in-app alert is retained.');
    const current = await approvedSender(sender);
    if (current.key !== context.key || approvalGeneration(current.approval) !== approvalGeneration(context.approval)) {
      throw new Error('App approval changed before notification delivery. Reconnect from extension settings.');
    }
    const id = await chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('assets/icon-128.png'),
      title: String(message.title || chrome.i18n.getMessage('notificationDefaultTitle')).slice(0, 200),
      message: String(message.message || '').slice(0, 500),
      priority: message.severity === 'critical' ? 2 : 1,
    });
    if (!id) throw new Error('The browser did not accept the desktop notification');
    sendResponse({ success: true, accepted: true, notificationId: id });
    })().catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
}

// ── LLM Streaming via long-lived ports ─────────────────────────────────

chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith('llm-')) return;

  const abortController = new AbortController();
  let portDisconnected = false;
  let running = false;
  const approvalChanged = (changes, area) => {
    if (area === 'local' && changes[APP_APPROVAL_KEY]) finish();
  };
  chrome.storage.onChanged.addListener(approvalChanged);

  function finish() {
    if (portDisconnected) return;
    portDisconnected = true;
    abortController.abort();
    chrome.storage.onChanged.removeListener(approvalChanged);
    port.onDisconnect.removeListener(finish);
    port.onMessage.removeListener(receive);
    try { port.disconnect(); } catch { /* Already disconnected. */ }
  }
  port.onDisconnect.addListener(finish);

  // Safe wrapper — silently drops messages if the port already disconnected
  function safeSend(msg) {
    if (portDisconnected) return;
    try { port.postMessage(msg); } catch { finish(); }
  }

  async function receive(payload) {
    let ownsRequest = false;
    try {
      if (portDisconnected) return;
      if (running) throw new Error('Only one request per streaming connection is allowed');
      running = true;
      ownsRequest = true;
      const context = await approvedSender(port.sender ?? {});
      if (portDisconnected) return;
      if (context.internal) throw new Error('LLM streaming requires an approved app tab');
      if (payload.provider === 'local') {
        const origin = new URL(payload.endpoint || 'http://localhost:11434/v1').origin;
        if (!context.approval.localLLMOrigin || origin !== context.approval.localLLMOrigin) throw new Error('Approve this local AI endpoint for this app in extension settings');
      }
      if (payload.provider === 'anthropic') {
        await streamAnthropic(safeSend, payload, abortController.signal);
      } else if (payload.provider === 'openai') {
        await streamOpenAI(safeSend, payload, abortController.signal);
      } else if (payload.provider === 'gemini') {
        await streamGemini(safeSend, payload, abortController.signal);
      } else if (payload.provider === 'mistral') {
        await streamMistral(safeSend, payload, abortController.signal);
      } else if (payload.provider === 'local') {
        await streamLocal(safeSend, payload, abortController.signal);
      } else {
        safeSend({ type: 'error', error: chrome.i18n.getMessage('errorUnknownProvider', [payload.provider]) });
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      safeSend({ type: 'error', error: err.message || chrome.i18n.getMessage('errorUnknown') });
    } finally {
      if (ownsRequest) finish();
    }
  }
  port.onMessage.addListener(receive);
});

// Check host permission before making LLM API calls (AI API origins are optional_host_permissions)
async function ensureLLMPermission(url, signal) {
  signal.throwIfAborted();
  // Native host patterns are portless in Firefox. The app approval still
  // separately binds the exact endpoint origin, including its port.
  const origin = targetUrlToMatchPattern(url);
  const has = await chrome.permissions.contains({ origins: [origin] });
  signal.throwIfAborted();
  if (!has) {
    throw new Error(
      chrome.i18n.getMessage('errorCaddyAIPermission')
    );
  }
}

async function streamAnthropic(send, payload, signal) {
  await ensureLLMPermission('https://api.anthropic.com/v1/messages', signal);

  // Support both API keys (sk-ant-...) and OAuth/Bearer tokens
  const isApiKey = payload.apiKey.startsWith('sk-ant-');
  const authHeaders = isApiKey
    ? { 'x-api-key': payload.apiKey, 'anthropic-dangerous-direct-browser-access': 'true' }
    : { 'Authorization': `Bearer ${payload.apiKey}` };

  // Build messages — pass structured content through as-is
  const messages = payload.messages.map((m) => {
    if (typeof m.content === 'string') return { role: m.role, content: m.content };
    // Structured content (e.g. tool_result blocks) — pass through
    return { role: m.role, content: m.content };
  });

  const body = {
    model: payload.model,
    max_tokens: 8192,
    stream: true,
    system: payload.systemPrompt || undefined,
    messages,
  };
  if (payload.tools && payload.tools.length > 0) {
    body.tools = payload.tools;
  }

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal,
    redirect: 'error',
    credentials: 'omit',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...authHeaders,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const respBody = await resp.text().catch(() => '');
    send({ type: 'error', error: `Anthropic API ${resp.status}: ${respBody}` });
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // Track content blocks for tool calling
  const contentBlocks = [];
  let currentBlockIndex = -1;
  let stopReason = null;
  let usage = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);

        if (parsed.type === 'content_block_start') {
          currentBlockIndex = parsed.index;
          const block = parsed.content_block;
          if (block.type === 'text') {
            contentBlocks[currentBlockIndex] = { type: 'text', text: '' };
          } else if (block.type === 'tool_use') {
            contentBlocks[currentBlockIndex] = { type: 'tool_use', id: block.id, name: block.name, input: '' };
          }
        }

        if (parsed.type === 'content_block_delta') {
          const block = contentBlocks[parsed.index];
          if (parsed.delta?.type === 'text_delta' && parsed.delta.text) {
            if (block) block.text += parsed.delta.text;
            send({ type: 'chunk', content: parsed.delta.text });
          } else if (parsed.delta?.type === 'input_json_delta' && parsed.delta.partial_json) {
            if (block) block.input += parsed.delta.partial_json;
          }
        }

        if (parsed.type === 'content_block_stop') {
          const block = contentBlocks[parsed.index];
          if (block && block.type === 'tool_use' && typeof block.input === 'string') {
            try { block.input = JSON.parse(block.input); } catch { block.input = {}; }
          }
        }

        if (parsed.type === 'message_start' && parsed.message?.usage) {
          usage = { input: parsed.message.usage.input_tokens || 0, output: 0 };
        }

        if (parsed.type === 'message_delta') {
          if (parsed.delta?.stop_reason) stopReason = parsed.delta.stop_reason;
          if (parsed.usage?.output_tokens && usage) usage.output = parsed.usage.output_tokens;
        }

        if (parsed.type === 'error') {
          const msg = parsed.error?.message || parsed.error?.type || 'Streaming error';
          send({ type: 'error', error: `Anthropic mid-stream error: ${msg}` });
          return;
        }
      } catch { /* Preserve the existing tolerant stream behavior for malformed events. */ }
    }
  }

  send({ type: 'done', stopReason: stopReason || 'end_turn', contentBlocks, usage });
}

// Parse tool calls from model text output (fallback for local LLMs that don't use structured tool_calls).
// Supports: <tool_call>{"name":"...","arguments":{...}}</tool_call>, <function_call>...</function_call>,
// and ```json blocks with name+arguments/parameters.
function parseToolCallsFromText(text, toolNames) {
  const calls = [];
  const nameSet = new Set(toolNames || []);

  // Pattern 1: <tool_call>JSON</tool_call> or <function_call>JSON</function_call>
  const tagPattern = /<(?:tool_call|function_call)>\s*([\s\S]*?)\s*<\/(?:tool_call|function_call)>/gi;
  let match;
  while ((match = tagPattern.exec(text)) !== null) {
    try {
      const obj = JSON.parse(match[1]);
      const name = obj.name || obj.function;
      const args = obj.arguments || obj.parameters || obj.input || {};
      if (name && nameSet.has(name)) {
        calls.push({ name, arguments: typeof args === 'string' ? JSON.parse(args) : args });
      }
    } catch { /* This text candidate is not a usable tool-call object. */ }
  }
  if (calls.length > 0) return calls;

  // Pattern 2: JSON blocks (```json or bare) containing {name, arguments/parameters}
  const jsonBlockPattern = /```(?:json)?\s*\n?([\s\S]*?)\n?```/gi;
  while ((match = jsonBlockPattern.exec(text)) !== null) {
    try {
      const obj = JSON.parse(match[1]);
      const name = obj.name || obj.function;
      const args = obj.arguments || obj.parameters || obj.input || {};
      if (name && nameSet.has(name)) {
        calls.push({ name, arguments: typeof args === 'string' ? JSON.parse(args) : args });
      }
    } catch { /* This text candidate is not a usable tool-call object. */ }
  }

  return calls;
}

// Shared streamer for OpenAI-compatible APIs (OpenAI, Mistral, Local/Ollama/vLLM)
async function streamOpenAICompatible(send, payload, signal, endpoint, headers, providerLabel, options = {}) {
  await ensureLLMPermission(endpoint, signal);

  const messages = [];
  if (payload.systemPrompt) {
    messages.push({ role: 'system', content: payload.systemPrompt });
  }

  // Convert structured messages for OpenAI format
  for (const m of payload.messages) {
    if (m.role === 'assistant' && Array.isArray(m.content)) {
      let textContent = '';
      const toolCalls = [];
      for (const block of m.content) {
        if (block.type === 'text') textContent += block.text;
        else if (block.type === 'tool_use') {
          toolCalls.push({ id: block.id, type: 'function', function: { name: block.name, arguments: JSON.stringify(block.input) } });
        }
      }
      const msg = { role: 'assistant', content: textContent || null };
      if (toolCalls.length > 0) msg.tool_calls = toolCalls;
      messages.push(msg);
    } else if (m.role === 'user' && Array.isArray(m.content)) {
      for (const block of m.content) {
        if (block.type === 'tool_result') {
          messages.push({ role: 'tool', tool_call_id: block.tool_use_id, content: block.content });
        }
      }
    } else {
      messages.push({ role: m.role, content: m.content });
    }
  }

  const body = {
    model: payload.model,
    stream: true,
    messages,
  };

  // Convert Anthropic tool format → OpenAI function format
  if (payload.tools && payload.tools.length > 0) {
    body.tools = payload.tools.map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    }));
  }

  const resp = await fetch(endpoint, {
    method: 'POST',
    signal,
    redirect: 'error',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const respBody = await resp.text().catch(() => '');
    send({ type: 'error', error: `${providerLabel} API ${resp.status}: ${respBody}` });
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let stopReason = null;
  let usage = null;
  const toolCallAccum = {};

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);
        const choice = parsed.choices?.[0];
        if (!choice) continue;

        const content = choice.delta?.content;
        if (content) {
          fullText += content;
          send({ type: 'chunk', content });
        }

        if (choice.delta?.tool_calls) {
          for (const tc of choice.delta.tool_calls) {
            const idx = tc.index;
            if (!toolCallAccum[idx]) toolCallAccum[idx] = { id: '', name: '', arguments: '' };
            if (tc.id) toolCallAccum[idx].id = tc.id;
            if (tc.function?.name) toolCallAccum[idx].name = tc.function.name;
            if (tc.function?.arguments) toolCallAccum[idx].arguments += tc.function.arguments;
          }
        }

        if (choice.finish_reason) {
          stopReason = choice.finish_reason;
        }

        // OpenAI reports usage in the final chunk (with stream_options.include_usage)
        if (parsed.usage) {
          usage = { input: parsed.usage.prompt_tokens || 0, output: parsed.usage.completion_tokens || 0 };
        }

        if (parsed.error) {
          send({ type: 'error', error: `API mid-stream error: ${parsed.error.message || String(parsed.error)}` });
          return;
        }
      } catch { /* Preserve the existing tolerant stream behavior for malformed events. */ }
    }
  }

  const contentBlocks = [];
  const toolEntries = Object.values(toolCallAccum);
  if (toolEntries.length > 0) {
    for (const tc of toolEntries) {
      let parsedArgs = {};
      try { parsedArgs = JSON.parse(tc.arguments); } catch { /* Preserve the existing empty-argument fallback. */ }
      contentBlocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: parsedArgs });
    }
  }

  // Fallback: if no structured tool calls were found and text-based parsing is enabled,
  // try to extract tool calls from the model's text output. Many local LLMs output
  // tool calls as <tool_call>JSON</tool_call> or ```json blocks instead of using
  // the OpenAI tool_calls streaming protocol.
  if (contentBlocks.length === 0 && options.textToolParsing && fullText) {
    const toolNames = (payload.tools || []).map(t => t.name);
    const textCalls = parseToolCallsFromText(fullText, toolNames);
    if (textCalls.length > 0) {
      for (let i = 0; i < textCalls.length; i++) {
        contentBlocks.push({
          type: 'tool_use',
          id: `text_tc_${Date.now()}_${i}`,
          name: textCalls[i].name,
          input: textCalls[i].arguments,
        });
      }
      stopReason = 'tool_calls';
    }
  }

  const normalizedStop = stopReason === 'tool_calls' ? 'tool_use'
    : stopReason === 'stop' ? 'end_turn'
    : stopReason || 'end_turn';

  send({ type: 'done', stopReason: normalizedStop, contentBlocks, usage });
}

async function streamOpenAI(send, payload, signal) {
  await streamOpenAICompatible(
    send, payload, signal,
    'https://api.openai.com/v1/chat/completions',
    { 'Authorization': `Bearer ${payload.apiKey}` },
    'OpenAI'
  );
}

async function streamMistral(send, payload, signal) {
  await streamOpenAICompatible(
    send, payload, signal,
    'https://api.mistral.ai/v1/chat/completions',
    { 'Authorization': `Bearer ${payload.apiKey}` },
    'Mistral'
  );
}

async function streamLocal(send, payload, signal) {
  const base = (payload.endpoint || 'http://localhost:11434/v1').replace(/\/+$/, '');
  const endpoint = `${base}/chat/completions`;

  // Pairing the local endpoint and granting its browser host permission are separate checks.
  const parsed = new URL(endpoint);
  {
    const origin = targetUrlToMatchPattern(endpoint);
    const has = await chrome.permissions.contains({ origins: [origin] });
    if (!has) {
      throw new Error(
        chrome.i18n.getMessage('errorHostPermissionLocalLLM', [parsed.hostname])
      );
    }
  }

  const headers = {};
  if (payload.apiKey) headers['Authorization'] = `Bearer ${payload.apiKey}`;
  await streamOpenAICompatible(
    send, payload, signal,
    endpoint,
    headers,
    'Local LLM',
    { textToolParsing: true }
  );
}

async function streamGemini(send, payload, signal) {
  await ensureLLMPermission('https://generativelanguage.googleapis.com/v1beta/models', signal);

  const model = payload.model;
  const apiKey = payload.apiKey;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;

  // Convert messages: user/assistant → user/model, content → parts[{text}]
  const contents = [];
  for (const m of payload.messages) {
    const role = m.role === 'assistant' ? 'model' : 'user';
    if (Array.isArray(m.content)) {
      const parts = [];
      for (const block of m.content) {
        if (block.type === 'text') {
          parts.push({ text: block.text });
        } else if (block.type === 'tool_use') {
          parts.push({ functionCall: { name: block.name, args: block.input } });
        } else if (block.type === 'tool_result') {
          parts.push({ functionResponse: { name: block.tool_use_id, response: { result: block.content } } });
        }
      }
      contents.push({ role, parts });
    } else {
      contents.push({ role, parts: [{ text: m.content }] });
    }
  }

  const body = { contents };

  // System prompt → systemInstruction
  if (payload.systemPrompt) {
    body.systemInstruction = { parts: [{ text: payload.systemPrompt }] };
  }

  // Convert tool defs → functionDeclarations
  if (payload.tools && payload.tools.length > 0) {
    body.tools = [{
      functionDeclarations: payload.tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      })),
    }];
  }

  const resp = await fetch(url, {
    method: 'POST',
    signal,
    redirect: 'error',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const respBody = await resp.text().catch(() => '');
    send({ type: 'error', error: `Gemini API ${resp.status}: ${respBody}` });
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const contentBlocks = [];
  let stopReason = null;
  let usage = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (!data) continue;
      try {
        const parsed = JSON.parse(data);
        const candidate = parsed.candidates?.[0];
        if (!candidate) continue;

        if (candidate.content?.parts) {
          for (const part of candidate.content.parts) {
            if (part.text) {
              send({ type: 'chunk', content: part.text });
              // Accumulate text into a single text block
              let textBlock = contentBlocks.find(b => b.type === 'text');
              if (!textBlock) {
                textBlock = { type: 'text', text: '' };
                contentBlocks.push(textBlock);
              }
              textBlock.text += part.text;
            }
            if (part.functionCall) {
              contentBlocks.push({
                type: 'tool_use',
                id: `gemini-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                name: part.functionCall.name,
                input: part.functionCall.args || {},
              });
            }
          }
        }

        if (candidate.finishReason) {
          if (candidate.finishReason === 'STOP') stopReason = 'end_turn';
          else if (candidate.finishReason === 'MAX_TOKENS') stopReason = 'max_tokens';
          else stopReason = candidate.finishReason;
        }

        // Gemini reports usage in usageMetadata
        if (parsed.usageMetadata) {
          usage = { input: parsed.usageMetadata.promptTokenCount || 0, output: parsed.usageMetadata.candidatesTokenCount || 0 };
        }
      } catch { /* Preserve the existing tolerant stream behavior for malformed events. */ }
    }
  }

  // Determine if tool_use is the stop reason based on content blocks
  const hasToolUse = contentBlocks.some(b => b.type === 'tool_use');
  if (hasToolUse && stopReason !== 'max_tokens') stopReason = 'tool_use';

  send({ type: 'done', stopReason: stopReason || 'end_turn', contentBlocks, usage });
}

async function readApprovedDeliveryTab(tabId, targetKey, generation) {
  const tab = await chrome.tabs.get(tabId);
  // Read authority after the browser await: a revoked/replaced approval must
  // not survive a delayed navigation lookup.
  const stored = await chrome.storage.local.get([APP_APPROVAL_KEY]);
  if (approvalGeneration(stored[APP_APPROVAL_KEY]?.[targetKey]) !== generation) throw new Error('App approval changed. Prepare the destination again.');
  return tab;
}
function deliveryTabMatches(tab, targetKey) {
  try { return appTargetKey(tab.url) === targetKey; } catch { return false; }
}
async function waitForDeliveryNavigation(tabId, targetKey, generation, newlyOpened) {
  const deadline = Date.now() + 30000;
  do {
    const tab = await readApprovedDeliveryTab(tabId, targetKey, generation);
    if (tab.status === 'complete' && deliveryTabMatches(tab, targetKey)) return;
    // Firefox may initially report about:blank as complete for tabs.create().
    // Only a new tab may pass through that state; no bridge is injected there.
    const initialBlank = newlyOpened && (!tab.url || tab.url === 'about:blank');
    if (tab.status === 'complete' && !initialBlank) throw new Error('The target navigated to a different app; captures were not sent');
    if (Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  } while (Date.now() <= deadline);
  throw new Error('The intended app did not finish loading within 30 seconds. Captures are retained; retry when it is ready.');
}
async function prepareClipDelivery(targetUrl) {
  const targetKey = appTargetKey(targetUrl);
  const approved = await chrome.storage.local.get([APP_APPROVAL_KEY]);
  if (!approved[APP_APPROVAL_KEY]?.[targetKey]) throw new Error('Approve this target in extension settings before sending captures');
  const generation = approvalGeneration(approved[APP_APPROVAL_KEY][targetKey]);
  // Re-validate URL before opening (defense-in-depth; clips page also validates)
  try {
    const parsed = new URL(targetUrl);
    if (!/^(https?|file):$/.test(parsed.protocol)) {
      throw new Error('Invalid target URL protocol');
    }
  } catch {
    throw new Error(chrome.i18n.getMessage('errorInvalidTargetUrl'));
  }

  // Prefer an existing workspace tab, but never infer its workspace from its URL.
  // The clips page confirms the actual probed workspace before any content leaves.
  let tab, newlyOpened = false;
  try {
    const existing = await chrome.tabs.query({});
    tab = existing.filter(candidate => {
      try { return appTargetKey(candidate.url) === targetKey; } catch { return false; }
    }).sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
    if (!tab) { newlyOpened = true; tab = await chrome.tabs.create({ url: targetUrl, active: true }); }
  } catch (err) {
    // Chrome blocks file:// navigation unless "Allow access to file URLs" is enabled
    if (/file url/i.test(err.message) || /local file/i.test(err.message)) {
      throw new Error(
        'File URL access is disabled. In Chrome, go to chrome://extensions → ThreatCaddy → Enable "Allow access to file URLs", then try again.'
      );
    }
    throw err;
  }

  await waitForDeliveryNavigation(tab.id, targetKey, generation, newlyOpened);
  const currentTab = await readApprovedDeliveryTab(tab.id, targetKey, generation);
  if (currentTab.status !== 'complete' || !deliveryTabMatches(currentTab, targetKey)) throw new Error('The destination tab changed before preparation. Captures are retained.');
  // Proactively inject the bridge into this explicitly approved target.
  // Its duplicate-injection guard safely handles an already registered HTTP(S) bridge.
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['bridge.js'] });
  } catch { /* restricted page or missing host permission */ }

  let ready, observedDocument;
  const readinessDeadline = Date.now() + 10000;
  do {
    const probeTab = await readApprovedDeliveryTab(tab.id, targetKey, generation);
    if (probeTab.status !== 'complete' || !deliveryTabMatches(probeTab, targetKey)) throw new Error('The destination tab changed during preparation. Captures are retained.');
    try { ready = await chrome.tabs.sendMessage(tab.id, { type: 'GET_CLIP_IMPORT_TARGET' }, { frameId: 0 }); }
    catch { ready = undefined; }
    if (ready?.protocol === 2 && typeof ready.documentToken === 'string' && typeof ready.workspaceId === 'string') {
      if (observedDocument && (ready.documentToken !== observedDocument.documentToken || ready.workspaceId !== observedDocument.workspaceId)) {
        throw new Error('The app document or workspace changed during preparation. Prepare it again. Captures are retained.');
      }
      observedDocument = { documentToken: ready.documentToken, workspaceId: ready.workspaceId };
    }
    if (ready?.protocol === 2 && ready.ready === true) break;
    if (Date.now() >= readinessDeadline) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  } while (Date.now() <= readinessDeadline);
  if (ready?.protocol !== 2 || ready.ready !== true || typeof ready.workspaceId !== 'string'
      || !ready.workspaceId || ready.workspaceId.length > 128 || typeof ready.documentToken !== 'string') {
    throw new Error('The app has not confirmed an unlocked workspace. Open or update the app, unlock the intended workspace, and retry. Captures are retained.');
  }
  return serializeStorage(async () => {
    const stored = await chrome.storage.local.get([APP_APPROVAL_KEY, CLIP_STATE_KEY, 'captures']);
    if (approvalGeneration(stored[APP_APPROVAL_KEY]?.[targetKey]) !== generation) throw new Error('App approval changed. Prepare the destination again.');
    const state = deliveryState(stored);
    pruneDeliveryState(state, stored.captures || []);
    const sessionId = crypto.randomUUID();
    state.sessions[sessionId] = { targetKey, approvalGeneration: generation,
      tabId: tab.id, documentToken: ready.documentToken, workspaceId: ready.workspaceId,
      workspaceLabel: String(ready.workspaceLabel || ready.workspaceId).slice(0, 200), createdAt: Date.now() };
    await chrome.storage.local.set({ [CLIP_STATE_KEY]: state });
    return { success: true, sessionId, workspaceId: ready.workspaceId, workspaceLabel: state.sessions[sessionId].workspaceLabel };
  });
}

const clipWaiters = new Map();
function waitForClipResult(attemptId) {
  let timer;
  const promise = new Promise(resolve => {
    clipWaiters.set(attemptId, resolve);
    timer = setTimeout(resolve, CLIP_ACK_WAIT_MS);
  });
  return { promise, close() { clearTimeout(timer); clipWaiters.delete(attemptId); } };
}
function requireDeliverySession(stored, sessionId) {
  const session = stored[CLIP_STATE_KEY]?.sessions?.[sessionId];
  if (!session || Date.now() - session.createdAt > CLIP_SESSION_AGE_MS) throw new Error('Destination confirmation expired. Prepare and confirm the workspace again.');
  if (approvalGeneration(stored[APP_APPROVAL_KEY]?.[session.targetKey]) !== session.approvalGeneration) throw new Error('App approval changed. Prepare and confirm the destination again.');
  return session;
}
async function waitForConfirmedWorkspace(session) {
  const deadline = Date.now() + 10000;
  do {
    const stored = await chrome.storage.local.get([APP_APPROVAL_KEY]);
    if (approvalGeneration(stored[APP_APPROVAL_KEY]?.[session.targetKey]) !== session.approvalGeneration) throw new Error('App approval changed. Prepare the destination again.');
    const ready = await chrome.tabs.sendMessage(session.tabId, { type: 'GET_CLIP_IMPORT_TARGET' }, { frameId: 0 });
    if (ready?.protocol !== 2 || ready.documentToken !== session.documentToken || ready.workspaceId !== session.workspaceId) {
      throw new Error('The destination document or workspace changed. Prepare it again. Captures are retained.');
    }
    if (ready.ready === true) return;
    // An ACK proves the DB commit, but the app may still be refreshing its UI.
    // Wait only for the same confirmed document; no content is sent while busy.
    if (Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  } while (Date.now() <= deadline);
  throw new Error('The destination workspace is locked or busy. Unlock it and retry. Captures are retained.');
}
async function sendToTarget(sessionId, references) {
  const refs = captureReferences(references);
  if (!refs.length) throw new Error('No captures selected');
  if (new Set(refs.map(ref => ref.id)).size !== refs.length) throw new Error('Duplicate capture selection');
  const snapshot = await serializeStorage(async () => {
    const stored = await chrome.storage.local.get([CLIP_STATE_KEY, APP_APPROVAL_KEY, 'captures']);
    const session = requireDeliverySession(stored, sessionId);
    const captures = refs.map(ref => {
      const clip = (stored.captures || []).find(row => row.id === ref.id);
      if (!clip || clipRevision(clip) !== ref.revision) throw new Error('A capture changed. Refresh and retry.');
      return clip;
    });
    return { session, sourceId: stored[CLIP_STATE_KEY].sourceId, captures };
  });
  const batches = [];
  let batch = [], bytes = 1024;
  const failures = new Map();
  for (const capture of snapshot.captures) {
    try {
      const clip = normalizedClip(capture);
      clip.fingerprint = await fingerprintClip(clip);
      const size = new TextEncoder().encode(JSON.stringify(clip)).length + 1;
      if (batch.length >= 20 || bytes + size > 8 * 1024 * 1024) { batches.push(batch); batch = []; bytes = 1024; }
      batch.push(clip); bytes += size;
    } catch (error) { failures.set(capture.id, error.message); }
  }
  if (batch.length) batches.push(batch);
  let deliveryError;
  for (const clips of batches) {
    const attemptId = crypto.randomUUID();
    let waiter;
    try {
      // Recheck document and workspace before persisting/sending this attempt.
      const tab = await chrome.tabs.get(snapshot.session.tabId);
      if (appTargetKey(tab.url) !== snapshot.session.targetKey) throw new Error('The destination tab navigated. Prepare it again.');
      await waitForConfirmedWorkspace(snapshot.session);
      await serializeStorage(async () => {
        const stored = await chrome.storage.local.get([CLIP_STATE_KEY, APP_APPROVAL_KEY, 'captures']);
        requireDeliverySession(stored, sessionId);
        const state = stored[CLIP_STATE_KEY];
        const captures = stored.captures || [];
        for (const clip of clips) {
          const current = captures.find(row => row.id === clip.id);
          if (!current || clipRevision(current) !== clip.revision) throw new Error('A capture changed. Refresh and retry.');
          current.sent = false;
          current.delivery = { status: 'pending', revision: clip.revision, fingerprint: clip.fingerprint,
            attemptId, workspaceId: snapshot.session.workspaceId, targetKey: snapshot.session.targetKey };
        }
        state.attempts[attemptId] = { sessionId, sourceId: snapshot.sourceId,
          clips: clips.map(({ id, revision, fingerprint }) => ({ id, revision, fingerprint })) };
        pruneDeliveryState(state, captures);
        await chrome.storage.local.set({ captures, [CLIP_STATE_KEY]: state });
      });
      waiter = waitForClipResult(attemptId);
      const response = await chrome.tabs.sendMessage(snapshot.session.tabId, { type: 'INJECT_CLIPS_TO_PAGE',
        documentToken: snapshot.session.documentToken, envelope: { type: 'THREATCADDY_IMPORT_CLIPS', protocol: 2,
          sourceId: snapshot.sourceId, attemptId, expectedWorkspaceId: snapshot.session.workspaceId, clips } }, { frameId: 0 });
      if (response?.delivered !== true) throw new Error(response?.error || 'The app did not accept delivery. Update or unlock it and retry. Captures are retained.');
      await waiter.promise;
      const current = await chrome.storage.local.get(['captures']);
      if (clips.some(clip => (current.captures || []).find(row => row.id === clip.id)?.delivery?.status === 'pending')) {
        deliveryError = 'Import confirmation is still pending. Captures are retained; retry safely after checking the workspace.';
        break;
      }
    } catch (error) { deliveryError = error.message; break; }
    finally { waiter?.close(); }
  }
  const { captures = [] } = await chrome.storage.local.get(['captures']);
  const results = refs.map(ref => {
    const clip = captures.find(row => row.id === ref.id);
    const delivery = clip?.delivery;
    const matches = clip && clipRevision(clip) === ref.revision && delivery?.revision === ref.revision
      && delivery.workspaceId === snapshot.session.workspaceId && delivery.targetKey === snapshot.session.targetKey;
    const status = failures.has(ref.id) ? 'failed' : matches && confirmedCapture(clip) ? 'confirmed'
      : matches && delivery.status === 'failed' ? 'failed' : 'pending';
    return { ...ref, status, ...(failures.has(ref.id) ? { error: failures.get(ref.id) } : {}) };
  });
  const confirmed = results.filter(result => result.status === 'confirmed').length;
  return { success: confirmed === refs.length, status: confirmed === refs.length ? 'success' : confirmed ? 'partial' : 'unconfirmed',
    confirmed, total: refs.length, results,
    error: confirmed === refs.length ? undefined : deliveryError || [...failures.values()][0] || 'Some imports were not confirmed. Review the retained captures and retry.' };
}

async function acknowledgeClips(result, sender, context) {
  if (context.internal || !result || result.protocol !== 2 || !Array.isArray(result.results) || result.results.length > 20) throw new Error('Invalid clip confirmation');
  const accepted = await serializeStorage(async () => {
    const stored = await chrome.storage.local.get([CLIP_STATE_KEY, APP_APPROVAL_KEY, 'captures']);
    const state = stored[CLIP_STATE_KEY];
    const attempt = state?.attempts?.[result.attemptId];
    if (!attempt) return 0; // Repeated/lost-response acknowledgements are harmless.
    const session = state.sessions[attempt.sessionId];
    if (!session || sender.tab?.id !== session.tabId || context.key !== session.targetKey
      || approvalGeneration(context.approval) !== session.approvalGeneration || approvalGeneration(stored[APP_APPROVAL_KEY]?.[context.key]) !== session.approvalGeneration
      || result.documentToken !== session.documentToken || result.workspaceId !== session.workspaceId || result.sourceId !== attempt.sourceId) {
      throw new Error('Clip confirmation does not match its approved destination');
    }
    const captures = stored.captures || [];
    let count = 0;
    for (const receipt of result.results) {
      const expected = attempt.clips.find(clip => clip.id === receipt?.id && clip.revision === receipt.revision && clip.fingerprint === receipt.fingerprint);
      if (!expected || !['imported', 'duplicate', 'failed'].includes(receipt.status)) continue;
      const clip = captures.find(row => row.id === receipt.id);
      if (!clip || clipRevision(clip) !== receipt.revision || clip.delivery?.attemptId !== result.attemptId || clip.delivery.status !== 'pending') continue;
      const confirmed = receipt.status === 'imported' || receipt.status === 'duplicate';
      if (confirmed && (typeof receipt.entityId !== 'string' || !receipt.entityId || receipt.entityId.length > 128 || receipt.entityType !== (clip.entityType || 'note'))) continue;
      clip.sent = confirmed;
      clip.delivery = { ...clip.delivery, status: confirmed ? 'confirmed' : 'failed', confirmedAt: confirmed ? Date.now() : undefined,
        ...(confirmed ? { entityId: receipt.entityId, entityType: receipt.entityType } : { error: String(receipt.error || 'Import failed').slice(0, 300) }) };
      count++;
    }
    pruneDeliveryState(state, captures);
    await chrome.storage.local.set({ captures, [CLIP_STATE_KEY]: state });
    return count;
  });
  clipWaiters.get(result.attemptId)?.();
  return { success: true, accepted };
}

async function captureAndSave(text, tab) {
  const stripped = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim();
  const titleSource = stripped || text;
  const title = titleSource.substring(0, 80).replace(/\n/g, ' ');
  const note = {
    title,
    content: text,
    sourceUrl: tab.url || '',
    sourceTitle: tab.title || ''
  };

  try { await saveCapture(note); }
  catch (error) {
    const message = String(error.message || 'Capture could not be saved').slice(0, 300);
    // Restricted source pages may not allow a content bubble. An action badge
    // and popup notice do not require page or native-notification permission.
    await Promise.allSettled([
      Promise.resolve().then(() => chrome.action?.setBadgeText({ text: '!' })),
      Promise.resolve().then(() => chrome.action?.setTitle({ title: `Capture not saved: ${message}` })),
      serializeStorage(() => chrome.storage.local.set({ captureErrorV1: message })),
    ]);
    return false;
  }

  // Skip bubble on extension pages and other restricted URLs
  const url = tab.url || '';
  if (url.startsWith('chrome-extension://') || url.startsWith('chrome://') || url.startsWith('about:')) {
    return;
  }

  // Show confirmation bubble via content script
  try {
    // Try to ping existing content script
    let contentScriptReady = false;
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'PING' });
      contentScriptReady = response && response.loaded;
    } catch {
      // Content script not injected yet
    }

    // Inject content script if not ready
    if (!contentScriptReady) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
    }

    // Show confirmation
    await chrome.tabs.sendMessage(tab.id, {
      type: 'SHOW_CONFIRMATION',
      title: title
    });
  } catch (error) {
    // Content script injection might fail on restricted pages — that's OK
    console.error('Could not show confirmation bubble:', error);
  }
}

async function saveCapture(note) {
  return serializeStorage(async () => {
    const { captures = [] } = await chrome.storage.local.get(['captures']);
    if (captures.length >= MAX_CAPTURES) throw new Error('Capture storage is full (500). Review and explicitly delete captures before saving more. Nothing was removed.');
    const capture = normalizedClip({ ...note, id: crypto.randomUUID(), revision: 1, createdAt: Date.now() });
    capture.sent = false;
    await chrome.storage.local.set({ captures: [...captures, capture] });
    // The save is already committed: cosmetic cleanup failure must not turn it
    // into an apparent failure which would encourage a duplicate capture.
    await Promise.allSettled([Promise.resolve().then(() => chrome.storage.local.remove('captureErrorV1')),
      Promise.resolve().then(() => chrome.action?.setBadgeText({ text: '' })), Promise.resolve().then(() => chrome.action?.setTitle({ title: 'ThreatCaddy' }))]);
    return capture;
  });
}

async function getStats() {
  const { captures = [] } = await chrome.storage.local.get(['captures']);
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  return {
    total: captures.length,
    thisWeek: captures.filter(c => c.createdAt > oneWeekAgo).length,
    recent: captures.slice(-3).reverse()
  };
}
