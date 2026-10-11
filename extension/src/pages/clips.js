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
function captureRevision(capture) { return Number.isSafeInteger(capture.revision) && capture.revision > 0 ? capture.revision : 1; }
function importConfirmed(capture) { return capture.delivery?.status === 'confirmed' && capture.delivery.revision === captureRevision(capture); }
function captureRefs(captures) { return captures.map(capture => ({ id: capture.id, revision: captureRevision(capture) })); }
async function captureCommand(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (response?.success !== true) throw new Error(response?.error || 'The capture change was not saved. Refresh and retry.');
  return response;
}

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
let localApprovalRead = 0;
let localAIActionPending = false;
async function loadLocalAIApproval(preserveDraft = false) {
  const read = ++localApprovalRead;
  const target = targetUrlInput.value.trim();
  const input = document.getElementById('local-ai-url');
  const status = document.getElementById('local-ai-status');
  if (!preserveDraft) input.value = '';
  try {
    const url = new URL(target);
    url.search = ''; url.hash = '';
    const key = url.protocol === 'file:' ? url.href : url.origin;
    const { approvedAppsV1 = {} } = await chrome.storage.local.get(['approvedAppsV1']);
    if (read !== localApprovalRead) return;
    const approval = approvedAppsV1[key];
    if (!preserveDraft) input.value = approval?.localLLMOrigin || '';
    status.textContent = approval?.localLLMOrigin ? 'Saved for this app: ' + approval.localLLMOrigin
      : approval ? 'No local AI endpoint approved for this app.' : 'Approve this app before saving a local AI endpoint.';
  } catch (error) { if (read === localApprovalRead) status.textContent = 'Unable to read local AI approval: ' + error.message; }
}
targetUrlInput.addEventListener('input', () => { void loadLocalAIApproval(); });
document.getElementById('local-ai-url').addEventListener('input', () => { ++localApprovalRead; });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.approvedAppsV1) void loadLocalAIApproval(true);
});
async function updateLocalAIApproval(remove) {
  if (localAIActionPending) return;
  localAIActionPending = true;
  const save = document.getElementById('save-local-ai-btn');
  const clear = document.getElementById('remove-local-ai-btn');
  save.disabled = clear.disabled = true;
  const targetUrl = targetUrlInput.value.trim();
  const localLLMUrl = remove ? '' : document.getElementById('local-ai-url').value.trim();
  ++localApprovalRead;
  try {
    if (!remove) {
      const local = new URL(localLLMUrl);
      if (!['http:', 'https:'].includes(local.protocol) || local.username || local.password) throw new Error('Local AI must use HTTP(S) without credentials in its URL');
      if (!await requestHostPermission(localLLMUrl)) throw new Error('Local AI permission was denied; saved approval is unchanged.');
    }
    const response = await chrome.runtime.sendMessage({ type: 'UPDATE_LOCAL_LLM_APPROVAL', targetUrl, localLLMUrl });
    if (!response?.success) throw new Error(response?.error || 'Local AI approval failed');
    if (targetUrlInput.value.trim() === targetUrl) await loadLocalAIApproval();
  } catch (error) { if (targetUrlInput.value.trim() === targetUrl) document.getElementById('local-ai-status').textContent = error.message; }
  finally { localAIActionPending = false; save.disabled = clear.disabled = false; }
}
document.getElementById('save-local-ai-btn').addEventListener('click', () => { void updateLocalAIApproval(false); });
document.getElementById('remove-local-ai-btn').addEventListener('click', () => { void updateLocalAIApproval(true); });

async function loadSettings() {
  const { settings = {} } = await chrome.storage.local.get(['settings']);
  targetUrlInput.value = settings.targetUrl || DEFAULT_TARGET_URL;
  await loadLocalAIApproval();
  return settings;
}

