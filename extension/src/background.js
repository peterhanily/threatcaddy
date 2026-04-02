// Background service worker for ThreatCaddy extension

const MAX_CAPTURES = 500;

// ── Dynamic bridge.js registration (MV3) ────────────────────────────────
// Static content_scripts only cover threatcaddy.com. For self-hosted,
// localhost, or file:// targets we register bridge.js dynamically.

const DYNAMIC_BRIDGE_SCRIPT_ID = 'dynamic-bridge';
const STATIC_BRIDGE_PATTERNS = new Set([
  'https://threatcaddy.com/*',
  'https://www.threatcaddy.com/*',
]);

function targetUrlToMatchPattern(targetUrl) {
  if (!targetUrl) return null;
  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol === 'file:') return null;
    if (!/^https?:$/.test(parsed.protocol)) return null;
    const pattern = `${parsed.protocol}//${parsed.host}/*`;
    return STATIC_BRIDGE_PATTERNS.has(pattern) ? null : pattern;
  } catch { return null; }
}

async function registerBridgeForPattern(matchPattern) {
  if (!matchPattern) return;
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts(
      { ids: [DYNAMIC_BRIDGE_SCRIPT_ID] }
    );
    if (existing.length > 0) {
      if (existing[0].matches?.[0] === matchPattern) return; // already correct
      await chrome.scripting.updateContentScripts([{
        id: DYNAMIC_BRIDGE_SCRIPT_ID,
        matches: [matchPattern], js: ['bridge.js'], runAt: 'document_idle',
      }]);
    } else {
      await chrome.scripting.registerContentScripts([{
        id: DYNAMIC_BRIDGE_SCRIPT_ID,
        matches: [matchPattern], js: ['bridge.js'], runAt: 'document_idle',
      }]);
    }
  } catch (err) { console.warn('Dynamic bridge registration failed:', err); }
}

async function unregisterDynamicBridge() {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [DYNAMIC_BRIDGE_SCRIPT_ID] });
  } catch { /* not registered */ }
}

async function syncBridgeRegistration() {
  const { settings = {} } = await chrome.storage.local.get(['settings']);
  const targetUrl = settings.targetUrl;
  if (!targetUrl || targetUrl === 'https://threatcaddy.com'
      || targetUrl === 'https://www.threatcaddy.com') {
    await unregisterDynamicBridge();
    return;
  }
  const pattern = targetUrlToMatchPattern(targetUrl);
  if (pattern) await registerBridgeForPattern(pattern);
  else await unregisterDynamicBridge();
}

// Sync on every SW startup
syncBridgeRegistration();

// Re-sync when settings change (user saves new target URL in clips page)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) syncBridgeRegistration();
});

