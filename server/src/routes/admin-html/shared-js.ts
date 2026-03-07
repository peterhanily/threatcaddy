export function sharedJs(): string {
  return `/* ═══════════════════════════════════════════════════════════════
   ADMIN PANEL JS
   ═══════════════════════════════════════════════════════════════ */

var BASE = location.origin;
var token = sessionStorage.getItem('adminToken');
var currentAdmin = null;
try { currentAdmin = JSON.parse(sessionStorage.getItem('adminInfo') || 'null'); } catch(e) {}

// Cached data for client-side filtering
var allUsers = [];
var allInvestigations = [];

// ─── API helper ──────────────────────────────────────────────

function api(path, opts) {
  opts = opts || {};
  var headers = { 'Content-Type': 'application/json' };
  if (opts.headers) { for (var k in opts.headers) headers[k] = opts.headers[k]; }
  if (token) headers['Authorization'] = 'Bearer ' + token;
  return fetch(BASE + '/admin/api' + path, Object.assign({}, opts, { headers: headers })).then(function(r) {
    if (r.status === 401 && token) { logout(); throw new Error('Session expired'); }
    return r.json().then(function(data) {
      if (!r.ok) throw new Error(data.error || 'Request failed');
      return data;
    });
  });
}

function apiRaw(path) {
  var headers = {};
  if (token) headers['Authorization'] = 'Bearer ' + token;
  return fetch(BASE + '/admin/api' + path, { headers: headers }).then(function(r) {
    if (r.status === 401 && token) { logout(); throw new Error('Session expired'); }
    if (!r.ok) throw new Error('Export failed');
    return r;
  });
}

function toast(msg, type) {
  type = type || 'success';
  var el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(function() { el.remove(); }, 3500);
}

function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function fmtDate(d) { return d ? new Date(d).toLocaleString() : 'Never'; }
function fmtShortDate(d) { return d ? new Date(d).toLocaleDateString() : ''; }

function categoryBadge(cat) {
  var colors = { admin: 'red', auth: 'blue', note: 'green', task: 'yellow', investigation: 'blue' };
  var c = colors[cat] || 'gray';
  return '<span class="badge badge-' + c + '">' + esc(cat) + '</span>';
}

function statusBadge(status) {
  var colors = { active: 'green', closed: 'gray', archived: 'yellow' };
  var c = colors[status] || 'gray';
  return '<span class="badge badge-' + c + '">' + esc(status || 'active') + '</span>';
}

/* ═══ SETUP STATUS CHECK ═════════════════════════════════════ */

function checkSetupStatus() {
  if (token) {
    showDashboard();
    return;
  }
  // Check if admin accounts exist
  fetch(BASE + '/admin/api/setup-status')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.hasAdminAccounts) {
        document.getElementById('loginForm').style.display = '';
        document.getElementById('setupForm').style.display = 'none';
      } else {
        document.getElementById('loginForm').style.display = 'none';
        document.getElementById('setupForm').style.display = '';
      }
    })
    .catch(function() {
      // Default to login form on error
      document.getElementById('loginForm').style.display = '';
    });
}

/* ═══ SETUP FORM ═════════════════════════════════════════════ */

document.getElementById('setupForm').addEventListener('submit', function(e) {
  e.preventDefault();
  var errEl = document.getElementById('setupError');
  errEl.style.display = 'none';
  var password = document.getElementById('setupPassword').value;
  if (password.length < 12) { errEl.textContent = 'Password must be at least 12 characters'; errEl.style.display = 'block'; return; }
  api('/bootstrap', {
    method: 'POST',
    body: JSON.stringify({
      bootstrapSecret: document.getElementById('setupSecret').value,
      username: document.getElementById('setupUsername').value,
      displayName: document.getElementById('setupDisplayName').value,
      password: password
    })
  }).then(function(res) {
    token = res.token;
    currentAdmin = res.admin;
    sessionStorage.setItem('adminToken', token);
    sessionStorage.setItem('adminInfo', JSON.stringify(currentAdmin));
    sessionStorage.setItem('adminLoginTime', String(Date.now()));
    showDashboard();
  }).catch(function(err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  });
});

/* ═══ LOGIN / LOGOUT ══════════════════════════════════════════ */

document.getElementById('loginForm').addEventListener('submit', function(e) {
  e.preventDefault();
  var errEl = document.getElementById('loginError');
  errEl.style.display = 'none';
  api('/login', {
    method: 'POST',
    body: JSON.stringify({
      username: document.getElementById('loginUsername').value,
      password: document.getElementById('loginPassword').value
    })
  }).then(function(res) {
    token = res.token;
    currentAdmin = res.admin;
    sessionStorage.setItem('adminToken', token);
    sessionStorage.setItem('adminInfo', JSON.stringify(currentAdmin));
    sessionStorage.setItem('adminLoginTime', String(Date.now()));
    showDashboard();
  }).catch(function(err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  });
});

document.getElementById('logoutBtn').addEventListener('click', function() { logout(); });

function logout() {
  token = null;
  currentAdmin = null;
  if (sessionTimerInterval) clearInterval(sessionTimerInterval);
  sessionStorage.removeItem('adminToken');
  sessionStorage.removeItem('adminInfo');
  sessionStorage.removeItem('adminLoginTime');
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('login').style.display = 'flex';
  document.getElementById('loginUsername').value = '';
  document.getElementById('loginPassword').value = '';
  document.getElementById('adminIdentity').textContent = '';
  document.getElementById('sessionTimer').textContent = '';
  checkSetupStatus();
}

/* ═══ TAB NAVIGATION ══════════════════════════════════════════ */

document.querySelectorAll('.tab-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
    document.querySelectorAll('.tab-content').forEach(function(c) { c.classList.remove('active'); });
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');

    // Load data for the tab
    var tab = btn.dataset.tab;
    if (tab === 'tab-users') renderUsers();
    if (tab === 'tab-investigations') renderInvestigations();
    if (tab === 'tab-audit') loadAuditLog();
    if (tab === 'tab-sessions') loadSessions();
    if (tab === 'tab-bots') loadBotsData();
    if (tab === 'tab-admins') loadAdminAccounts();
  });
});

/* ═══ DASHBOARD ═══════════════════════════════════════════════ */

function showDashboard() {
  document.getElementById('login').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';
  // Show identity
  if (currentAdmin) {
    document.getElementById('adminIdentity').textContent = 'Signed in as ' + currentAdmin.displayName;
  }
  startSessionTimer();
  loadAll();
}

var sessionTimerInterval = null;

function startSessionTimer() {
  if (sessionTimerInterval) clearInterval(sessionTimerInterval);
  // Admin JWT expires 1 hour after login. We track from token storage time.
  var loginTime = sessionStorage.getItem('adminLoginTime');
  if (!loginTime) {
    loginTime = String(Date.now());
    sessionStorage.setItem('adminLoginTime', loginTime);
  }
  var expiresAt = parseInt(loginTime, 10) + 3600000; // 1 hour

  function updateTimer() {
    var remaining = expiresAt - Date.now();
    var timerEl = document.getElementById('sessionTimer');
    if (remaining <= 0) {
      timerEl.textContent = '';
      logout();
      toast('Session expired — please sign in again', 'error');
      return;
    }
    var mins = Math.floor(remaining / 60000);
    if (mins <= 5) {
      timerEl.textContent = mins + 'm remaining';
      timerEl.style.color = '#f85149';
    } else if (mins <= 15) {
      timerEl.textContent = mins + 'm remaining';
      timerEl.style.color = '#d29922';
    } else {
      timerEl.textContent = '';
    }
  }

  updateTimer();
  sessionTimerInterval = setInterval(updateTimer, 30000);
}

function loadAll() {
  loadStats();
  loadSettings();
  loadAllowedEmails();
  loadUsersData();
  loadInvestigationsData();
  loadBotsData();
}

function loadStats() {
  return api('/stats').then(function(s) {
    document.getElementById('statsGrid').innerHTML =
      [['Total Users', s.totalUsers], ['Active Users', s.activeUsers], ['Investigations', s.investigations],
       ['Active Sessions', s.activeSessions], ['Audit Events (24h)', s.auditLogEntries24h]]
        .map(function(a) { return '<div class="stat-card"><div class="label">' + a[0] + '</div><div class="value">' + a[1] + '</div></div>'; }).join('');
  }).catch(function(err) { toast(err.message, 'error'); });
}

/* ═══ DETAIL PANEL ════════════════════════════════════════════ */

function openDetailPanel() {
  document.getElementById('detailPanel').classList.add('active');
  document.getElementById('detailBackdrop').classList.add('active');
}

function closeDetailPanel() {
  document.getElementById('detailPanel').classList.remove('active');
  document.getElementById('detailBackdrop').classList.remove('active');
}

document.getElementById('closeDetailBtn').addEventListener('click', closeDetailPanel);
document.getElementById('detailBackdrop').addEventListener('click', closeDetailPanel);`;
}
