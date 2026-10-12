// Clips review page logic

const DEFAULT_TARGET_URL = 'https://threatcaddy.com';
const { t, localize, confirmation } = TC_UI;
localize();

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
const metadataDrafts = new Map();
const pendingMetadataWrites = new Set();
const pendingMetadataDiscards = new Set();
let refreshVersion = 0;

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

function captureRevision(capture) { return Number.isSafeInteger(capture.revision) && capture.revision > 0 ? capture.revision : 1; }
function importConfirmed(capture) { return capture.delivery?.status === 'confirmed' && capture.delivery.revision === captureRevision(capture); }
function captureRefs(captures) { return captures.map(capture => ({ id: capture.id, revision: captureRevision(capture) })); }
async function captureCommand(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (response?.success !== true) throw new Error(response?.error || t('captureChangeFailed'));
  return response;
}

// ---- Modal ----

const showModal = confirmation({
  overlay: modalOverlay, title: modalTitle, message: modalMessage,
  cancel: modalCancel, confirm: modalConfirm, fallback: refreshBtn,
});

// ---- Toast ----

function showToast(message, isError) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast' + (isError ? ' error' : '');
  toast.setAttribute('role', isError ? 'alert' : 'status');
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 3000);
}

// ---- Helpers ----

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML.replaceAll('"', '&quot;').replaceAll("'", '&#39;');
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
    status.textContent = approval?.localLLMOrigin ? t('localAISavedOrigin', [approval.localLLMOrigin])
      : t(approval ? 'localAINone' : 'localAIApproveFirst');
  } catch (error) { if (read === localApprovalRead) status.textContent = t('localAIReadFailed', [error.message]); }
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
      if (!['http:', 'https:'].includes(local.protocol) || local.username || local.password) throw new Error(t('invalidLocalAI'));
      if (!await requestHostPermission(localLLMUrl)) throw new Error(t('localAIPermissionDenied'));
    }
    const response = await chrome.runtime.sendMessage({ type: 'UPDATE_LOCAL_LLM_APPROVAL', targetUrl, localLLMUrl });
    if (!response?.success) throw new Error(response?.error || t('localAIApprovalFailed'));
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
    showToast(t('invalidTargetUrlDetail'), true);
    return;
  }

  // Request host permission for non-default URLs so dynamic bridge registration works
  {
    try {
      const granted = await requestHostPermission(targetUrl);
      if (!granted) {
        showToast(t('targetPermissionDenied'), true);
        return;
      }
    } catch (error) { showToast(error.message || t('permissionRequestFailed'), true); return; }
  }

  const approved = await chrome.runtime.sendMessage({ type: 'APPROVE_APP', targetUrl });
  if (!approved?.success) { showToast(approved?.error || t('appApprovalFailed'), true); return; }
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
  const focused = document.activeElement?.closest?.('.meta-inline-edit');
  const focusToRestore = focused ? { id: focused.dataset.id, field: document.activeElement.dataset.field } : null;
  if (captures.length === 0) {
    capturesList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">&#128203;</div>
        <p>${escapeHtml(t('noCapturesTitle'))}</p>
        <p style="font-size: 13px;">${escapeHtml(t('howToUseContextMenu'))}</p>
      </div>
    `;
    return;
  }

  // Newest first
  const sorted = [...captures].sort((a, b) => b.createdAt - a.createdAt);

  const entityLabels = { 'note': t('entityNote'), 'task': t('entityTask'), 'timeline-event': t('entityTimelineEvent') };

  capturesList.innerHTML = sorted.map(capture => {
    const sentClass = importConfirmed(capture) ? ' sent' : '';
    const label = importConfirmed(capture)
      ? t('importConfirmed') : capture.sent ? t('legacySent') : capture.delivery?.status === 'pending'
        ? t('importPending') : capture.delivery?.status === 'failed' ? t('importFailedRetained') : '';
    const sentBadge = label ? `<span class="sent-badge">${escapeHtml(label)}</span>` : '';
    const sourceLink = capture.sourceUrl && isSafeUrl(capture.sourceUrl)
      ? `<a class="capture-source" href="${escapeHtml(capture.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(capture.sourceUrl)}</a>`
      : capture.sourceUrl
        ? `<span class="capture-source">${escapeHtml(capture.sourceUrl)}</span>`
        : `<span class="capture-source" style="color: #6b7280;">${escapeHtml(t('noSourceUrl'))}</span>`;
    const sourceTitle = capture.sourceTitle
      ? `<div class="capture-source-title">${escapeHtml(capture.sourceTitle)}</div>`
      : '';

    const eType = capture.entityType || 'note';
    const fName = capture.folderName || '';
    const cls = capture.clsLevel || '';
    const draft = metadataDrafts.get(capture.id);
    const editType = draft?.values.entityType ?? eType;
    const editFolder = draft?.values.folderName ?? fName;
    const editCls = draft?.values.clsLevel ?? cls;
    const typeBadge = `<button type="button" class="meta-badge type-${escapeHtml(eType)}" data-id="${escapeHtml(capture.id)}" aria-label="${escapeHtml(t('editCaptureMetadata'))}" aria-expanded="${draft?.open === true}">${escapeHtml(entityLabels[eType] || t('entityNote'))}</button>`;
    const folderBadge = fName ? `<span class="meta-badge folder-badge">${escapeHtml(fName)}</span>` : '';
    const clsBadge = cls ? `<span class="meta-badge cls-badge">${escapeHtml(cls)}</span>` : '';

    return `
      <div class="capture-card${sentClass}" data-id="${escapeHtml(capture.id)}">
        <div class="capture-card-header">
          <div class="capture-meta">
            ${sourceTitle}
            <span class="capture-date">${formatDate(capture.createdAt)}${sentBadge}</span>
            ${sourceLink}
          </div>
          <button class="capture-delete-btn" data-id="${escapeHtml(capture.id)}">${escapeHtml(t('delete'))}</button>
        </div>
        <div class="capture-content">${escapeHtml(capture.content)}</div>
        <div class="capture-metadata">${typeBadge}${folderBadge}${clsBadge}</div>
        <div class="meta-inline-edit${draft?.open ? ' show' : ''}" data-id="${escapeHtml(capture.id)}" data-revision="${draft?.revision ?? captureRevision(capture)}" aria-busy="${pendingMetadataWrites.has(capture.id)}">
          <select data-field="entityType" aria-label="${escapeHtml(t('saveAs'))}">
            <option value="note"${editType === 'note' ? ' selected' : ''}>${escapeHtml(t('entityNote'))}</option>
            <option value="task"${editType === 'task' ? ' selected' : ''}>${escapeHtml(t('entityTask'))}</option>
            <option value="timeline-event"${editType === 'timeline-event' ? ' selected' : ''}>${escapeHtml(t('entityTimelineEvent'))}</option>
          </select>
          <input type="text" data-field="folderName" value="${escapeHtml(editFolder)}" aria-label="${escapeHtml(t('investigation'))}" placeholder="${escapeHtml(t('folder'))}" style="width:100px;" />
          <select data-field="clsLevel" aria-label="${escapeHtml(t('classification'))}">
            <option value=""${!editCls ? ' selected' : ''}>${escapeHtml(t('classificationNone'))}</option>
            <option value="TLP:CLEAR"${editCls === 'TLP:CLEAR' ? ' selected' : ''}>TLP:CLEAR</option>
            <option value="TLP:GREEN"${editCls === 'TLP:GREEN' ? ' selected' : ''}>TLP:GREEN</option>
            <option value="TLP:AMBER"${editCls === 'TLP:AMBER' ? ' selected' : ''}>TLP:AMBER</option>
            <option value="TLP:AMBER+STRICT"${editCls === 'TLP:AMBER+STRICT' ? ' selected' : ''}>TLP:AMBER+STRICT</option>
            <option value="TLP:RED"${editCls === 'TLP:RED' ? ' selected' : ''}>TLP:RED</option>
          </select>
          <button type="button" class="btn btn-secondary discard-metadata-draft"${draft ? '' : ' hidden'}${pendingMetadataWrites.has(capture.id) ? ' disabled' : ''}>${escapeHtml(t('discardMetadataDraft'))}</button>
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
        t('deleteCaptureTitle'),
        t('deleteCaptureQuestion'),
        t('delete'),
        true
      );
      if (confirmed) {
        try {
          await deleteCapture(captureRefs(captures.filter(capture => capture.id === id)));
          metadataDrafts.delete(id);
          await refresh();
          refreshBtn.focus();
          showToast(t('captureDeleted'));
        } catch (error) { showToast(error.message, true); await refresh(); }
      }
    });
  });

  // Wire up metadata badge clicks to toggle inline edit
  capturesList.querySelectorAll('button.meta-badge').forEach(badge => {
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      const editRow = badge.closest('.capture-card').querySelector('.meta-inline-edit');
      if (editRow) {
        const open = editRow.classList.toggle('show');
        badge.setAttribute('aria-expanded', String(open));
        const draft = metadataDrafts.get(editRow.dataset.id);
        if (draft) draft.open = open;
        if (open) editRow.querySelector('select').focus();
      }
    });
  });

  capturesList.querySelectorAll('.discard-metadata-draft').forEach(button => {
    // A pointer on Discard must not blur-save the input before the confirmation.
    button.addEventListener('pointerdown', event => event.preventDefault());
    button.addEventListener('click', async () => {
      const id = button.closest('.meta-inline-edit').dataset.id;
      if (pendingMetadataWrites.has(id) || pendingMetadataDiscards.has(id) || !metadataDrafts.has(id)) return;
      pendingMetadataDiscards.add(id);
      try {
        const confirmed = await showModal(t('discardMetadataDraft'), t('discardMetadataMessage'), t('discardMetadataDraft'), true);
        if (confirmed) {
          // Load first: a failed storage read must not discard the local draft.
          await refresh(id);
          const row = [...capturesList.querySelectorAll('.meta-inline-edit')].find(item => item.dataset.id === id);
          (row?.closest('.capture-card').querySelector('button.meta-badge') || refreshBtn).focus();
        }
      } finally { pendingMetadataDiscards.delete(id); }
    });
  });

  // Wire up inline edit changes
  capturesList.querySelectorAll('.meta-inline-edit select, .meta-inline-edit input').forEach(el => {
    const remember = () => {
      const row = el.closest('.meta-inline-edit');
      const draft = metadataDrafts.get(row.dataset.id) || { revision: Number(row.dataset.revision), values: {}, open: true };
      draft.values[el.dataset.field] = el.value;
      metadataDrafts.set(row.dataset.id, draft);
      row.querySelector('.discard-metadata-draft').hidden = false;
      return draft;
    };
    el.addEventListener('input', remember);
    const eventType = el.tagName === 'SELECT' ? 'change' : 'blur';
    el.addEventListener(eventType, async () => {
      const editRow = el.closest('.meta-inline-edit');
      const id = editRow.dataset.id;
      if (pendingMetadataDiscards.has(id)) return;
      const field = el.dataset.field;
      const draft = remember();
      if (pendingMetadataWrites.has(id)) return; // Keep newer edits for their next explicit save gesture.
      const value = el.value;
      const revision = draft.revision;
      const original = captures.find(capture => capture.id === id);
      const changed = (original?.[field] || '') !== value;
      pendingMetadataWrites.add(id);
      editRow.querySelector('.discard-metadata-draft').disabled = true;
      editRow.setAttribute('aria-busy', 'true');
      try {
        await updateCaptureField(id, revision, field, value);
        const latest = metadataDrafts.get(id);
        if (latest) {
          if (latest.values[field] === value) delete latest.values[field];
          latest.revision = revision + (changed ? 1 : 0);
          if (Object.keys(latest.values).length === 0) metadataDrafts.delete(id);
        }
        await refresh();
        showToast(t('metadataSaved'));
      } catch (error) { showToast(error.message, true); }
      finally {
        pendingMetadataWrites.delete(id);
        const currentRow = [...capturesList.querySelectorAll('.meta-inline-edit')].find(row => row.dataset.id === id);
        currentRow?.setAttribute('aria-busy', 'false');
        const discard = currentRow?.querySelector('.discard-metadata-draft');
        if (discard) discard.disabled = false;
      }
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
  if (focusToRestore) {
    const row = [...capturesList.querySelectorAll('.meta-inline-edit')].find(row => row.dataset.id === focusToRestore.id);
    if (row?.classList.contains('show')) [...row.querySelectorAll('[data-field]')].find(element => element.dataset.field === focusToRestore.field)?.focus();
    else row?.closest('.capture-card').querySelector('button.meta-badge')?.focus();
  }
}

async function refresh(discardDraftId) {
  const version = ++refreshVersion;
  try {
    const captures = await loadCaptures();
    if (version !== refreshVersion) return;
    if (typeof discardDraftId === 'string') metadataDrafts.delete(discardDraftId);
    renderStats(captures);
    renderCaptures(captures);
  } catch { showToast(t('capturesLoadFailed'), true); }
}

// ---- Actions ----

async function deleteCapture(clips) {
  await captureCommand({ type: 'DELETE_CAPTURES', clips });
}

async function clearAll(captures) {
  await deleteCapture(captureRefs(captures));
  captures.forEach(capture => metadataDrafts.delete(capture.id));
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
  sendAllBtn.textContent = t('preparingDestination');
  try {
  const captures = await loadCaptures();
  const unsent = captures.filter(c => !importConfirmed(c));

  if (unsent.length === 0) {
    showToast(t('noUnsentCaptures'));
    return;
  }

  let targetUrl = await getTargetUrl();

  // If no target URL configured, prompt user
  if (!targetUrl) {
    const currentVal = targetUrlInput.value.trim();
    if (!currentVal) {
      targetUrlInput.focus();
      showToast(t('configureTargetFirst'), true);
      return;
    }
    targetUrl = currentVal;
  }

  if (!isSafeUrl(targetUrl)) {
    showToast(t('invalidTargetUrlDetail'), true);
    return;
  }

  // For file:// targets, check that the extension has file URL access before proceeding
  if (targetUrl.startsWith('file://')) {
    const hasFileAccess = await new Promise(resolve =>
      chrome.extension.isAllowedFileSchemeAccess(resolve)
    );
    if (!hasFileAccess) {
      showToast(
        t('fileAccessDisabled'),
        true
      );
      return;
    }
  }

    // Sending does not request new permission. Pairing remains an explicit Save
    // Target action; a revoked or unavailable destination fails closed.
    const prepared = await captureCommand({ type: 'PREPARE_CLIP_DELIVERY', targetUrl });
    const legacyCount = unsent.filter(capture => capture.sent).length;
    const confirmed = await showModal(t('confirmWorkspace'),
      t('importWorkspaceMessage', [unsent.length, prepared.workspaceLabel, prepared.workspaceId, targetUrl])
        + (legacyCount ? ' ' + t('legacyImportWarning', [legacyCount]) : ''), t('importCaptures'), false);
    if (!confirmed) return;
    sendAllBtn.textContent = t('waitingForImport');
    const response = await chrome.runtime.sendMessage({
      type: 'SEND_TO_TARGET',
      sessionId: prepared.sessionId,
      clips: captureRefs(unsent)
    });
    await refresh();
    if (response?.success === true) {
      showToast(t('importsConfirmed', [response.confirmed]));
    } else {
      showToast(t('importsPartial', [response?.confirmed || 0, unsent.length, response?.error || t('unconfirmedRetained')]), true);
    }
  } catch (error) {
    showToast(t('sendFailed', [error.message]), true);
  } finally {
    sendAllBtn.disabled = false;
    sendAllBtn.textContent = t('sendAll');
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
    showToast(t('defaultsApplied'));
  } catch (error) { showToast(error.message, true); await refresh(); }
});

// ---- Event Listeners ----

sendAllBtn.addEventListener('click', sendAllToTarget);

refreshBtn.addEventListener('click', refresh);

clearAllBtn.addEventListener('click', async () => {
  const captures = await loadCaptures();
  if (captures.length === 0) return;

  const confirmed = await showModal(
    t('clearAllCaptures'),
    t('clearAllQuestion', [captures.length]),
    t('clearAll'),
    true
  );

  if (confirmed) {
    try {
      await clearAll(captures);
      await refresh();
      showToast(t('capturesCleared'));
    } catch (error) { showToast(error.message, true); await refresh(); }
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.captures && !capturesList.contains(document.activeElement)) void refresh();
});

// ---- Init ----

loadSettings();
refresh();
