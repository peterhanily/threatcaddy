export function settingsTabJs(): string {
  return `/* ═══ SETTINGS ════════════════════════════════════════════════ */

function loadSettings() {
  return api('/settings').then(function(data) {
    document.getElementById('serverNameInput').value = data.serverName || '';
    document.getElementById('regModeSelect').value = data.registrationMode;
    toggleEmailSection(data.registrationMode);
    document.getElementById('sessionTtl').value = data.ttlHours || 24;
    document.getElementById('maxSessions').value = data.maxPerUser || 0;
    document.getElementById('notifRetention').value = data.notificationRetentionDays || 90;
    document.getElementById('auditRetention').value = data.auditLogRetentionDays || 365;
  }).catch(function(err) { toast(err.message, 'error'); });
}

document.getElementById('saveServerNameBtn').addEventListener('click', function() {
  var name = document.getElementById('serverNameInput').value.trim();
  if (!name) { toast('Server name cannot be empty', 'error'); return; }
  api('/settings', { method: 'PATCH', body: JSON.stringify({ serverName: name }) })
    .then(function() { toast('Server name updated'); })
    .catch(function(err) { toast(err.message, 'error'); loadSettings(); });
});

function toggleEmailSection(mode) {
  document.getElementById('allowedEmailsSection').style.display = mode === 'invite' ? '' : 'none';
}

document.getElementById('regModeSelect').addEventListener('change', function() {
  var mode = this.value;
  api('/settings', { method: 'PATCH', body: JSON.stringify({ registrationMode: mode }) })
    .then(function() { toggleEmailSection(mode); toast('Registration mode updated'); })
    .catch(function(err) { toast(err.message, 'error'); loadSettings(); });
});

document.getElementById('saveSessionBtn').addEventListener('click', function() {
  var ttl = parseInt(document.getElementById('sessionTtl').value, 10);
  var max = parseInt(document.getElementById('maxSessions').value, 10);
  if (isNaN(ttl) || ttl < 1) { toast('TTL must be at least 1 hour', 'error'); return; }
  if (isNaN(max) || max < 0) { toast('Max sessions must be 0 or more', 'error'); return; }
  api('/settings', { method: 'PATCH', body: JSON.stringify({ ttlHours: ttl, maxPerUser: max }) })
    .then(function() { toast('Session settings updated'); })
    .catch(function(err) { toast(err.message, 'error'); });
});

document.getElementById('saveRetentionBtn').addEventListener('click', function() {
  var notif = parseInt(document.getElementById('notifRetention').value, 10);
  var audit = parseInt(document.getElementById('auditRetention').value, 10);
  if (isNaN(notif) || notif < 1 || notif > 3650) { toast('Notification retention must be 1-3650 days', 'error'); return; }
  if (isNaN(audit) || audit < 1 || audit > 3650) { toast('Audit log retention must be 1-3650 days', 'error'); return; }
  api('/settings', { method: 'PATCH', body: JSON.stringify({ notificationRetentionDays: notif, auditLogRetentionDays: audit }) })
    .then(function() { toast('Retention settings updated'); })
    .catch(function(err) { toast(err.message, 'error'); });
});

document.getElementById('changeSecretBtn').addEventListener('click', function() {
  var current = document.getElementById('currentSecret').value;
  var newSec = document.getElementById('newSecret').value;
  var confirm = document.getElementById('confirmSecret').value;
  if (!current) { toast('Enter current secret', 'error'); return; }
  if (newSec.length < 12) { toast('New secret must be at least 12 characters', 'error'); return; }
  if (newSec !== confirm) { toast('New secrets do not match', 'error'); return; }
  api('/change-secret', { method: 'POST', body: JSON.stringify({ currentSecret: current, newSecret: newSec }) })
    .then(function() {
      toast('Admin secret changed');
      document.getElementById('currentSecret').value = '';
      document.getElementById('newSecret').value = '';
      document.getElementById('confirmSecret').value = '';
    })
    .catch(function(err) { toast(err.message, 'error'); });
});

/* ═══ ALLOWED EMAILS ══════════════════════════════════════════ */

document.getElementById('addEmailBtn').addEventListener('click', function() { addEmail(); });
document.getElementById('newEmailInput').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') addEmail();
});
document.getElementById('emailList').addEventListener('click', function(e) {
  var btn = e.target.closest('[data-action="remove-email"]');
  if (btn) removeEmail(btn.dataset.email);
});

function loadAllowedEmails() {
  return api('/allowed-emails').then(function(data) {
    var list = document.getElementById('emailList');
    if (data.emails.length === 0) {
      list.innerHTML = '<div class="email-empty">No emails on the allowlist</div>';
      return;
    }
    list.innerHTML = data.emails.map(function(e) {
      return '<div class="email-item"><span class="email-addr">' + esc(e.email) + '</span>' +
        '<button class="btn btn-danger btn-sm" data-action="remove-email" data-email="' + esc(e.email) + '">Remove</button></div>';
    }).join('');
  }).catch(function(err) { toast(err.message, 'error'); });
}

function addEmail() {
  var input = document.getElementById('newEmailInput');
  var email = input.value.trim().toLowerCase();
  if (!email) return;
  api('/allowed-emails', { method: 'POST', body: JSON.stringify({ email: email }) })
    .then(function() { input.value = ''; toast('Email added'); loadAllowedEmails(); })
    .catch(function(err) { toast(err.message, 'error'); });
}

function removeEmail(email) {
  api('/allowed-emails/' + encodeURIComponent(email), { method: 'DELETE' })
    .then(function() { toast('Email removed'); loadAllowedEmails(); })
    .catch(function(err) { toast(err.message, 'error'); });
}`;
}
