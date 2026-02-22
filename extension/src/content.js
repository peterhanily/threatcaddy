// Content script for showing capture confirmation bubble
let currentBubble = null;

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ loaded: true });
  } else if (message.type === 'SHOW_CONFIRMATION') {
    showConfirmationBubble(message.title);
    sendResponse({ success: true });
  } else if (message.type === 'HIDE_BUBBLE') {
    hideBubble();
    sendResponse({ success: true });
  }
  return true;
});

function showConfirmationBubble(noteTitle) {
  hideBubble();

  // Get selection position
  const selection = window.getSelection();
  let rect = null;
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    rect = range.getBoundingClientRect();
  }

  currentBubble = createBubbleElement(noteTitle);
  document.body.appendChild(currentBubble);

  if (rect && rect.width > 0) {
    positionBubble(currentBubble, rect);
  } else {
    // Fallback: position at top-right
    currentBubble.style.position = 'fixed';
    currentBubble.style.top = '20px';
    currentBubble.style.right = '20px';
    currentBubble.style.left = 'auto';
  }

  // Auto-hide after 5 seconds
  setTimeout(() => hideBubble(), 5000);
}

function createBubbleElement(noteTitle) {
  const bubble = document.createElement('div');
  bubble.id = 'browsernotes-bubble';
  bubble.className = 'browsernotes-bubble';

  bubble.innerHTML = `
    <style>
      .browsernotes-bubble {
        position: fixed;
        z-index: 2147483647;
        background: #030712;
        border: 2px solid #6366f1;
        border-radius: 12px;
        padding: 16px;
        max-width: 320px;
        min-width: 240px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
        font-family: system-ui, -apple-system, sans-serif;
        color: #f9fafb;
        animation: browsernotes-fadeIn 0.2s ease-out;
      }

      @keyframes browsernotes-fadeIn {
        from { opacity: 0; transform: translateY(-10px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .browsernotes-bubble * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      .browsernotes-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
      }

      .browsernotes-logo {
        font-size: 13px;
        font-weight: 700;
        color: #6366f1;
      }

      .browsernotes-close {
        background: none;
        border: none;
        color: #9ca3af;
        cursor: pointer;
        font-size: 18px;
        line-height: 1;
        padding: 0;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .browsernotes-close:hover {
        color: #f9fafb;
      }

      .browsernotes-check {
        text-align: center;
        margin-bottom: 8px;
        font-size: 28px;
      }

      .browsernotes-message {
        text-align: center;
        font-size: 14px;
        font-weight: 600;
        color: #10b981;
        margin-bottom: 8px;
      }

      .browsernotes-title-preview {
        text-align: center;
        font-size: 12px;
        color: #9ca3af;
        margin-bottom: 12px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .browsernotes-open-btn {
        display: block;
        width: 100%;
        padding: 8px 12px;
        border: none;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        background: #6366f1;
        color: #ffffff;
        text-align: center;
        text-decoration: none;
        transition: background 0.2s;
      }

      .browsernotes-open-btn:hover {
        background: #818cf8;
      }
    </style>

    <div class="browsernotes-header">
      <div class="browsernotes-logo">BrowserNotes</div>
      <button class="browsernotes-close" id="browsernotes-close">&times;</button>
    </div>

    <div class="browsernotes-check">&#10003;</div>
    <div class="browsernotes-message">Saved to BrowserNotes!</div>
    <div class="browsernotes-title-preview">${escapeHtml(noteTitle)}</div>

    <button class="browsernotes-open-btn" id="browsernotes-review">Review All Captures</button>
  `;

  // Event listeners
  bubble.querySelector('#browsernotes-close').addEventListener('click', hideBubble);
  bubble.querySelector('#browsernotes-review').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_CLIPS_PAGE' });
    hideBubble();
  });

  return bubble;
}

function positionBubble(bubble, selectionRect) {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // Measure bubble after it's in the DOM
  const bubbleRect = bubble.getBoundingClientRect();

  // Try to position below selection
  let top = selectionRect.bottom + 10;
  let left = selectionRect.left + (selectionRect.width / 2) - (bubbleRect.width / 2);

  // Keep within viewport horizontally
  if (left + bubbleRect.width > viewportWidth - 20) {
    left = viewportWidth - bubbleRect.width - 20;
  }
  if (left < 20) {
    left = 20;
  }

  // If it doesn't fit below, try above
  if (top + bubbleRect.height > viewportHeight - 20) {
    top = selectionRect.top - bubbleRect.height - 10;
    if (top < 20) {
      top = 20;
    }
  }

  // Clamp to viewport
  top = Math.max(20, Math.min(top, viewportHeight - bubbleRect.height - 20));

  bubble.style.position = 'fixed';
  bubble.style.top = `${top}px`;
  bubble.style.left = `${left}px`;
}

function hideBubble() {
  if (currentBubble) {
    currentBubble.remove();
    currentBubble = null;
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Hide bubble when clicking outside
document.addEventListener('click', (e) => {
  if (currentBubble && !currentBubble.contains(e.target)) {
    hideBubble();
  }
}, true);

// Hide bubble when scrolling
let scrollTimeout;
document.addEventListener('scroll', () => {
  if (currentBubble) {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      hideBubble();
    }, 100);
  }
}, true);
