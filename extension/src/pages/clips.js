// Clips review page logic

const DEFAULT_TARGET_URL = 'https://browsernotes.online';

// DOM references
const capturesList = document.getElementById('captures-list');
const statTotal = document.getElementById('stat-total');
const statWeek = document.getElementById('stat-week');
const statUnsent = document.getElementById('stat-unsent');
const sendAllBtn = document.getElementById('send-all-btn');
const refreshBtn = document.getElementById('refresh-btn');
const clearAllBtn = document.getElementById('clear-all-btn');
const targetUrlInput = document.getElementById('target-url');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const settingsSaved = document.getElementById('settings-saved');

// Modal references
const modalOverlay = document.getElementById('modal-overlay');
const modalTitle = document.getElementById('modal-title');
const modalMessage = document.getElementById('modal-message');
const modalCancel = document.getElementById('modal-cancel');
const modalConfirm = document.getElementById('modal-confirm');

let modalResolve = null;

// ---- Modal ----

function showModal(title, message, confirmLabel, isDanger) {
  modalTitle.textContent = title;
  modalMessage.textContent = message;
  modalConfirm.textContent = confirmLabel || 'Confirm';
  modalConfirm.className = isDanger ? 'btn btn-danger' : 'btn btn-primary';
  modalOverlay.classList.remove('hidden');

  return new Promise((resolve) => {
    modalResolve = resolve;
  });
}

function hideModal(result) {
  modalOverlay.classList.add('hidden');
  if (modalResolve) {
    modalResolve(result);
    modalResolve = null;
  }
}

modalCancel.addEventListener('click', () => hideModal(false));
modalConfirm.addEventListener('click', () => hideModal(true));
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) hideModal(false);
});

// ---- Toast ----

function showToast(message, isError) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast' + (isError ? ' error' : '');
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 3000);
}

// ---- Helpers ----

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString();
}

// ---- Settings ----

async function loadSettings() {
  const { settings = {} } = await chrome.storage.local.get(['settings']);
  targetUrlInput.value = settings.targetUrl || DEFAULT_TARGET_URL;
  return settings;
}

async function saveSettings() {
  const targetUrl = targetUrlInput.value.trim() || DEFAULT_TARGET_URL;
  await chrome.storage.local.set({ settings: { targetUrl } });
  settingsSaved.classList.add('show');
  setTimeout(() => settingsSaved.classList.remove('show'), 2000);
}

saveSettingsBtn.addEventListener('click', saveSettings);

// ---- Load & Render ----

async function loadCaptures() {
  const { captures = [] } = await chrome.storage.local.get(['captures']);
  return captures;
}

function renderStats(captures) {
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const weekCount = captures.filter(c => c.createdAt > oneWeekAgo).length;
  const unsentCount = captures.filter(c => !c.sent).length;

  statTotal.textContent = captures.length;
  statWeek.textContent = weekCount;
  statUnsent.textContent = unsentCount;
}

function renderCaptures(captures) {
  if (captures.length === 0) {
    capturesList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">&#128203;</div>
        <p>No captures yet</p>
        <p style="font-size: 13px;">Select text on any page and right-click "Save to BrowserNotes"</p>
      </div>
    `;
    return;
  }

  // Newest first
  const sorted = [...captures].sort((a, b) => b.createdAt - a.createdAt);

  capturesList.innerHTML = sorted.map(capture => {
    const sentClass = capture.sent ? ' sent' : '';
    const sentBadge = capture.sent ? '<span class="sent-badge">Sent</span>' : '';
    const sourceLink = capture.sourceUrl
      ? `<a class="capture-source" href="${escapeHtml(capture.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(capture.sourceUrl)}</a>`
      : '<span class="capture-source" style="color: #6b7280;">No source URL</span>';
    const sourceTitle = capture.sourceTitle
      ? `<div class="capture-source-title">${escapeHtml(capture.sourceTitle)}</div>`
      : '';

    return `
      <div class="capture-card${sentClass}" data-id="${escapeHtml(capture.id)}">
        <div class="capture-card-header">
          <div class="capture-meta">
            ${sourceTitle}
            <span class="capture-date">${formatDate(capture.createdAt)}${sentBadge}</span>
            ${sourceLink}
          </div>
          <button class="capture-delete-btn" data-id="${escapeHtml(capture.id)}">Delete</button>
        </div>
        <div class="capture-content">${escapeHtml(capture.content)}</div>
      </div>
    `;
  }).join('');

  // Wire up delete buttons
  capturesList.querySelectorAll('.capture-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const confirmed = await showModal(
        'Delete Capture',
        'Are you sure you want to delete this capture?',
        'Delete',
        true
      );
      if (confirmed) {
        await deleteCapture(id);
        await refresh();
        showToast('Capture deleted');
      }
    });
  });
}

