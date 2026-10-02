// Background service worker for ThreatCaddy extension

const MAX_CAPTURES = 500;
const APP_APPROVAL_KEY = 'approvedAppsV1';
const POLICY_MAX_AGE = 24 * 60 * 60 * 1000;
const MAX_FETCH_BYTES = 5 * 1024 * 1024;

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
async function boundedFetch(url, options, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, redirect: 'error', credentials: 'omit' });
    return { response, text: await readBoundedResponse(response) };
  } finally { clearTimeout(timer); }
}

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

async function syncBridgeRegistration() {
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
    try { img.src = new URL(img.getAttribute('src'), document.baseURI).href; } catch {}
  });
  div.querySelectorAll('a[href]').forEach(a => {
    try { a.href = new URL(a.getAttribute('href'), document.baseURI).href; } catch {}
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
          try { clearTimeout(timer); return resolve(capDataUri(drawToCanvas(pi))); } catch {}
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
    const appMessages = ['PING', 'SET_PROXY_DOMAINS', 'FETCH_URL', 'PROXY_FETCH', 'SEND_NOTIFICATION'];
    if (!context.internal && !appMessages.includes(message.type)) throw new Error('This operation is available only from the extension');
    if (message.type === 'APPROVE_APP') {
      const key = appTargetKey(message.targetUrl);
      const stored = await chrome.storage.local.get([APP_APPROVAL_KEY, 'settings']);
      const localLLMOrigin = message.localLLMUrl ? new URL(message.localLLMUrl).origin : undefined;
      if (localLLMOrigin && !/^https?:\/\//.test(localLLMOrigin)) throw new Error('Local AI endpoint must be HTTP(S)');
      if (message.localLLMUrl && (new URL(message.localLLMUrl).username || new URL(message.localLLMUrl).password)) throw new Error('Local AI endpoint must not contain credentials');
      await chrome.storage.local.set({
        [APP_APPROVAL_KEY]: { ...stored[APP_APPROVAL_KEY], [key]: { approvedAt: Date.now(), localLLMOrigin } },
        settings: { ...stored.settings, targetUrl: message.targetUrl },
      });
      await syncBridgeRegistration();
      await chrome.storage.local.remove('proxyPolicyV1:' + key);
      sendResponse({ success: true });
      return;
    }
    if (message.type === 'REVOKE_APPS') {
      await chrome.storage.local.set({ [APP_APPROVAL_KEY]: {}, proxyPoliciesV1: {} });
      sendResponse({ success: true });
      return;
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
    chrome.storage.local.set({ ['proxyPolicyV1:' + context.key]: { domains, updatedAt: Date.now(), approvedAt: context.approval?.approvedAt } })
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
    (async () => {
      try {
        // Validate hostname against stored allowed proxy domains
        const policyKey = 'proxyPolicyV1:' + context.key;
        const stored = await chrome.storage.local.get([policyKey]);
        const policy = stored[policyKey];
        if (!policy || !Number.isFinite(policy.updatedAt) || policy.approvedAt !== context.approval?.approvedAt
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
        const { response: resp, text } = await boundedFetch(message.url, fetchOptions, 30000);
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
      }
    })();
    return true;
  } else if (message.type === 'SAVE_NOTE') {
    saveCapture(message.note).then(() => {
      sendResponse({ success: true });
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
    sendToTarget(message.targetUrl, message.captures).then(result => {
      sendResponse(result);
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  } else if (message.type === 'SEND_NOTIFICATION') {
    (async () => {
    if (!await chrome.permissions.contains({ permissions: ['notifications'] })) throw new Error('Desktop notifications are disabled. Enable them in extension settings; the in-app alert is retained.');
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

  let abortController = new AbortController();
  let portDisconnected = false;
  let running = false;
  const approvalChanged = (changes, area) => {
    if (area === 'local' && changes[APP_APPROVAL_KEY]) { abortController.abort(); port.disconnect(); }
  };
  chrome.storage.onChanged.addListener(approvalChanged);

  port.onDisconnect.addListener(() => {
    portDisconnected = true;
    abortController.abort();
    chrome.storage.onChanged.removeListener(approvalChanged);
  });

  // Safe wrapper — silently drops messages if the port already disconnected
  function safeSend(msg) {
    if (portDisconnected) return;
    try { port.postMessage(msg); } catch { portDisconnected = true; }
  }

  port.onMessage.addListener(async (payload) => {
    let ownsRequest = false;
    try {
      const context = await approvedSender(port.sender ?? {});
      if (portDisconnected) return;
      if (running) throw new Error('Only one request per streaming connection is allowed');
      running = true;
      ownsRequest = true;
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
      if (ownsRequest) running = false;
    }
  });
});

// Check host permission before making LLM API calls (AI API origins are optional_host_permissions)
async function ensureLLMPermission(url) {
  const parsed = new URL(url);
  const origin = parsed.origin + '/*';
  const has = await chrome.permissions.contains({ origins: [origin] });
  if (!has) {
    throw new Error(
      chrome.i18n.getMessage('errorCaddyAIPermission')
    );
  }
}

async function streamAnthropic(send, payload, signal) {
  await ensureLLMPermission('https://api.anthropic.com/v1/messages');

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
      } catch {}
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
    } catch {}
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
    } catch {}
  }

  return calls;
}

// Shared streamer for OpenAI-compatible APIs (OpenAI, Mistral, Local/Ollama/vLLM)
async function streamOpenAICompatible(send, payload, signal, endpoint, headers, providerLabel, options = {}) {
  await ensureLLMPermission(endpoint);

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
      } catch {}
    }
  }

  const contentBlocks = [];
  const toolEntries = Object.values(toolCallAccum);
  if (toolEntries.length > 0) {
    for (const tc of toolEntries) {
      let parsedArgs = {};
      try { parsedArgs = JSON.parse(tc.arguments); } catch {}
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
    const origin = parsed.origin + '/*';
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
  await ensureLLMPermission('https://generativelanguage.googleapis.com/v1beta/models');

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
      } catch {}
    }
  }

  // Determine if tool_use is the stop reason based on content blocks
  const hasToolUse = contentBlocks.some(b => b.type === 'tool_use');
  if (hasToolUse && stopReason !== 'max_tokens') stopReason = 'tool_use';

  send({ type: 'done', stopReason: stopReason || 'end_turn', contentBlocks, usage });
}

async function sendToTarget(targetUrl, captures) {
  const targetKey = appTargetKey(targetUrl);
  const approved = await chrome.storage.local.get([APP_APPROVAL_KEY]);
  if (!approved[APP_APPROVAL_KEY]?.[targetKey]) throw new Error('Approve this target in extension settings before sending captures');
  // Re-validate URL before opening (defense-in-depth; clips page also validates)
  try {
    const parsed = new URL(targetUrl);
    if (!/^(https?|file):$/.test(parsed.protocol)) {
      throw new Error('Invalid target URL protocol');
    }
  } catch {
    throw new Error(chrome.i18n.getMessage('errorInvalidTargetUrl'));
  }

  // Open target URL in a new tab
  let tab;
  try {
    tab = await chrome.tabs.create({ url: targetUrl, active: true });
  } catch (err) {
    // Chrome blocks file:// navigation unless "Allow access to file URLs" is enabled
    if (/file url/i.test(err.message) || /local file/i.test(err.message)) {
      throw new Error(
        'File URL access is disabled. In Chrome, go to chrome://extensions → ThreatCaddy → Enable "Allow access to file URLs", then try again.'
      );
    }
    throw err;
  }

  // Wait for the tab to finish loading
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error(chrome.i18n.getMessage('errorTimedOutPageLoad')));
    }, 30000);

    function listener(tabId, changeInfo) {
      if (tabId === tab.id && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);

    // Handle race: tab may already be complete before listener was attached
    chrome.tabs.get(tab.id).then(currentTab => {
      if (currentTab.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        resolve();
      }
    });
  });

  const currentTab = await chrome.tabs.get(tab.id);
  if (appTargetKey(currentTab.url) !== targetKey) throw new Error('The target redirected to a different app; captures were not sent');
  // Proactively inject the bridge into this explicitly approved target.
  // Its duplicate-injection guard safely handles an already registered HTTP(S) bridge.
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['bridge.js'] });
  } catch { /* restricted page or missing host permission */ }

  // Poll for bridge readiness with exponential backoff instead of a fixed delay.
  // Send THREATCADDY_PING and wait for THREATCADDY_PONG from the content script.
  await new Promise(resolve => {
    const delays = [100, 200, 400, 800, 1600];
    let attempt = 0;
    let settled = false;
    const fallback = setTimeout(() => {
      if (!settled) { settled = true; resolve(); }
    }, 3000);

    function poll() {
      if (settled) return;
      chrome.tabs.sendMessage(tab.id, { type: 'THREATCADDY_PING' }, (resp) => {
        if (chrome.runtime.lastError) { /* ignore */ }
        if (settled) return;
        if (resp && resp.pong) {
          settled = true;
          clearTimeout(fallback);
          resolve();
          return;
        }
        attempt++;
        if (attempt < delays.length) {
          setTimeout(poll, delays[attempt]);
        }
        // else: fallback timer will resolve
      });
    }

    setTimeout(poll, delays[0]);
  });

  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'INJECT_CLIPS_TO_PAGE', clips: captures });
  } catch {
    throw new Error(chrome.i18n.getMessage('errorDeliverClips'));
  }

  return { success: true };
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

  await saveCapture(note);

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
  const { captures = [] } = await chrome.storage.local.get(['captures']);

  const capture = {
    id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
    title: note.title || '',
    content: note.content || '',
    sourceUrl: note.sourceUrl || '',
    sourceTitle: note.sourceTitle || '',
    entityType: note.entityType || 'note',
    folderName: note.folderName || '',
    clsLevel: note.clsLevel || '',
    createdAt: Date.now(),
    sent: false
  };

  captures.push(capture);

  // Trim oldest if over limit
  if (captures.length > MAX_CAPTURES) {
    captures.splice(0, captures.length - MAX_CAPTURES);
  }

  await chrome.storage.local.set({ captures });
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
