// Background service worker for ThreatCaddy extension

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
  if (message.type === 'PING') {
    sendResponse({ loaded: true });
  } else if (message.type === 'FETCH_URL') {
    (async () => {
      try {
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

// ── LLM Streaming via long-lived ports ─────────────────────────────────

chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith('llm-')) return;

  let abortController = new AbortController();

  port.onDisconnect.addListener(() => {
    abortController.abort();
  });

  port.onMessage.addListener(async (payload) => {
    try {
      if (payload.provider === 'anthropic') {
        await streamAnthropic(port, payload, abortController.signal);
      } else if (payload.provider === 'openai') {
        await streamOpenAI(port, payload, abortController.signal);
      } else {
        port.postMessage({ type: 'error', error: `Unknown provider: ${payload.provider}` });
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      try { port.postMessage({ type: 'error', error: err.message || 'Unknown error' }); } catch {}
    }
  });
});

async function streamAnthropic(port, payload, signal) {
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
    port.postMessage({ type: 'error', error: `Anthropic API ${resp.status}: ${respBody}` });
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // Track content blocks for tool calling
  const contentBlocks = [];
  let currentBlockIndex = -1;
  let stopReason = null;

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
            port.postMessage({ type: 'chunk', content: parsed.delta.text });
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

        if (parsed.type === 'message_delta' && parsed.delta?.stop_reason) {
          stopReason = parsed.delta.stop_reason;
        }
      } catch {}
    }
  }

  port.postMessage({ type: 'done', stopReason: stopReason || 'end_turn', contentBlocks });
}

async function streamOpenAI(port, payload, signal) {
  const messages = [];
  if (payload.systemPrompt) {
    messages.push({ role: 'system', content: payload.systemPrompt });
  }

  // Convert structured messages for OpenAI format
  for (const m of payload.messages) {
    if (m.role === 'assistant' && Array.isArray(m.content)) {
      // Anthropic-style content blocks → OpenAI assistant message + tool_calls
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
      // Tool result blocks → OpenAI tool messages
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

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${payload.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const respBody = await resp.text().catch(() => '');
    port.postMessage({ type: 'error', error: `OpenAI API ${resp.status}: ${respBody}` });
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let stopReason = null;

  // Track tool calls being assembled from deltas
  const toolCallAccum = {}; // index → { id, name, arguments }

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
        const choice = parsed.choices?.[0];
        if (!choice) continue;

        // Text content
        const content = choice.delta?.content;
        if (content) {
          port.postMessage({ type: 'chunk', content });
        }

        // Tool call deltas
        if (choice.delta?.tool_calls) {
          for (const tc of choice.delta.tool_calls) {
            const idx = tc.index;
            if (!toolCallAccum[idx]) toolCallAccum[idx] = { id: '', name: '', arguments: '' };
            if (tc.id) toolCallAccum[idx].id = tc.id;
            if (tc.function?.name) toolCallAccum[idx].name = tc.function.name;
            if (tc.function?.arguments) toolCallAccum[idx].arguments += tc.function.arguments;
          }
        }

        // Finish reason
        if (choice.finish_reason) {
          stopReason = choice.finish_reason;
        }
      } catch {}
    }
  }

  // Build content blocks in Anthropic format
  const contentBlocks = [];
  // If there was streamed text, it was already sent as chunks. Reconstruct the text block isn't
  // needed since useLLM tracks accumulated text. But we still need tool_use blocks.
  const toolEntries = Object.values(toolCallAccum);
  if (toolEntries.length > 0) {
    for (const tc of toolEntries) {
      let parsedArgs = {};
      try { parsedArgs = JSON.parse(tc.arguments); } catch {}
      contentBlocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: parsedArgs });
    }
  }

  // Normalize OpenAI stop reasons to Anthropic format
  const normalizedStop = stopReason === 'tool_calls' ? 'tool_use'
    : stopReason === 'stop' ? 'end_turn'
    : stopReason || 'end_turn';

  port.postMessage({ type: 'done', stopReason: normalizedStop, contentBlocks });
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
