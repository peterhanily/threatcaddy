// Background service worker for BrowserNotes extension

const MAX_CAPTURES = 500;

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

// Create context menu on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'save-to-browsernotes',
    title: 'Save to BrowserNotes',
    contexts: ['selection']
  });
});

// Handle context menu click
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'save-to-browsernotes' && info.selectionText) {
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

// Handle keyboard shortcut
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'capture-selection') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    // Get selected text as markdown from the active tab
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: getSelectionAsMarkdown
      });

      if (result && result.result) {
        await captureAndSave(result.result, tab);
      }
    } catch (error) {
      console.error('Failed to get selection:', error);
    }
  }
});

// Handle messages from popup and content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ loaded: true });
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
  }
});

async function sendToTarget(targetUrl, captures) {
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

  // Wait for the web app's React to mount and register its message listener
  await new Promise(resolve => setTimeout(resolve, 2500));

  // Inject script in MAIN world so postMessage reaches the React app directly
  // file:// origins are "null" so postMessage targeted at "null" won't deliver;
  // use "*" for file:// (safe — we control the tab we opened)
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: (clips) => {
      const origin = window.location.protocol === 'file:' ? '*' : window.location.origin;
      window.postMessage({ type: 'BROWSERNOTES_IMPORT_CLIPS', clips }, origin);
    },
    args: [captures]
  });

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
    createdAt: Date.now()
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
