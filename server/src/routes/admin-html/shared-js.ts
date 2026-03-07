export function sharedJs(): string {
  return `/* ═══════════════════════════════════════════════════════════════
   ADMIN PANEL JS
   ═══════════════════════════════════════════════════════════════ */

var BASE = location.origin;
var token = sessionStorage.getItem('adminToken');

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

/* ═══ LOGIN / LOGOUT ══════════════════════════════════════════ */

document.getElementById('loginForm').addEventListener('submit', function(e) {
  e.preventDefault();
  var errEl = document.getElementById('loginError');
  errEl.style.display = 'none';
  api('/login', { method: 'POST', body: JSON.stringify({ secret: document.getElementById('secret').value }) })
    .then(function(res) {
      token = res.token;
      sessionStorage.setItem('adminToken', token);
      showDashboard();
    })
    .catch(function(err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    });
});

document.getElementById('logoutBtn').addEventListener('click', function() { logout(); });

function logout() {
  token = null;
  sessionStorage.removeItem('adminToken');
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('login').style.display = 'flex';
  document.getElementById('secret').value = '';
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
  });
});

/* ═══ DASHBOARD ═══════════════════════════════════════════════ */

function showDashboard() {
  document.getElementById('login').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';
  loadAll();
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
