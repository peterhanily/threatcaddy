// Popup script for ThreatCaddy extension

const { t, localize, confirmation } = TC_UI;
localize();
const showConfirmation = confirmation({
  overlay: document.getElementById('modal-overlay'), title: document.getElementById('modal-title'),
  message: document.getElementById('modal-message'), cancel: document.getElementById('modal-cancel'),
  confirm: document.getElementById('modal-confirm'), fallback: document.getElementById('settings-back'),
});

// Load stats and recent captures on popup open
async function loadStats() {
  try {
    const { captures = [], captureErrorV1 } = await chrome.storage.local.get(['captures', 'captureErrorV1']);
    if (typeof captureErrorV1 === 'string' && captureErrorV1) {
      const errorEl = document.getElementById('save-error');
      errorEl.textContent = captureErrorV1;
      errorEl.classList.add('show');
    }

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
    const errorEl = document.getElementById('save-error');
    errorEl.textContent = t('capturesLoadFailed');
    errorEl.classList.add('show');
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
    let source = '';
    try { source = capture.sourceUrl ? new URL(capture.sourceUrl).hostname : ''; } catch { /* Legacy plain text source. */ }

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
  toggle.setAttribute('aria-expanded', String(open));
  const optionsLabel = chrome.i18n.getMessage('options');
  toggle.innerHTML = (open ? '&#9652; ' : '&#9662; ') + escapeHtml(optionsLabel);
});

// Save note from quick capture form
document.getElementById('save-btn').addEventListener('click', async () => {
  const saveButton = document.getElementById('save-btn');
  if (saveButton.disabled) return;
  const titleInput = document.getElementById('capture-title');
  const textInput = document.getElementById('capture-text');
  const originalTitle = titleInput.value;
  const originalText = textInput.value;
  const content = textInput.value.trim();

  if (!content) return;

  const title = titleInput.value.trim() || content.substring(0, 50);
  const entityType = document.getElementById('opt-entity').value;
  const folderName = document.getElementById('opt-folder').value.trim();
  const clsLevel = document.getElementById('opt-cls').value;
  saveButton.disabled = true;
  document.getElementById('save-error').classList.remove('show');
  document.getElementById('save-success').classList.remove('show');

  try {
    const result = await chrome.runtime.sendMessage({
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
    if (result?.success !== true) throw new Error(result?.error || t('captureSaveFailed'));

    // Show success
    const successEl = document.getElementById('save-success');
    successEl.classList.add('show');
    if (titleInput.value === originalTitle) titleInput.value = '';
    if (textInput.value === originalText) textInput.value = '';

    setTimeout(() => {
      successEl.classList.remove('show');
    }, 2000);

    // Refresh stats
    loadStats();
  } catch (error) {
    console.error('Failed to save note:', error);
    const errorEl = document.getElementById('save-error');
    errorEl.textContent = error.message || t('captureSaveFailed');
    errorEl.classList.add('show');
  } finally {
    saveButton.disabled = false;
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
  document.getElementById('settings-back').focus();
});

document.getElementById('settings-back').addEventListener('click', () => {
  refreshAllPermToggles();
  settingsPage.style.display = 'none';
  mainSections.forEach(el => el.style.display = '');
  document.getElementById('settings-btn').focus();
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
let localApprovalRead = 0;
let localAIActionPending = false;
function approvalTargetKey(value) {
  const url = new URL(value);
  if (url.protocol === 'file:') { url.hash = ''; url.search = ''; return url.href; }
  return url.origin;
}
async function loadLocalAIApproval(preserveDraft = false) {
  const read = ++localApprovalRead;
  const url = document.getElementById('settings-target-url').value.trim();
  const input = document.getElementById('settings-local-ai-url');
  const status = document.getElementById('settings-local-ai-status');
  if (!preserveDraft) input.value = '';
  try {
    const { approvedAppsV1 = {} } = await chrome.storage.local.get(['approvedAppsV1']);
    if (read !== localApprovalRead) return;
    const approval = approvedAppsV1[approvalTargetKey(url)];
    if (!preserveDraft) input.value = approval?.localLLMOrigin || '';
    status.textContent = approval?.localLLMOrigin ? t('localAISavedOrigin', [approval.localLLMOrigin])
      : t(approval ? 'localAINone' : 'localAIApproveFirst');
  } catch (error) { if (read === localApprovalRead) status.textContent = t('localAIReadFailed', [error.message]); }
}
document.getElementById('settings-target-url').addEventListener('input', () => { void loadLocalAIApproval(); });
document.getElementById('settings-local-ai-url').addEventListener('input', () => { ++localApprovalRead; });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.approvedAppsV1) void loadLocalAIApproval(true);
});
(async function loadTargetUrl() {
  const { settings = {} } = await chrome.storage.local.get(['settings']);
  document.getElementById('settings-target-url').value = settings.targetUrl || 'https://threatcaddy.com';
  await loadLocalAIApproval();
})();

document.getElementById('settings-save-url').addEventListener('click', async () => {
  const url = document.getElementById('settings-target-url').value.trim();
  if (!url) return;
  const status = document.getElementById('settings-approval-status');
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:', 'file:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error(t('invalidAppTarget'));
    const origins = [parsed.protocol === 'file:' ? 'file:///*' : parsed.protocol + '//' + parsed.hostname + '/*'];
    if (!await chrome.permissions.request({ origins })) throw new Error(t('appPermissionDenied'));
    const response = await chrome.runtime.sendMessage({ type: 'APPROVE_APP', targetUrl: url });
    if (!response?.success) throw new Error(response?.error || t('appApprovalFailed'));
    status.textContent = t('appApproved');
    await loadLocalAIApproval();
  } catch (error) { status.textContent = error.message; }
});

async function updateLocalAIApproval(remove) {
  if (localAIActionPending) return;
  localAIActionPending = true;
  const save = document.getElementById('settings-save-local-ai');
  const clear = document.getElementById('settings-remove-local-ai');
  save.disabled = clear.disabled = true;
  const targetUrl = document.getElementById('settings-target-url').value.trim();
  const localLLMUrl = remove ? '' : document.getElementById('settings-local-ai-url').value.trim();
  const status = document.getElementById('settings-local-ai-status');
  ++localApprovalRead;
  try {
    if (!remove) {
      const local = new URL(localLLMUrl);
      if (!['http:', 'https:'].includes(local.protocol) || local.username || local.password) throw new Error(t('invalidLocalAI'));
      if (!await chrome.permissions.request({ origins: [local.protocol + '//' + local.hostname + '/*'] })) throw new Error(t('localAIPermissionDenied'));
    }
    const response = await chrome.runtime.sendMessage({ type: 'UPDATE_LOCAL_LLM_APPROVAL', targetUrl, localLLMUrl });
    if (!response?.success) throw new Error(response?.error || t('localAIApprovalFailed'));
    if (document.getElementById('settings-target-url').value.trim() === targetUrl) await loadLocalAIApproval();
  } catch (error) { if (document.getElementById('settings-target-url').value.trim() === targetUrl) status.textContent = error.message; }
  finally { localAIActionPending = false; save.disabled = clear.disabled = false; }
}
document.getElementById('settings-save-local-ai').addEventListener('click', () => { void updateLocalAIApproval(false); });
document.getElementById('settings-remove-local-ai').addEventListener('click', () => { void updateLocalAIApproval(true); });

document.getElementById('settings-revoke-apps').addEventListener('click', async () => {
  if (!await showConfirmation(t('revokeApps'), t('revokeAppsQuestion'), t('revokeApps'), true)) return;
  const button = document.getElementById('settings-revoke-apps');
  button.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'REVOKE_APPS' });
    document.getElementById('settings-approval-status').textContent = response?.success ? t('appsRevoked') : response?.error || t('revokeFailed');
    if (response?.success) await loadLocalAIApproval();
  } catch { document.getElementById('settings-approval-status').textContent = t('revokeFailed'); }
  finally { button.disabled = false; }
});
const notificationButton = document.getElementById('settings-notifications');
const notificationStatus = document.getElementById('settings-notification-status');
let notificationRequestPending = false;
let notificationPermissionVersion = 0;

