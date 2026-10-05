// Popup script for ThreatCaddy extension

// i18n bootstrap — resolve data-i18n attributes to localized strings
document.querySelectorAll('[data-i18n]').forEach(el => {
  const msg = chrome.i18n.getMessage(el.dataset.i18n);
  if (msg) el.textContent = msg;
});
document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
  const msg = chrome.i18n.getMessage(el.dataset.i18nPlaceholder);
  if (msg) el.placeholder = msg;
});
document.querySelectorAll('[data-i18n-title]').forEach(el => {
  const msg = chrome.i18n.getMessage(el.dataset.i18nTitle);
  if (msg) el.title = msg;
});

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
    list.innerHTML = '<div class="recent-empty">' + escapeHtml(chrome.i18n.getMessage('noCaptures')) + '</div>';
    return;
  }

  list.innerHTML = captures.map(capture => {
    const date = new Date(capture.createdAt);
    const timeStr = formatRelativeTime(date);
    const source = capture.sourceUrl ? new URL(capture.sourceUrl).hostname : '';

    return `
      <div class="recent-item">
        <div class="recent-title">${escapeHtml(capture.title || chrome.i18n.getMessage('untitled'))}</div>
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

  if (minutes < 1) return chrome.i18n.getMessage('justNow');
  if (minutes < 60) return chrome.i18n.getMessage('minutesAgo', [String(minutes)]);
  if (hours < 24) return chrome.i18n.getMessage('hoursAgo', [String(hours)]);
  if (days < 7) return chrome.i18n.getMessage('daysAgo', [String(days)]);
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
  const optionsLabel = chrome.i18n.getMessage('options');
  toggle.innerHTML = (open ? '&#9652; ' : '&#9662; ') + escapeHtml(optionsLabel);
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
    const errorEl = document.getElementById('save-error');
    errorEl.classList.add('show');
    setTimeout(() => { errorEl.classList.remove('show'); }, 4000);
  }
});

// Open web app (uses configured target URL, not hardcoded)
document.getElementById('open-app-btn').addEventListener('click', async () => {
  const { settings = {} } = await chrome.storage.local.get(['settings']);
  const targetUrl = settings.targetUrl || 'https://threatcaddy.com';
  chrome.tabs.create({ url: targetUrl });
  window.close();
});

// Open clips review page
document.getElementById('review-btn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_CLIPS_PAGE' });
  window.close();
});

// Load stats when popup opens
loadStats();

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
    #settings-btn:hover { color: #e5e7eb; }
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
    // *://*/* is a superset of the AI origins, so toggling one can
    // implicitly grant or revoke the other. Refresh all toggles.
    if (typeof refreshAllPermToggles === 'function') refreshAllPermToggles();
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

// ── Settings page ────────────────────────────────────────────────────────

const mainSections = document.querySelectorAll('body > section, body > footer, body > header');
const settingsPage = document.getElementById('settings-page');

// Sync all permission toggles to reflect current browser state
function refreshAllPermToggles() {
  const aiOrigins = [
    'https://api.anthropic.com/*',
    'https://api.openai.com/*',
    'https://generativelanguage.googleapis.com/*',
    'https://api.mistral.ai/*',
  ];
  const urlOrigins = ['*://*/*'];

  chrome.permissions.contains({ origins: aiOrigins }, (granted) => {
    for (const [tid, sid] of [['ai-perm-toggle', 'ai-perm-slider'], ['settings-ai-toggle', 'settings-ai-slider']]) {
      const t = document.getElementById(tid);
      const s = document.getElementById(sid);
      if (t && s) { t.checked = granted; s.style.backgroundColor = granted ? '#8b5cf6' : '#4b5563'; }
    }
  });
  chrome.permissions.contains({ origins: urlOrigins }, (granted) => {
    for (const [tid, sid] of [['url-perm-toggle', 'url-perm-slider'], ['settings-url-toggle', 'settings-url-slider']]) {
      const t = document.getElementById(tid);
      const s = document.getElementById(sid);
      if (t && s) { t.checked = granted; s.style.backgroundColor = granted ? '#8b5cf6' : '#4b5563'; }
    }
  });
  chrome.extension.isAllowedFileSchemeAccess(allowed => {
    for (const [tid, sid] of [['file-perm-toggle', 'file-perm-slider'], ['settings-file-toggle', 'settings-file-slider']]) {
      const t = document.getElementById(tid);
      const s = document.getElementById(sid);
      if (t && s) { t.checked = allowed; s.style.backgroundColor = allowed ? '#8b5cf6' : '#4b5563'; }
    }
  });
}

document.getElementById('settings-btn').addEventListener('click', () => {
  refreshAllPermToggles();
  void refreshNotificationPermission();
  mainSections.forEach(el => el.style.display = 'none');
  settingsPage.style.display = 'block';
});

document.getElementById('settings-back').addEventListener('click', () => {
  refreshAllPermToggles();
  settingsPage.style.display = 'none';
  mainSections.forEach(el => el.style.display = '');
});

// Settings page permission toggles (mirror the main page ones)
setupPermToggle('settings-ai-toggle', 'settings-ai-slider', [
  'https://api.anthropic.com/*',
  'https://api.openai.com/*',
  'https://generativelanguage.googleapis.com/*',
  'https://api.mistral.ai/*',
]);
setupPermToggle('settings-url-toggle', 'settings-url-slider', ['*://*/*']);

// Target URL — stored inside settings.targetUrl to match background.js / clips.js
(async function loadTargetUrl() {
  const { settings = {} } = await chrome.storage.local.get(['settings']);
  document.getElementById('settings-target-url').value = settings.targetUrl || 'https://threatcaddy.com';
})();

document.getElementById('settings-save-url').addEventListener('click', async () => {
  const url = document.getElementById('settings-target-url').value.trim();
  if (!url) return;
  const status = document.getElementById('settings-approval-status');
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:', 'file:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Use an HTTP(S) app or exact standalone file without credentials');
    const origins = [parsed.protocol === 'file:' ? 'file:///*' : parsed.protocol + '//' + parsed.hostname + '/*'];
    const localLLMUrl = document.getElementById('settings-local-ai-url').value.trim();
    if (localLLMUrl) {
      const local = new URL(localLLMUrl);
      if (!['http:', 'https:'].includes(local.protocol) || local.username || local.password) throw new Error('Local AI must use HTTP(S) without credentials in its URL');
      origins.push(local.protocol + '//' + local.hostname + '/*');
    }
    if (!await chrome.permissions.request({ origins })) throw new Error('App access permission was denied');
    const response = await chrome.runtime.sendMessage({ type: 'APPROVE_APP', targetUrl: url, localLLMUrl });
    if (!response?.success) throw new Error(response?.error || 'App approval failed');
    status.textContent = 'App approved. Reload the app tab to connect.';
  } catch (error) { status.textContent = error.message; }
});

document.getElementById('settings-revoke-apps').addEventListener('click', async () => {
  const response = await chrome.runtime.sendMessage({ type: 'REVOKE_APPS' });
  document.getElementById('settings-approval-status').textContent = response?.success ? 'All app connections revoked.' : response?.error || 'Revocation failed';
});
const notificationButton = document.getElementById('settings-notifications');
const notificationStatus = document.getElementById('settings-notification-status');
let notificationRequestPending = false;
let notificationPermissionVersion = 0;

function renderNotificationPermission(granted, message) {
  notificationButton.disabled = notificationRequestPending || granted;
  notificationButton.textContent = notificationRequestPending ? 'Waiting for browser permission…'
    : granted ? 'Desktop notifications enabled' : 'Enable desktop notifications';
  notificationStatus.textContent = message || (granted
    ? 'Desktop notifications enabled. Operating system settings may still suppress display. Revoke permission in your browser extension settings.'
    : 'Desktop notifications are disabled; in-app alerts remain available.');
}

async function refreshNotificationPermission() {
  if (notificationRequestPending) return;
  const version = ++notificationPermissionVersion;
  try {
    const granted = await chrome.permissions.contains({ permissions: ['notifications'] });
    if (version === notificationPermissionVersion && !notificationRequestPending) renderNotificationPermission(granted === true);
  } catch (error) {
    if (version === notificationPermissionVersion && !notificationRequestPending) {
      renderNotificationPermission(false, 'Unable to check notification permission: ' + (error?.message || String(error)));
    }
  }
}

notificationButton.addEventListener('click', async () => {
  if (notificationRequestPending) return;
  notificationRequestPending = true;
  ++notificationPermissionVersion; // Discard a settings-open read finishing after this click.
  renderNotificationPermission(false, 'Waiting for the browser permission response. If no prompt appears, check your browser extension permissions or reopen this panel.');
  let failure;
  let granted = false;
  try {
    // Invoke directly within the user gesture, before any asynchronous read.
    await chrome.permissions.request({ permissions: ['notifications'] });
  } catch (error) {
    failure = 'Notification permission request failed: ' + (error?.message || String(error));
  }
  try {
    // The request response alone is not evidence of current permission.
    granted = await chrome.permissions.contains({ permissions: ['notifications'] }) === true;
  } catch (error) {
    failure = failure || 'Unable to verify notification permission: ' + (error?.message || String(error));
  }
  notificationRequestPending = false;
  renderNotificationPermission(granted, failure
    ? failure + ' In-app alerts remain available.'
    : granted ? undefined : 'Desktop notifications were not enabled; in-app alerts remain available. Check your browser extension permissions if no prompt appeared.');
  // Retain the explicit-action acknowledgement used by existing popup clients.
  // Passive permission refreshes never overwrite the app approval status.
  document.getElementById('settings-approval-status').textContent = notificationStatus.textContent;
});

for (const event of [chrome.permissions.onAdded, chrome.permissions.onRemoved]) {
  event?.addListener(permission => {
    if (permission.permissions?.includes('notifications')) void refreshNotificationPermission();
  });
}
