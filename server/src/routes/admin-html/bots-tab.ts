export function botsTabJs(): string {
  return `/* ═══ BOTS TAB ═══════════════════════════════════════════════ */

var allBots = [];

function loadBotsData() {
  return api('/bots').then(function(data) {
    allBots = data.bots;
    renderBots();
  }).catch(function(err) { toast(err.message, 'error'); });
}

function botTypeBadge(type) {
  return '<span class="bot-type-badge bot-type-' + esc(type) + '">' + esc(type) + '</span>';
}

function runStatusBadge(status) {
  return '<span class="run-status-' + esc(status) + '">' + esc(status) + '</span>';
}

function getFilteredBots() {
  var search = document.getElementById('botSearch').value.toLowerCase();
  var typeFilter = document.getElementById('botTypeFilter').value;
  var statusFilter = document.getElementById('botStatusFilter').value;

  return allBots.filter(function(b) {
    if (search && b.name.toLowerCase().indexOf(search) === -1 && (b.description || '').toLowerCase().indexOf(search) === -1) return false;
    if (typeFilter && b.type !== typeFilter) return false;
    if (statusFilter === 'enabled' && !b.enabled) return false;
    if (statusFilter === 'disabled' && b.enabled) return false;
    return true;
  });
}

function renderBots() {
  var filtered = getFilteredBots();
  var tbody = document.getElementById('botsBody');
  tbody.innerHTML = filtered.map(function(b) {
    var lastRun = b.lastRunAt ? fmtDate(b.lastRunAt) : 'Never';
    var statusBadge = b.enabled
      ? '<span class="badge badge-green">enabled</span>'
      : '<span class="badge badge-gray">disabled</span>';
    var scopeLabel = b.scopeType === 'global' ? 'Global' : (b.scopeFolderIds && b.scopeFolderIds.length > 0 ? b.scopeFolderIds.length + ' inv.' : 'None');
    return '<tr>' +
      '<td><a data-action="bot-detail" data-id="' + esc(b.id) + '">' + esc(b.name) + '</a></td>' +
      '<td>' + botTypeBadge(b.type) + '</td>' +
      '<td>' + statusBadge + '</td>' +
      '<td>' + esc(scopeLabel) + '</td>' +
      '<td>' + (b.runCount || 0) + '</td>' +
      '<td>' + (b.errorCount || 0) + '</td>' +
      '<td style="white-space:nowrap;">' + lastRun + '</td>' +
      '<td style="white-space:nowrap;">' +
        (b.enabled
          ? '<button class="btn btn-outline btn-sm" data-action="disable-bot" data-id="' + esc(b.id) + '" data-name="' + esc(b.name) + '">Disable</button> '
          : '<button class="btn btn-primary btn-sm" data-action="enable-bot" data-id="' + esc(b.id) + '" data-name="' + esc(b.name) + '">Enable</button> ') +
        (b.enabled ? '<button class="btn btn-outline btn-sm" data-action="trigger-bot" data-id="' + esc(b.id) + '" data-name="' + esc(b.name) + '">Trigger</button> ' : '') +
        '<button class="btn btn-danger btn-sm" data-action="delete-bot" data-id="' + esc(b.id) + '" data-name="' + esc(b.name) + '">Delete</button>' +
      '</td>' +
      '</tr>';
  }).join('');
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="color:#8b949e;font-style:italic;">No bots found</td></tr>';
  }
}

// Filter listeners
document.getElementById('botSearch').addEventListener('input', function() { renderBots(); });
document.getElementById('botTypeFilter').addEventListener('change', function() { renderBots(); });
document.getElementById('botStatusFilter').addEventListener('change', function() { renderBots(); });

// Table action delegation
document.getElementById('botsBody').addEventListener('click', function(e) {
  var enableBtn = e.target.closest('[data-action="enable-bot"]');
  if (enableBtn) {
    api('/bots/' + enableBtn.dataset.id + '/enable', { method: 'POST' })
      .then(function() { toast('Bot enabled'); loadBotsData(); })
      .catch(function(err) { toast(err.message, 'error'); });
    return;
  }

  var disableBtn = e.target.closest('[data-action="disable-bot"]');
  if (disableBtn) {
    api('/bots/' + disableBtn.dataset.id + '/disable', { method: 'POST' })
      .then(function() { toast('Bot disabled'); loadBotsData(); })
      .catch(function(err) { toast(err.message, 'error'); });
    return;
  }

  var triggerBtn = e.target.closest('[data-action="trigger-bot"]');
  if (triggerBtn) {
    api('/bots/' + triggerBtn.dataset.id + '/trigger', { method: 'POST' })
      .then(function() { toast('Bot triggered'); })
      .catch(function(err) { toast(err.message, 'error'); });
    return;
  }

  var deleteBtn = e.target.closest('[data-action="delete-bot"]');
  if (deleteBtn) {
    if (!confirm('Delete bot "' + deleteBtn.dataset.name + '"? This cannot be undone.')) return;
    api('/bots/' + deleteBtn.dataset.id, { method: 'DELETE' })
      .then(function() { toast('Bot deleted'); loadBotsData(); closeDetailPanel(); })
      .catch(function(err) { toast(err.message, 'error'); });
    return;
  }

  var detailLink = e.target.closest('[data-action="bot-detail"]');
  if (detailLink) {
    openBotDetail(detailLink.dataset.id);
    return;
  }
});

// ─── Bot Detail Panel ────────────────────────────────────────

function openBotDetail(botId) {
  api('/bots/' + botId).then(function(data) {
    var b = data.bot;
    var runs = data.recentRuns || [];
    var html = '<h3>' + esc(b.name) + '</h3>';

    // Info grid
    html += '<div class="info-grid">';
    html += '<span class="lbl">Type</span><span class="val">' + botTypeBadge(b.type) + '</span>';
    html += '<span class="lbl">Status</span><span class="val">' + (b.enabled ? '<span class="badge badge-green">enabled</span>' : '<span class="badge badge-gray">disabled</span>') + '</span>';
    html += '<span class="lbl">Scope</span><span class="val">' + esc(b.scopeType) + '</span>';
    html += '<span class="lbl">Rate Limit</span><span class="val">' + b.rateLimitPerHour + '/hr, ' + b.rateLimitPerDay + '/day</span>';
    html += '<span class="lbl">Runs</span><span class="val">' + (b.runCount || 0) + '</span>';
    html += '<span class="lbl">Errors</span><span class="val">' + (b.errorCount || 0) + '</span>';
    html += '<span class="lbl">Last Run</span><span class="val">' + fmtDate(b.lastRunAt) + '</span>';
    html += '<span class="lbl">Created</span><span class="val">' + fmtDate(b.createdAt) + '</span>';
    if (b.creatorName) html += '<span class="lbl">Created By</span><span class="val">' + esc(b.creatorName) + '</span>';
    html += '</div>';

    // Description
    if (b.description) {
      html += '<div class="section"><h4>Description</h4><p style="color:#c9d1d9;font-size:0.85rem;">' + esc(b.description) + '</p></div>';
    }

    // Last Error
    if (b.lastError) {
      html += '<div class="section"><h4>Last Error</h4><p style="color:#f85149;font-size:0.85rem;background:#1c2128;padding:0.5rem;border-radius:4px;font-family:monospace;word-break:break-all;">' + esc(b.lastError) + '</p></div>';
    }

    // Capabilities
    html += '<div class="section"><h4>Capabilities</h4>';
    var caps = b.capabilities || [];
    if (caps.length > 0) {
      html += caps.map(function(c) { return '<span class="cap-tag">' + esc(c) + '</span>'; }).join(' ');
    } else {
      html += '<p style="color:#8b949e;font-size:0.85rem;">No capabilities assigned</p>';
    }
    html += '</div>';

    // AI Agent Config (show provider, model, prompt if type is ai-agent)
    if (b.type === 'ai-agent') {
      var agentCfg = b.config || {};
      html += '<div class="section"><h4>Agent Configuration</h4><div class="info-grid">';
      html += '<span class="lbl">LLM Provider</span><span class="val">' + esc(agentCfg.llmProvider || 'anthropic') + '</span>';
      html += '<span class="lbl">Model</span><span class="val">' + esc(agentCfg.llmModel || 'default') + '</span>';
      html += '<span class="lbl">Max Iterations</span><span class="val">' + (agentCfg.maxIterations || 10) + '</span>';
      html += '</div>';
      if (agentCfg.systemPrompt) {
        html += '<p style="color:#8b949e;font-size:0.8rem;margin-top:0.5rem;white-space:pre-wrap;background:#1c2128;padding:0.5rem;border-radius:4px;">' + esc(agentCfg.systemPrompt) + '</p>';
      }
      html += '</div>';
    }

    // Triggers
    html += '<div class="section"><h4>Triggers</h4><div class="info-grid">';
    var triggers = b.triggers || {};
    if (triggers.events && triggers.events.length > 0) {
      html += '<span class="lbl">Events</span><span class="val">' + triggers.events.map(function(ev) { return '<span class="cap-tag">' + esc(ev) + '</span>'; }).join(' ') + '</span>';
    }
    if (triggers.schedule) {
      html += '<span class="lbl">Schedule</span><span class="val">' + esc(triggers.schedule) + '</span>';
    }
    html += '<span class="lbl">Webhook</span><span class="val">' + (triggers.webhook ? 'Yes' : 'No') + '</span>';
    html += '</div></div>';

    // Allowed Domains
    if (b.allowedDomains && b.allowedDomains.length > 0) {
      html += '<div class="section"><h4>Allowed Domains</h4>';
      html += b.allowedDomains.map(function(d) { return '<span class="cap-tag">' + esc(d) + '</span>'; }).join(' ');
      html += '</div>';
    }

    // Investigation Memberships
    var memberships = data.memberships || [];
    if (memberships.length > 0) {
      html += '<div class="section"><h4>Investigation Access (' + memberships.length + ')</h4>';
      html += memberships.map(function(m) {
        return '<span class="cap-tag">' + esc(m.folderName || m.folderId) + ' (' + esc(m.role) + ')</span>';
      }).join(' ');
      html += '</div>';
    }

    // Recent Runs
    html += '<div class="section"><h4>Recent Runs (' + runs.length + ')</h4>';
    if (runs.length > 0) {
      html += '<table><thead><tr><th>Time</th><th>Trigger</th><th>Status</th><th>Duration</th><th>Created</th><th>Updated</th><th>API</th></tr></thead><tbody>';
      runs.forEach(function(r) {
        html += '<tr style="cursor:pointer;" onclick="openRunDetail(\\'' + esc(b.id) + '\\',\\'' + esc(r.id) + '\\')">' +
          '<td style="white-space:nowrap;">' + fmtDate(r.createdAt) + '</td>' +
          '<td>' + esc(r.trigger) + '</td>' +
          '<td>' + runStatusBadge(r.status) + '</td>' +
          '<td>' + (r.durationMs > 0 ? (r.durationMs / 1000).toFixed(1) + 's' : '-') + '</td>' +
          '<td>' + (r.entitiesCreated || 0) + '</td>' +
          '<td>' + (r.entitiesUpdated || 0) + '</td>' +
          '<td>' + (r.apiCallsMade || 0) + '</td>' +
          '</tr>';
        if (r.error) {
          html += '<tr><td colspan="7" style="color:#f85149;font-size:0.8rem;font-family:monospace;padding-left:1.5rem;">' + esc(r.error) + '</td></tr>';
        }
      });
      html += '</tbody></table>';
    } else {
      html += '<p style="color:#8b949e;font-size:0.85rem;">No runs yet</p>';
    }
    html += '</div>';

    // Actions
    html += '<div style="display:flex;gap:0.5rem;margin-top:1rem;">';
    if (b.enabled) {
      html += '<button class="btn btn-outline btn-sm" onclick="toggleBotFromDetail(\\'' + esc(b.id) + '\\', false)">Disable</button>';
      html += '<button class="btn btn-primary btn-sm" onclick="triggerBotFromDetail(\\'' + esc(b.id) + '\\')">Trigger Now</button>';
    } else {
      html += '<button class="btn btn-primary btn-sm" onclick="toggleBotFromDetail(\\'' + esc(b.id) + '\\', true)">Enable</button>';
    }
    html += '<button class="btn btn-outline btn-sm" onclick="editBotFromDetail(\\'' + esc(b.id) + '\\')">Edit</button>';
    html += '<button class="btn btn-danger btn-sm" onclick="deleteBotFromDetail(\\'' + esc(b.id) + '\\', \\'' + esc(b.name) + '\\')">Delete</button>';
    html += '</div>';

    document.getElementById('detailContent').innerHTML = html;
    openDetailPanel();
  }).catch(function(err) { toast(err.message, 'error'); });
}

function toggleBotFromDetail(botId, enable) {
  var endpoint = enable ? '/enable' : '/disable';
  api('/bots/' + botId + endpoint, { method: 'POST' })
    .then(function() { toast(enable ? 'Bot enabled' : 'Bot disabled'); loadBotsData(); openBotDetail(botId); })
    .catch(function(err) { toast(err.message, 'error'); });
}

function triggerBotFromDetail(botId) {
  api('/bots/' + botId + '/trigger', { method: 'POST' })
    .then(function() { toast('Bot triggered'); setTimeout(function() { openBotDetail(botId); }, 1500); })
    .catch(function(err) { toast(err.message, 'error'); });
}

function deleteBotFromDetail(botId, botName) {
  if (!confirm('Delete bot "' + botName + '"? This cannot be undone.')) return;
  api('/bots/' + botId, { method: 'DELETE' })
    .then(function() { toast('Bot deleted'); loadBotsData(); closeDetailPanel(); })
    .catch(function(err) { toast(err.message, 'error'); });
}

// ─── Create Bot Modal ──────────────────────────────────────

var editingBotId = null;

// Type toggle — show/hide AI agent fields
function updateBotTypeUI() {
  var isAgent = document.getElementById('newBotType').value === 'ai-agent';
  document.getElementById('aiAgentConfigGroup').style.display = isAgent ? '' : 'none';
}
document.getElementById('newBotType').addEventListener('change', function() { updateBotTypeUI(); });

// Scope type toggle — show/hide investigation picker
function updateScopeUI() {
  var scopeType = document.getElementById('newBotScope').value;
  var group = document.getElementById('scopeFolderIdsGroup');
  if (scopeType === 'investigation') {
    group.style.display = '';
    populateInvestigationPicker();
  } else {
    group.style.display = 'none';
  }
}

function populateInvestigationPicker(selectedIds) {
  selectedIds = selectedIds || [];
  var container = document.getElementById('scopeFolderIdsList');
  if (allInvestigations.length === 0) {
    container.innerHTML = '<span style="color:#8b949e;font-size:0.8rem;">No investigations available</span>';
    return;
  }
  container.innerHTML = allInvestigations.map(function(inv) {
    var checked = selectedIds.indexOf(inv.id) !== -1 ? ' checked' : '';
    return '<label><input type="checkbox" class="bot-scope-inv-check" value="' + esc(inv.id) + '"' + checked + '> ' + esc(inv.name) + '</label>';
  }).join('');
}

document.getElementById('newBotScope').addEventListener('change', function() { updateScopeUI(); });

// Event filter toggle — show/hide when events are checked
function updateEventFilterUI() {
  var hasEvents = false;
  document.querySelectorAll('.bot-event-check').forEach(function(cb) {
    if (cb.checked) hasEvents = true;
  });
  document.getElementById('eventFilterGroup').style.display = hasEvents ? '' : 'none';
}

document.querySelectorAll('.bot-event-check').forEach(function(cb) {
  cb.addEventListener('change', function() { updateEventFilterUI(); });
});

function editBotFromDetail(botId) {
  var b = allBots.find(function(bot) { return bot.id === botId; });
  if (!b) { toast('Bot not found', 'error'); return; }

  editingBotId = botId;

  // Pre-fill the create modal
  document.getElementById('newBotName').value = b.name || '';
  document.getElementById('newBotDesc').value = b.description || '';
  document.getElementById('newBotType').value = b.type || 'custom';

  // Capabilities
  document.querySelectorAll('.bot-cap-check').forEach(function(cb) {
    cb.checked = (b.capabilities || []).indexOf(cb.value) !== -1;
  });

  // AI Agent fields (extract from config before showing raw JSON)
  var cfg = b.config && typeof b.config === 'object' ? Object.assign({}, b.config) : {};
  if (b.type === 'ai-agent') {
    document.getElementById('newBotLlmProvider').value = cfg.llmProvider || 'anthropic';
    document.getElementById('newBotLlmModel').value = cfg.llmModel || '';
    document.getElementById('newBotSystemPrompt').value = cfg.systemPrompt || '';
    document.getElementById('newBotMaxIter').value = cfg.maxIterations || 10;
  } else {
    document.getElementById('newBotLlmProvider').value = 'anthropic';
    document.getElementById('newBotLlmModel').value = '';
    document.getElementById('newBotSystemPrompt').value = '';
    document.getElementById('newBotMaxIter').value = '10';
  }
  updateBotTypeUI();

  // Config JSON — strip agent fields from raw display
  var displayCfg = Object.assign({}, cfg);
  delete displayCfg.llmProvider; delete displayCfg.llmModel;
  delete displayCfg.systemPrompt; delete displayCfg.maxIterations;
  var configVal = Object.keys(displayCfg).length > 0
    ? JSON.stringify(displayCfg, null, 2) : '';
  document.getElementById('newBotConfig').value = configVal;
  document.getElementById('botConfigSecretNote').style.display = configVal ? '' : 'none';

  // Scope
  document.getElementById('newBotScope').value = b.scopeType || 'investigation';
  updateScopeUI();
  // Pre-select scope folder IDs after picker is populated
  if (b.scopeType === 'investigation') {
    populateInvestigationPicker(b.scopeFolderIds || []);
  }

  // Domains
  document.getElementById('newBotDomains').value = (b.allowedDomains || []).join(', ');

  // Rate limits
  document.getElementById('newBotRateHour').value = b.rateLimitPerHour || 100;
  document.getElementById('newBotRateDay').value = b.rateLimitPerDay || 1000;

  // Triggers
  var triggers = b.triggers || {};
  document.querySelectorAll('.bot-event-check').forEach(function(cb) {
    cb.checked = (triggers.events || []).indexOf(cb.value) !== -1;
  });
  document.getElementById('newBotSchedule').value = triggers.schedule || '';
  document.getElementById('newBotWebhook').checked = !!triggers.webhook;

  // Event table filter
  var eventFilters = triggers.eventFilters || {};
  document.getElementById('newBotEventTables').value = (eventFilters.tables || []).join(', ');
  updateEventFilterUI();

  // Change modal title and button
  document.querySelector('#createBotModal .modal h3').textContent = 'Edit Bot';
  document.getElementById('submitCreateBot').textContent = 'Save Changes';

  document.getElementById('createBotModal').classList.add('active');
}

document.getElementById('createBotBtn').addEventListener('click', function() {
  editingBotId = null;
  document.querySelector('#createBotModal .modal h3').textContent = 'Create Bot';
  document.getElementById('submitCreateBot').textContent = 'Create Bot';
  document.getElementById('newBotName').value = '';
  document.getElementById('newBotDesc').value = '';
  document.getElementById('newBotType').value = 'enrichment';
  document.querySelectorAll('.bot-cap-check').forEach(function(cb) { cb.checked = false; });
  document.getElementById('newBotConfig').value = '';
  document.getElementById('botConfigSecretNote').style.display = 'none';
  // Reset AI agent fields
  document.getElementById('newBotLlmProvider').value = 'anthropic';
  document.getElementById('newBotLlmModel').value = '';
  document.getElementById('newBotSystemPrompt').value = '';
  document.getElementById('newBotMaxIter').value = '10';
  updateBotTypeUI();
  document.getElementById('newBotScope').value = 'investigation';
  updateScopeUI();
  document.getElementById('newBotDomains').value = '';
  document.getElementById('newBotRateHour').value = '100';
  document.getElementById('newBotRateDay').value = '1000';
  // Trigger config
  document.getElementById('newBotSchedule').value = '';
  document.getElementById('newBotWebhook').checked = false;
  document.querySelectorAll('.bot-event-check').forEach(function(cb) { cb.checked = false; });
  document.getElementById('newBotEventTables').value = '';
  updateEventFilterUI();
  document.getElementById('createBotModal').classList.add('active');
});

document.getElementById('cancelCreateBot').addEventListener('click', function() {
  editingBotId = null;
  document.querySelector('#createBotModal .modal h3').textContent = 'Create Bot';
  document.getElementById('submitCreateBot').textContent = 'Create Bot';
  document.getElementById('createBotModal').classList.remove('active');
});

document.getElementById('submitCreateBot').addEventListener('click', function() {
  var name = document.getElementById('newBotName').value.trim();
  var description = document.getElementById('newBotDesc').value.trim();
  var type = document.getElementById('newBotType').value;
  if (!name) { toast('Bot name is required', 'error'); return; }

  var capabilities = [];
  document.querySelectorAll('.bot-cap-check:checked').forEach(function(cb) { capabilities.push(cb.value); });

  // Parse config JSON
  var configStr = document.getElementById('newBotConfig').value.trim();
  var config = undefined;
  if (configStr) {
    try {
      config = JSON.parse(configStr);
    } catch (e) {
      toast('Invalid JSON in Bot Config: ' + e.message, 'error');
      return;
    }
  }

  var events = [];
  document.querySelectorAll('.bot-event-check:checked').forEach(function(cb) { events.push(cb.value); });

  var triggers = {};
  if (events.length > 0) triggers.events = events;
  var schedule = document.getElementById('newBotSchedule').value.trim();
  if (schedule) triggers.schedule = schedule;
  if (document.getElementById('newBotWebhook').checked) triggers.webhook = true;

  // Event table filter
  if (events.length > 0) {
    var tablesStr = document.getElementById('newBotEventTables').value.trim();
    if (tablesStr) {
      var tables = tablesStr.split(',').map(function(t) { return t.trim(); }).filter(Boolean);
      if (tables.length > 0) {
        triggers.eventFilters = triggers.eventFilters || {};
        triggers.eventFilters.tables = tables;
      }
    }
  }

  var domains = document.getElementById('newBotDomains').value.trim();
  var allowedDomains = domains ? domains.split(',').map(function(d) { return d.trim(); }).filter(Boolean) : [];

  // Scope folder IDs
  var scopeType = document.getElementById('newBotScope').value;
  var scopeFolderIds = [];
  if (scopeType === 'investigation') {
    document.querySelectorAll('.bot-scope-inv-check:checked').forEach(function(cb) { scopeFolderIds.push(cb.value); });
  }

  var body = {
    name: name,
    description: description,
    type: type,
    capabilities: capabilities,
    triggers: triggers,
    allowedDomains: allowedDomains,
    scopeType: scopeType,
    scopeFolderIds: scopeFolderIds,
    rateLimitPerHour: parseInt(document.getElementById('newBotRateHour').value, 10) || 100,
    rateLimitPerDay: parseInt(document.getElementById('newBotRateDay').value, 10) || 1000,
  };

  // Merge AI agent fields into config
  if (type === 'ai-agent') {
    config = config || {};
    var provider = document.getElementById('newBotLlmProvider').value;
    var model = document.getElementById('newBotLlmModel').value.trim();
    var sysPrompt = document.getElementById('newBotSystemPrompt').value.trim();
    var maxIter = parseInt(document.getElementById('newBotMaxIter').value, 10) || 10;
    if (provider) config.llmProvider = provider;
    if (model) config.llmModel = model;
    if (sysPrompt) config.systemPrompt = sysPrompt;
    config.maxIterations = Math.min(Math.max(maxIter, 1), 25);
  }

  if (config !== undefined) {
    body.config = config;
  }

  if (editingBotId) {
    api('/bots/' + editingBotId, { method: 'PATCH', body: JSON.stringify(body) })
      .then(function() {
        toast('Bot updated');
        document.getElementById('createBotModal').classList.remove('active');
        var updatedId = editingBotId;
        editingBotId = null;
        loadBotsData();
        openBotDetail(updatedId);
      })
      .catch(function(err) { toast(err.message, 'error'); });
    return;
  }

  api('/bots', { method: 'POST', body: JSON.stringify(body) })
    .then(function() {
      toast('Bot created');
      document.getElementById('createBotModal').classList.remove('active');
      loadBotsData();
    })
    .catch(function(err) { toast(err.message, 'error'); });
});

// ─── Run Detail Viewer ────────────────────────────────────────

function openRunDetail(botId, runId) {
  api('/bots/' + botId + '/runs/' + runId).then(function(data) {
    var r = data.run;
    var html = '<h3>Run Detail</h3>';
    html += '<div class="info-grid">';
    html += '<span class="lbl">Run ID</span><span class="val" style="font-family:monospace;font-size:0.8rem;">' + esc(r.id) + '</span>';
    html += '<span class="lbl">Status</span><span class="val">' + runStatusBadge(r.status) + '</span>';
    html += '<span class="lbl">Trigger</span><span class="val">' + esc(r.trigger) + '</span>';
    html += '<span class="lbl">Duration</span><span class="val">' + (r.durationMs > 0 ? (r.durationMs / 1000).toFixed(1) + 's' : '-') + '</span>';
    html += '<span class="lbl">Created</span><span class="val">' + (r.entitiesCreated || 0) + '</span>';
    html += '<span class="lbl">Updated</span><span class="val">' + (r.entitiesUpdated || 0) + '</span>';
    html += '<span class="lbl">API Calls</span><span class="val">' + (r.apiCallsMade || 0) + '</span>';
    html += '<span class="lbl">Started</span><span class="val">' + fmtDate(r.createdAt) + '</span>';
    html += '</div>';

    if (r.error) {
      html += '<div class="section"><h4>Error</h4><p style="color:#f85149;font-size:0.8rem;font-family:monospace;background:#1c2128;padding:0.5rem;border-radius:4px;word-break:break-all;">' + esc(r.error) + '</p></div>';
    }

    // Execution Timeline
    var log = r.log || [];
    if (log.length > 0) {
      html += '<div class="section"><h4>Execution Timeline (' + log.length + ' entries)</h4>';
      html += '<div style="max-height:400px;overflow-y:auto;">';
      log.forEach(function(entry, i) {
        var time = new Date(entry.ts).toLocaleTimeString();
        if (entry.type === 'tool_call') {
          var statusIcon = entry.error ? '<span style="color:#f85149;">✗</span>' : '<span style="color:#3fb950;">✓</span>';
          html += '<div style="margin-bottom:0.75rem;padding:0.5rem;background:#1c2128;border-radius:4px;border-left:3px solid ' + (entry.error ? '#f85149' : '#58a6ff') + ';">';
          html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.25rem;">';
          html += '<span style="font-size:0.8rem;color:#58a6ff;font-weight:600;">' + statusIcon + ' ' + esc(entry.name || 'unknown') + '</span>';
          html += '<span style="font-size:0.75rem;color:#8b949e;">' + time;
          if (entry.durationMs != null) html += ' · ' + entry.durationMs + 'ms';
          html += '</span></div>';
          if (entry.input) {
            html += '<details><summary style="font-size:0.75rem;color:#8b949e;cursor:pointer;">Input</summary>';
            html += '<pre style="font-size:0.7rem;color:#c9d1d9;background:#0d1117;padding:0.3rem;border-radius:3px;overflow-x:auto;max-height:150px;">' + esc(typeof entry.input === 'string' ? entry.input : JSON.stringify(entry.input, null, 2)) + '</pre>';
            html += '</details>';
          }
          if (entry.output) {
            html += '<details><summary style="font-size:0.75rem;color:#8b949e;cursor:pointer;">Output</summary>';
            html += '<pre style="font-size:0.7rem;color:#c9d1d9;background:#0d1117;padding:0.3rem;border-radius:3px;overflow-x:auto;max-height:150px;">' + esc(typeof entry.output === 'string' ? entry.output : JSON.stringify(entry.output, null, 2)) + '</pre>';
            html += '</details>';
          }
          if (entry.error) {
            html += '<p style="font-size:0.75rem;color:#f85149;margin-top:0.25rem;">' + esc(entry.error) + '</p>';
          }
          html += '</div>';
        } else if (entry.type === 'llm_response') {
          html += '<div style="margin-bottom:0.75rem;padding:0.5rem;background:#1c2128;border-radius:4px;border-left:3px solid #3fb950;">';
          html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.25rem;">';
          html += '<span style="font-size:0.8rem;color:#3fb950;font-weight:600;">LLM Response</span>';
          html += '<span style="font-size:0.75rem;color:#8b949e;">' + time + '</span></div>';
          html += '<p style="font-size:0.8rem;color:#c9d1d9;white-space:pre-wrap;max-height:200px;overflow-y:auto;">' + esc(entry.text || '') + '</p>';
          html += '</div>';
        }
      });
      html += '</div></div>';
    }

    html += '<div style="margin-top:1rem;"><button class="btn btn-outline btn-sm" onclick="openBotDetail(\\'' + esc(botId) + '\\')">Back to Bot</button></div>';

    document.getElementById('detailContent').innerHTML = html;
    openDetailPanel();
  }).catch(function(err) { toast(err.message, 'error'); });
}`;
}