async function refresh() {
  const captures = await loadCaptures();
  renderStats(captures);
  renderCaptures(captures);
}

// ---- Actions ----

async function deleteCapture(id) {
  const { captures = [] } = await chrome.storage.local.get(['captures']);
  const filtered = captures.filter(c => c.id !== id);
  await chrome.storage.local.set({ captures: filtered });
}

async function clearAll() {
  await chrome.storage.local.set({ captures: [] });
}

async function getTargetUrl() {
  const { settings = {} } = await chrome.storage.local.get(['settings']);
  return settings.targetUrl || DEFAULT_TARGET_URL;
}

async function requestHostPermission(targetUrl) {
  // Build an origin pattern like "*://browsernotes.online/*"
  const url = new URL(targetUrl);
  const origin = `${url.protocol}//${url.host}/*`;
  const granted = await chrome.permissions.request({ origins: [origin] });
  return granted;
}

async function sendAllToTarget() {
  const captures = await loadCaptures();
  const unsent = captures.filter(c => !c.sent);

  if (unsent.length === 0) {
    showToast('No unsent captures to send');
    return;
  }

  let targetUrl = await getTargetUrl();

  // If no target URL configured, prompt user
  if (!targetUrl || targetUrl === DEFAULT_TARGET_URL) {
    const currentVal = targetUrlInput.value.trim();
    if (!currentVal) {
      targetUrlInput.focus();
      showToast('Please configure a target URL first', true);
      return;
    }
    targetUrl = currentVal;
  }

  // Request host permission for the target (Chrome will prompt the user)
  try {
    const granted = await requestHostPermission(targetUrl);
    if (!granted) {
      showToast('Permission denied — cannot send to this host', true);
      return;
    }
  } catch (err) {
    showToast('Invalid target URL', true);
    return;
  }

  sendAllBtn.disabled = true;
  sendAllBtn.textContent = 'Sending...';

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'SEND_TO_TARGET',
      targetUrl,
      captures: unsent
    });

    if (response && response.success) {
      // Mark captures as sent and remove them
      const allCaptures = await loadCaptures();
      const sentIds = new Set(unsent.map(c => c.id));
      const remaining = allCaptures.filter(c => !sentIds.has(c.id));
      await chrome.storage.local.set({ captures: remaining });
      await refresh();
      showToast(`${unsent.length} clip(s) sent successfully!`);
    } else {
      showToast(response?.error || 'Failed to send clips', true);
    }
  } catch (error) {
    showToast('Failed to send: ' + error.message, true);
  } finally {
    sendAllBtn.disabled = false;
    sendAllBtn.textContent = 'Send All to BrowserNotes';
  }
}

// ---- Event Listeners ----

sendAllBtn.addEventListener('click', sendAllToTarget);

refreshBtn.addEventListener('click', refresh);

clearAllBtn.addEventListener('click', async () => {
  const captures = await loadCaptures();
  if (captures.length === 0) return;

  const confirmed = await showModal(
    'Clear All Captures',
    `This will permanently delete all ${captures.length} capture(s). This cannot be undone.`,
    'Clear All',
    true
  );

  if (confirmed) {
    await clearAll();
    await refresh();
    showToast('All captures cleared');
  }
});

// ---- Init ----

loadSettings();
refresh();