// Auto-inject bridge.js on file:// targets (can't use registerContentScripts for file://)
// Injects on: pages matching configured file:// target, or pages with "threatcaddy" in the URL
// (covers standalone HTML). Silently fails if file:// access is not granted.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url?.startsWith('file://')) return;
  const { settings = {} } = await chrome.storage.local.get(['settings']);
  const targetIsFile = settings.targetUrl?.startsWith('file://');
  const matchesTarget = targetIsFile && (tab.url.startsWith(settings.targetUrl) || tab.url === settings.targetUrl);
  const looksLikeThreatCaddy = /threatcaddy/i.test(tab.url);
  if (matchesTarget || looksLikeThreatCaddy) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['bridge.js'] });
    } catch { /* no file access or restricted page */ }
  }
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
    title: 'Save to ThreatCaddy',
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
  if (sender.id !== chrome.runtime.id) return;
  if (message.type === 'SET_PROXY_DOMAINS') {
    // Store allowed domains for proxy fetch validation
    const domains = Array.isArray(message.domains)
      ? message.domains.filter((d) => typeof d === 'string' && d.length > 0 && d.length < 256)
      : [];
    chrome.storage.local.set({ proxyAllowedDomains: domains });
    return;
  }
  if (message.type === 'PING') {
    sendResponse({ loaded: true });
  } else if (message.type === 'FETCH_URL') {
    // Validate URL scheme
    let parsed;
    try {
      parsed = new URL(message.url);
    } catch {
      sendResponse({ success: false, error: 'Invalid URL' });
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      sendResponse({ success: false, error: 'Only HTTP and HTTPS URLs are supported' });
      return;
    }
    (async () => {
      try {
        // Ensure we have host permission for this origin
        const origin = parsed.origin + '/*';
        const hasPermission = await chrome.permissions.contains({ origins: [origin] });
        if (!hasPermission) {
          // Try to request it (works from service worker if triggered by user gesture chain)
          const granted = await chrome.permissions.request({ origins: [origin] }).catch(() => false);
          if (!granted) {
            sendResponse({
              success: false,
              error: 'URL access permission required. Open the ThreatCaddy extension popup and enable "Allow URL fetching", then try again.',
            });
            return;
          }
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        const resp = await fetch(message.url, {
          signal: controller.signal,
          headers: { 'Accept': 'text/html,application/xhtml+xml,*/*' },
          redirect: 'follow',
        });
        clearTimeout(timer);
        if (!resp.ok) {
          sendResponse({ success: false, error: `HTTP ${resp.status} ${resp.statusText}` });
          return;
        }
        const html = await resp.text();
        const { title, content } = htmlToText(html);
        sendResponse({ success: true, title, content, url: message.url });
      } catch (err) {
        const msg = err.name === 'AbortError'
          ? 'Request timed out (15s). The page may be unreachable.'
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
      parsed = new URL(message.url);
    } catch {
      sendResponse({ success: false, error: 'Invalid URL' });
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      sendResponse({ success: false, error: 'Only HTTP and HTTPS URLs are supported' });
      return;
    }
    // Block requests to private/internal hostnames (SSRF protection)
    const hostname = parsed.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
        || hostname === '0.0.0.0' || hostname.endsWith('.local')
        || hostname === 'metadata.google.internal'
        || hostname === '169.254.169.254') {
      sendResponse({ success: false, error: 'Blocked: requests to internal/private addresses are not allowed' });
      return;
    }
    (async () => {
      try {
        // Validate hostname against stored allowed proxy domains
        const { proxyAllowedDomains = [] } = await chrome.storage.local.get(['proxyAllowedDomains']);
        if (proxyAllowedDomains.length > 0) {
          const allowed = proxyAllowedDomains.some(
            (d) => hostname === d || hostname.endsWith('.' + d)
          );
          if (!allowed) {
            sendResponse({ success: false, error: 'Blocked: ' + hostname + ' is not in the allowed proxy domains list' });
            return;
          }
        }
        // Ensure we have host permission
        const origin = parsed.origin + '/*';
        const hasPermission = await chrome.permissions.contains({ origins: [origin] });
        if (!hasPermission) {
          const granted = await chrome.permissions.request({ origins: [origin] }).catch(() => false);
          if (!granted) {
            sendResponse({ success: false, error: 'Host permission required for ' + parsed.hostname });
            return;
          }
        }
        const fetchOptions = {
          method: message.method || 'GET',
          headers: message.headers || {},
        };
        if (message.body && message.method !== 'GET') {
          fetchOptions.body = message.body;
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30000);
        fetchOptions.signal = controller.signal;
        const resp = await fetch(message.url, fetchOptions);
        clearTimeout(timer);
        const text = await resp.text();
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
          ? 'Request timed out (30s)'
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
    const iconPath = message.severity === 'critical'
      ? 'icons/icon128.png'
      : 'icons/icon128.png';
    chrome.notifications.create({
      type: 'basic',
      iconUrl: iconPath,
      title: message.title || 'CaddyAgent',
      message: message.message || '',
      priority: message.severity === 'critical' ? 2 : 1,
    });
    sendResponse({ success: true });
  }
});

// ── LLM Streaming via long-lived ports ─────────────────────────────────

chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith('llm-')) return;

  let abortController = new AbortController();
  let portDisconnected = false;

  port.onDisconnect.addListener(() => {
    portDisconnected = true;
    abortController.abort();
  });

  // Safe wrapper — silently drops messages if the port already disconnected
  function safeSend(msg) {
    if (portDisconnected) return;
    try { port.postMessage(msg); } catch { portDisconnected = true; }
  }

  port.onMessage.addListener(async (payload) => {
    try {
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
        safeSend({ type: 'error', error: `Unknown provider: ${payload.provider}` });
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      safeSend({ type: 'error', error: err.message || 'Unknown error' });
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
      'CaddyAI permission required. Open the ThreatCaddy extension popup and enable "Allow CaddyAI" under Permissions.'
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

  // localhost/127.0.0.1 are in required host_permissions and don't need an extra check.
  // Non-localhost local endpoints need the broad URL-fetching permission (*://*/*).
  const parsed = new URL(endpoint);
  const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (!isLocalhost) {
    const origin = parsed.origin + '/*';
    const has = await chrome.permissions.contains({ origins: [origin] });
    if (!has) {
      throw new Error(
        'Host permission required for ' + parsed.hostname + '. Open the ThreatCaddy extension popup and enable "Allow URL fetching" under Permissions.'
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
  // Re-validate URL before opening (defense-in-depth; clips page also validates)
  try {
    const parsed = new URL(targetUrl);
    if (!/^(https?|file):$/.test(parsed.protocol)) {
      throw new Error('Invalid target URL protocol');
    }
  } catch {
    throw new Error('Invalid target URL');
  }

  // Open target URL in a new tab
  const tab = await chrome.tabs.create({ url: targetUrl, active: true });

  // Wait for the tab to finish loading
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Timed out waiting for page to load'));
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

  // Proactively inject bridge.js — static content_scripts only cover threatcaddy.com,
  // so for custom targets (self-hosted, localhost, file://) we must inject explicitly.
  // bridge.js has a duplicate-injection guard so re-injection on threatcaddy.com is safe.
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
    throw new Error('Failed to deliver clips — bridge.js could not reach the page. Check that the extension has permission for this site.');
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
