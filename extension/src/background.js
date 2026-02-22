// Background service worker for BrowserNotes extension

const MAX_CAPTURES = 500;

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
    await captureAndSave(info.selectionText, tab);
  }
});

// Handle keyboard shortcut
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'capture-selection') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    // Get selected text from the active tab
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.getSelection().toString()
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
    return true; // Keep channel open for async response
  } else if (message.type === 'GET_STATS') {
    getStats().then(stats => {
      sendResponse(stats);
    });
    return true;
  }
});

async function captureAndSave(text, tab) {
  const title = text.substring(0, 80).replace(/\n/g, ' ');
  const note = {
    title,
    content: text,
    sourceUrl: tab.url || '',
    sourceTitle: tab.title || ''
  };

  await saveCapture(note);

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
