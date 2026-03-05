// Popup script for ThreatCaddy extension

// Load stats and recent captures on popup open
async function loadStats() {
  try {
    const { captures = [] } = await chrome.storage.local.get(['captures']);

    // Total captures
    document.getElementById('total-captures').textContent = captures.length;

    // This week
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const weekCount = captures.filter(c => c.createdAt > oneWeekAgo).length;
    document.getElementById('week-captures').textContent = weekCount;

    // Recent captures (newest first, max 3)
    renderRecentCaptures(captures.slice(-3).reverse());
  } catch (error) {
    console.error('Failed to load stats:', error);
  }
}

function renderRecentCaptures(captures) {
  const list = document.getElementById('recent-list');

  if (captures.length === 0) {
    list.innerHTML = '<div class="recent-empty">No captures yet. Select text on any page and right-click to save.</div>';
    return;
  }

  list.innerHTML = captures.map(capture => {
    const date = new Date(capture.createdAt);
    const timeStr = formatRelativeTime(date);
    const source = capture.sourceUrl ? new URL(capture.sourceUrl).hostname : '';

    return `
      <div class="recent-item">
        <div class="recent-title">${escapeHtml(capture.title || 'Untitled')}</div>
        <div class="recent-preview">${escapeHtml(capture.content.substring(0, 120))}</div>
        <div class="recent-meta">
          <span class="recent-source">${escapeHtml(source)}</span>
          <span>${timeStr}</span>
        </div>
      </div>
    `;
  }).join('');
}

function formatRelativeTime(date) {
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Toggle options panel
document.getElementById('options-toggle').addEventListener('click', () => {
  const panel = document.getElementById('options-panel');
  const toggle = document.getElementById('options-toggle');
  const open = panel.classList.toggle('show');
  toggle.innerHTML = (open ? '&#9652; Options' : '&#9662; Options');
});

// Save note from quick capture form
document.getElementById('save-btn').addEventListener('click', async () => {
  const titleInput = document.getElementById('capture-title');
  const textInput = document.getElementById('capture-text');
  const content = textInput.value.trim();

  if (!content) return;

  const title = titleInput.value.trim() || content.substring(0, 50);
  const entityType = document.getElementById('opt-entity').value;
  const folderName = document.getElementById('opt-folder').value.trim();
  const clsLevel = document.getElementById('opt-cls').value;

  try {
    await chrome.runtime.sendMessage({
      type: 'SAVE_NOTE',
      note: {
        title,
        content,
        sourceUrl: '',
        sourceTitle: '',
        entityType,
        folderName,
        clsLevel
      }
    });

    // Show success
    const successEl = document.getElementById('save-success');
    successEl.classList.add('show');
    titleInput.value = '';
    textInput.value = '';

    setTimeout(() => {
      successEl.classList.remove('show');
    }, 2000);

    // Refresh stats
    loadStats();
  } catch (error) {
    console.error('Failed to save note:', error);
  }
});

// Open web app
document.getElementById('open-app-btn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://threatcaddy.com' });
  window.close();
});

// Open clips review page
document.getElementById('review-btn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_CLIPS_PAGE' });
  window.close();
});

// Load stats when popup opens
loadStats();

// Refresh stats every 2 seconds while popup is open
setInterval(loadStats, 2000);

// Show platform-appropriate shortcut
const isMac = /Mac/i.test(navigator.platform);
document.getElementById('shortcut-kbd').textContent = isMac ? '⌃+Shift+X' : 'Alt+Shift+X';

// ── Permission toggles ──────────────────────────────────────────────────

// Shared slider styles (pseudo-element thumb)
(function initSliderStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .perm-slider::after {
      content: '';
      position: absolute;
      width: 18px; height: 18px;
      left: 2px; bottom: 2px;
      background: white;
      border-radius: 50%;
      transition: transform .2s;
    }
    input:checked + .perm-slider::after {
      transform: translateX(18px);
    }
  `;
  document.head.appendChild(style);
})();

function setupPermToggle(toggleId, sliderId, origins) {
  const toggle = document.getElementById(toggleId);
  const slider = document.getElementById(sliderId);

  chrome.permissions.contains({ origins }, (granted) => {
    toggle.checked = granted;
    slider.style.backgroundColor = granted ? '#8b5cf6' : '#4b5563';
  });

  toggle.addEventListener('change', async () => {
    if (toggle.checked) {
      const granted = await chrome.permissions.request({ origins }).catch(() => false);
      toggle.checked = granted;
      slider.style.backgroundColor = granted ? '#8b5cf6' : '#4b5563';
    } else {
      await chrome.permissions.remove({ origins }).catch(() => {});
      slider.style.backgroundColor = '#4b5563';
    }
  });
}

// AI chat — grants access to provider API origins
setupPermToggle('ai-perm-toggle', 'ai-perm-slider', [
  'https://api.anthropic.com/*',
  'https://api.openai.com/*',
  'https://generativelanguage.googleapis.com/*',
  'https://api.mistral.ai/*',
]);

// URL fetching — grants broad host access for /fetch command
setupPermToggle('url-perm-toggle', 'url-perm-slider', ['*://*/*']);