async function saveSettings() {
  const targetUrl = targetUrlInput.value.trim() || DEFAULT_TARGET_URL;
  if (!isSafeUrl(targetUrl)) {
    showToast('Invalid target URL — only http, https, and file:// allowed', true);
    return;
  }

  // Request host permission for non-default URLs so dynamic bridge registration works
  {
    try {
      const granted = await requestHostPermission(targetUrl);
      if (!granted) {
        showToast('Permission denied — extension needs access to this site', true);
        return;
      }
    } catch (error) { showToast(error.message || 'Permission request failed', true); return; }
  }

  const approved = await chrome.runtime.sendMessage({ type: 'APPROVE_APP', targetUrl });
  if (!approved?.success) { showToast(approved?.error || 'App approval failed', true); return; }
  await loadLocalAIApproval();
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
  const unsentCount = captures.filter(c => !importConfirmed(c)).length;

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
    const sentClass = importConfirmed(capture) ? ' sent' : '';
    const label = importConfirmed(capture)
      ? 'Import confirmed' : capture.sent ? 'Sent (legacy, unverified)' : capture.delivery?.status === 'pending'
        ? 'Awaiting import confirmation' : capture.delivery?.status === 'failed' ? 'Import failed — retained' : '';
    const sentBadge = label ? `<span class="sent-badge">${escapeHtml(label)}</span>` : '';
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
        <div class="meta-inline-edit" data-id="${escapeHtml(capture.id)}" data-revision="${captureRevision(capture)}">
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
        try {
          await deleteCapture(captureRefs(captures.filter(capture => capture.id === id)));
          await refresh();
          showToast('Capture deleted');
        } catch (error) { showToast(error.message, true); await refresh(); }
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
      try { await updateCaptureField(id, Number(editRow.dataset.revision), field, el.value); }
      catch (error) { showToast(error.message, true); }
      await refresh();
    });
    // Also save on Enter for text inputs
    if (el.tagName === 'INPUT') {
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          el.blur();
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

async function deleteCapture(clips) {
  await captureCommand({ type: 'DELETE_CAPTURES', clips });
}

async function clearAll(captures) {
  await deleteCapture(captureRefs(captures));
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
    : `${url.protocol}//${url.hostname}/*`;
  const granted = await chrome.permissions.request({ origins: [origin] });
  return granted;
}

async function sendAllToTarget() {
  if (sendAllBtn.disabled) return;
  sendAllBtn.disabled = true;
  sendAllBtn.textContent = 'Preparing destination...';
  try {
  const captures = await loadCaptures();
  const unsent = captures.filter(c => !importConfirmed(c));

  if (unsent.length === 0) {
    showToast('No unsent captures to send');
    return;
  }

  let targetUrl = await getTargetUrl();

  // If no target URL configured, prompt user
  if (!targetUrl) {
    const currentVal = targetUrlInput.value.trim();
    if (!currentVal) {
      targetUrlInput.focus();
      showToast('Please configure a target URL first', true);
      return;
    }
    targetUrl = currentVal;
  }

  if (!isSafeUrl(targetUrl)) {
    showToast('Invalid target URL — only http, https, and file:// allowed', true);
    return;
  }

  // For file:// targets, check that the extension has file URL access before proceeding
  if (targetUrl.startsWith('file://')) {
    const hasFileAccess = await new Promise(resolve =>
      chrome.extension.isAllowedFileSchemeAccess(resolve)
    );
    if (!hasFileAccess) {
      showToast(
        'File URL access is disabled. Go to chrome://extensions → ThreatCaddy → Enable "Allow access to file URLs"',
        true
      );
      return;
    }
  }

    // Sending does not request new permission. Pairing remains an explicit Save
    // Target action; a revoked or unavailable destination fails closed.
    const prepared = await captureCommand({ type: 'PREPARE_CLIP_DELIVERY', targetUrl });
    const legacyCount = unsent.filter(capture => capture.sent).length;
    const confirmed = await showModal('Confirm import workspace',
      `Import ${unsent.length} capture(s) into “${prepared.workspaceLabel}” (${prepared.workspaceId}) at ${targetUrl}? Only database-confirmed imports will be marked sent.${legacyCount ? ` ${legacyCount} legacy capture(s) were previously marked sent without verification; importing them may create duplicates. Review or delete them first if unsure.` : ''}`, 'Import captures', false);
    if (!confirmed) return;
    sendAllBtn.textContent = 'Waiting for import confirmation...';
    const response = await chrome.runtime.sendMessage({
      type: 'SEND_TO_TARGET',
      sessionId: prepared.sessionId,
      clips: captureRefs(unsent)
    });
    await refresh();
    if (response?.success === true) {
      showToast(`${response.confirmed} clip import(s) confirmed.`);
    } else {
      showToast(`${response?.confirmed || 0} of ${unsent.length} imports confirmed. ${response?.error || 'Unconfirmed captures are retained.'}`, true);
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
  await captureCommand({ type: 'UPDATE_CAPTURES', clips: captureRefs(captures.filter(capture => !importConfirmed(capture))),
    values: { ...(entityType ? { entityType } : {}), ...(folderName !== undefined ? { folderName } : {}), ...(clsLevel !== undefined ? { clsLevel } : {}) } });
}

async function updateCaptureField(id, revision, field, value) {
  await captureCommand({ type: 'UPDATE_CAPTURES', clips: [{ id, revision }], values: { [field]: value } });
}

applyDefaultsBtn.addEventListener('click', async () => {
  const entityType = importEntity.value;
  const folderName = importFolder.value.trim();
  const clsLevel = importCls.value;
  try {
    await applyDefaults(entityType, folderName, clsLevel);
    await refresh();
    showToast('Defaults applied to all unsent clips');
  } catch (error) { showToast(error.message, true); await refresh(); }
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
    try {
      await clearAll(captures);
      await refresh();
      showToast('Confirmed captures cleared; newer captures were retained');
    } catch (error) { showToast(error.message, true); await refresh(); }
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.captures && !capturesList.contains(document.activeElement)) void refresh();
});

// ---- Init ----

loadSettings();
refresh();
