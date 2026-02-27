// Clips review page logic

const DEFAULT_TARGET_URL = 'https://threatcaddy.com';

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

// Import options references
const importFolder = document.getElementById('import-folder');
const importEntity = document.getElementById('import-entity');
const importCls = document.getElementById('import-cls');
const applyDefaultsBtn = document.getElementById('apply-defaults-btn');

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

function isSafeUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return /^(https?|file):$/.test(parsed.protocol);
  } catch {
    return false;
  }
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
  if (!isSafeUrl(targetUrl)) {
    showToast('Invalid target URL — only http, https, and file:// allowed', true);
    return;
  }
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
        <p style="font-size: 13px;">Select text on any page and right-click "Save to ThreatCaddy"</p>
      </div>
    `;
    return;
  }

  // Newest first
  const sorted = [...captures].sort((a, b) => b.createdAt - a.createdAt);

  const entityLabels = { 'note': 'Note', 'task': 'Task', 'timeline-event': 'Timeline Event' };

  capturesList.innerHTML = sorted.map(capture => {
    const sentClass = capture.sent ? ' sent' : '';
    const sentBadge = capture.sent ? '<span class="sent-badge">Sent</span>' : '';
    const sourceLink = capture.sourceUrl && isSafeUrl(capture.sourceUrl)
      ? `<a class="capture-source" href="${escapeHtml(capture.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(capture.sourceUrl)}</a>`
      : capture.sourceUrl
        ? `<span class="capture-source">${escapeHtml(capture.sourceUrl)}</span>`
        : '<span class="capture-source" style="color: #6b7280;">No source URL</span>';
    const sourceTitle = capture.sourceTitle
      ? `<div class="capture-source-title">${escapeHtml(capture.sourceTitle)}</div>`
      : '';

    const eType = capture.entityType || 'note';
    const fName = capture.folderName || '';
    const cls = capture.clsLevel || '';
    const typeBadge = `<span class="meta-badge type-${escapeHtml(eType)}" data-id="${escapeHtml(capture.id)}" data-field="entityType">${escapeHtml(entityLabels[eType] || 'Note')}</span>`;
    const folderBadge = fName ? `<span class="meta-badge folder-badge" data-id="${escapeHtml(capture.id)}" data-field="folderName">${escapeHtml(fName)}</span>` : '';
    const clsBadge = cls ? `<span class="meta-badge cls-badge" data-id="${escapeHtml(capture.id)}" data-field="clsLevel">${escapeHtml(cls)}</span>` : '';

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
        <div class="capture-metadata">${typeBadge}${folderBadge}${clsBadge}</div>
        <div class="meta-inline-edit" data-id="${escapeHtml(capture.id)}">
          <select data-field="entityType">
            <option value="note"${eType === 'note' ? ' selected' : ''}>Note</option>
            <option value="task"${eType === 'task' ? ' selected' : ''}>Task</option>
            <option value="timeline-event"${eType === 'timeline-event' ? ' selected' : ''}>Timeline Event</option>
          </select>
          <input type="text" data-field="folderName" value="${escapeHtml(fName)}" placeholder="Folder" style="width:100px;" />
          <select data-field="clsLevel">
            <option value=""${!cls ? ' selected' : ''}>None</option>
            <option value="TLP:CLEAR"${cls === 'TLP:CLEAR' ? ' selected' : ''}>TLP:CLEAR</option>
            <option value="TLP:GREEN"${cls === 'TLP:GREEN' ? ' selected' : ''}>TLP:GREEN</option>
            <option value="TLP:AMBER"${cls === 'TLP:AMBER' ? ' selected' : ''}>TLP:AMBER</option>
            <option value="TLP:AMBER+STRICT"${cls === 'TLP:AMBER+STRICT' ? ' selected' : ''}>TLP:AMBER+STRICT</option>
            <option value="TLP:RED"${cls === 'TLP:RED' ? ' selected' : ''}>TLP:RED</option>
          </select>
        </div>
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

  // Wire up metadata badge clicks to toggle inline edit
  capturesList.querySelectorAll('.meta-badge').forEach(badge => {
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = badge.dataset.id;
      const editRow = capturesList.querySelector(`.meta-inline-edit[data-id="${id}"]`);
      if (editRow) editRow.classList.toggle('show');
    });
  });

  // Wire up inline edit changes
  capturesList.querySelectorAll('.meta-inline-edit select, .meta-inline-edit input').forEach(el => {
    const eventType = el.tagName === 'SELECT' ? 'change' : 'blur';
    el.addEventListener(eventType, async () => {
      const editRow = el.closest('.meta-inline-edit');
      const id = editRow.dataset.id;
      const field = el.dataset.field;
      await updateCaptureField(id, field, el.value);
      await refresh();
    });
    // Also save on Enter for text inputs
    if (el.tagName === 'INPUT') {
      el.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
          const editRow = el.closest('.meta-inline-edit');
          const id = editRow.dataset.id;
          await updateCaptureField(id, el.dataset.field, el.value);
          await refresh();
        }
      });
    }
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
  if (!isSafeUrl(targetUrl)) return false;
  const url = new URL(targetUrl);
  // file:// URLs use a different origin pattern
  const origin = url.protocol === 'file:'
    ? 'file:///*'
    : `${url.protocol}//${url.host}/*`;
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
    sendAllBtn.textContent = 'Send All to ThreatCaddy';
  }
}

// ---- Apply Defaults & Per-Clip Editing ----

async function applyDefaults(entityType, folderName, clsLevel) {
  const { captures = [] } = await chrome.storage.local.get(['captures']);
  for (const c of captures) {
    if (c.sent) continue;
    if (entityType) c.entityType = entityType;
    if (folderName !== undefined) c.folderName = folderName;
    if (clsLevel !== undefined) c.clsLevel = clsLevel;
  }
  await chrome.storage.local.set({ captures });
}

async function updateCaptureField(id, field, value) {
  const { captures = [] } = await chrome.storage.local.get(['captures']);
  const capture = captures.find(c => c.id === id);
  if (capture) {
    capture[field] = value;
    await chrome.storage.local.set({ captures });
  }
}

applyDefaultsBtn.addEventListener('click', async () => {
  const entityType = importEntity.value;
  const folderName = importFolder.value.trim();
  const clsLevel = importCls.value;
  await applyDefaults(entityType, folderName, clsLevel);
  await refresh();
  showToast('Defaults applied to all unsent clips');
});

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