function renderNotificationPermission(granted, message) {
  notificationButton.disabled = notificationRequestPending || granted;
  notificationButton.textContent = t(notificationRequestPending ? 'notificationWaiting' : granted ? 'notificationEnabled' : 'notificationEnable');
  notificationStatus.textContent = message || t(granted ? 'notificationEnabledDesc' : 'notificationDisabledDesc');
}

async function refreshNotificationPermission() {
  if (notificationRequestPending) return;
  const version = ++notificationPermissionVersion;
  try {
    const granted = await chrome.permissions.contains({ permissions: ['notifications'] });
    if (version === notificationPermissionVersion && !notificationRequestPending) renderNotificationPermission(granted === true);
  } catch (error) {
    if (version === notificationPermissionVersion && !notificationRequestPending) {
      renderNotificationPermission(false, t('notificationCheckFailed', [error?.message || String(error)]));
    }
  }
}

notificationButton.addEventListener('click', async () => {
  if (notificationRequestPending) return;
  notificationRequestPending = true;
  ++notificationPermissionVersion; // Discard a settings-open read finishing after this click.
  renderNotificationPermission(false, t('notificationWaitingDesc'));
  let failure;
  let granted = false;
  try {
    // Invoke directly within the user gesture, before any asynchronous read.
    await chrome.permissions.request({ permissions: ['notifications'] });
  } catch (error) {
    failure = t('notificationRequestFailed', [error?.message || String(error)]);
  }
  try {
    // The request response alone is not evidence of current permission.
    granted = await chrome.permissions.contains({ permissions: ['notifications'] }) === true;
  } catch (error) {
    failure = failure || t('notificationVerifyFailed', [error?.message || String(error)]);
  }
  notificationRequestPending = false;
  renderNotificationPermission(granted, failure
    ? failure + ' ' + t('inAppAlertsAvailable')
    : granted ? undefined : t('notificationNotEnabled'));
  // Retain the explicit-action acknowledgement used by existing popup clients.
  // Passive permission refreshes never overwrite the app approval status.
  document.getElementById('settings-approval-status').textContent = notificationStatus.textContent;
});

for (const event of [chrome.permissions.onAdded, chrome.permissions.onRemoved]) {
  event?.addListener(permission => {
    if (permission.permissions?.includes('notifications')) void refreshNotificationPermission();
  });
}
