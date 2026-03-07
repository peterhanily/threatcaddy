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

    // Recent Runs
    html += '<div class="section"><h4>Recent Runs (' + runs.length + ')</h4>';
    if (runs.length > 0) {
      html += '<table><thead><tr><th>Time</th><th>Trigger</th><th>Status</th><th>Duration</th><th>Created</th><th>Updated</th><th>API</th></tr></thead><tbody>';
      runs.forEach(function(r) {
        html += '<tr>' +
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

  // Scope
  document.getElementById('newBotScope').value = b.scopeType || 'investigation';

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
  document.getElementById('newBotScope').value = 'investigation';
  document.getElementById('newBotDomains').value = '';
  document.getElementById('newBotRateHour').value = '100';
  document.getElementById('newBotRateDay').value = '1000';
  // Trigger config
  document.getElementById('newBotSchedule').value = '';
  document.getElementById('newBotWebhook').checked = false;
  document.querySelectorAll('.bot-event-check').forEach(function(cb) { cb.checked = false; });
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

  var events = [];
  document.querySelectorAll('.bot-event-check:checked').forEach(function(cb) { events.push(cb.value); });

  var triggers = {};
  if (events.length > 0) triggers.events = events;
  var schedule = document.getElementById('newBotSchedule').value.trim();
  if (schedule) triggers.schedule = schedule;
  if (document.getElementById('newBotWebhook').checked) triggers.webhook = true;

  var domains = document.getElementById('newBotDomains').value.trim();
  var allowedDomains = domains ? domains.split(',').map(function(d) { return d.trim(); }).filter(Boolean) : [];

  var body = {
    name: name,
    description: description,
    type: type,
    capabilities: capabilities,
    triggers: triggers,
    allowedDomains: allowedDomains,
    scopeType: document.getElementById('newBotScope').value,
    rateLimitPerHour: parseInt(document.getElementById('newBotRateHour').value, 10) || 100,
    rateLimitPerDay: parseInt(document.getElementById('newBotRateDay').value, 10) || 1000,
  };

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
});`;
}
