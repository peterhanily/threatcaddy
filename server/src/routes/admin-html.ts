export function getAdminHtml(nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Admin Panel</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f1117; color: #e1e4e8; min-height: 100vh; }
  .login-container { display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .login-box { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 2rem; width: 360px; }
  .login-box h1 { font-size: 1.25rem; margin-bottom: 1.5rem; text-align: center; color: #c9d1d9; }
  .form-group { margin-bottom: 1rem; }
  .form-group label { display: block; font-size: 0.85rem; color: #8b949e; margin-bottom: 0.35rem; }
  .form-group input { width: 100%; padding: 0.5rem 0.75rem; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 0.9rem; }
  .form-group input:focus { outline: none; border-color: #58a6ff; }
  .btn { display: inline-block; padding: 0.5rem 1rem; border: none; border-radius: 6px; font-size: 0.85rem; cursor: pointer; font-weight: 500; }
  .btn-primary { background: #238636; color: #fff; width: 100%; padding: 0.6rem; }
  .btn-primary:hover { background: #2ea043; }
  .btn-sm { padding: 0.3rem 0.6rem; font-size: 0.8rem; }
  .btn-danger { background: #da3633; color: #fff; }
  .btn-danger:hover { background: #f85149; }
  .btn-outline { background: transparent; border: 1px solid #30363d; color: #c9d1d9; }
  .btn-outline:hover { border-color: #58a6ff; color: #58a6ff; }
  .btn-warning { background: #d29922; color: #fff; }
  .btn-warning:hover { background: #e3b341; }

  .dashboard { display: none; max-width: 1100px; margin: 0 auto; padding: 1.5rem; }
  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; border-bottom: 1px solid #21262d; padding-bottom: 1rem; }
  .header h1 { font-size: 1.25rem; color: #c9d1d9; }

  .settings-section { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1.5rem; }
  .settings-section h2 { font-size: 0.95rem; color: #c9d1d9; margin-bottom: 0.75rem; }
  .setting-row { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; }
  .setting-row label { font-size: 0.85rem; color: #8b949e; min-width: 130px; }
  .setting-row input[type="number"] { width: 80px; padding: 0.3rem 0.5rem; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 0.85rem; }
  .setting-row input[type="number"]:focus { outline: none; border-color: #58a6ff; }
  .setting-row input[type="password"] { width: 240px; padding: 0.3rem 0.5rem; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 0.85rem; }
  .setting-row input[type="password"]:focus { outline: none; border-color: #58a6ff; }
  .allowed-emails-section { margin-top: 0.75rem; }
  .allowed-emails-section .add-row { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; }
  .allowed-emails-section .add-row input { flex: 1; padding: 0.4rem 0.6rem; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 0.85rem; }
  .allowed-emails-section .add-row input:focus { outline: none; border-color: #58a6ff; }
  .email-list { max-height: 240px; overflow-y: auto; }
  .email-item { display: flex; justify-content: space-between; align-items: center; padding: 0.35rem 0.5rem; border-bottom: 1px solid #21262d; font-size: 0.85rem; }
  .email-item:last-child { border-bottom: none; }
  .email-item .email-addr { color: #c9d1d9; }
  .email-empty { color: #8b949e; font-size: 0.85rem; font-style: italic; }

  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
  .stat-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1rem 1.25rem; }
  .stat-card .label { font-size: 0.8rem; color: #8b949e; margin-bottom: 0.25rem; }
  .stat-card .value { font-size: 1.5rem; font-weight: 600; color: #58a6ff; }

  table { width: 100%; border-collapse: collapse; background: #161b22; border: 1px solid #30363d; border-radius: 8px; overflow: hidden; }
  th, td { padding: 0.6rem 0.75rem; text-align: left; border-bottom: 1px solid #21262d; font-size: 0.85rem; }
  th { background: #1c2128; color: #8b949e; font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; }
  td { color: #c9d1d9; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #1c2128; }

  select { background: #0d1117; border: 1px solid #30363d; color: #c9d1d9; padding: 0.25rem 0.4rem; border-radius: 4px; font-size: 0.8rem; }
  .toggle { position: relative; display: inline-block; width: 36px; height: 20px; cursor: pointer; }
  .toggle input { opacity: 0; width: 0; height: 0; }
  .toggle .slider { position: absolute; inset: 0; background: #30363d; border-radius: 20px; transition: 0.2s; }
  .toggle .slider::before { content: ''; position: absolute; width: 14px; height: 14px; left: 3px; bottom: 3px; background: #8b949e; border-radius: 50%; transition: 0.2s; }
  .toggle input:checked + .slider { background: #238636; }
  .toggle input:checked + .slider::before { transform: translateX(16px); background: #fff; }

  .toast-container { position: fixed; top: 1rem; right: 1rem; z-index: 1000; display: flex; flex-direction: column; gap: 0.5rem; }
  .toast { padding: 0.6rem 1rem; border-radius: 6px; font-size: 0.85rem; animation: fadeIn 0.2s; max-width: 360px; }
  .toast-success { background: #238636; color: #fff; }
  .toast-error { background: #da3633; color: #fff; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }

  .modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 500; align-items: center; justify-content: center; }
  .modal-overlay.active { display: flex; }
  .modal { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1.5rem; min-width: 320px; max-width: 440px; }
  .modal h3 { margin-bottom: 1rem; color: #c9d1d9; }
  .modal p { margin-bottom: 1rem; color: #8b949e; font-size: 0.9rem; }
  .modal-actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
  .temp-password { background: #0d1117; border: 1px solid #30363d; padding: 0.75rem; border-radius: 6px; font-family: monospace; font-size: 1rem; color: #58a6ff; word-break: break-all; margin-bottom: 1rem; user-select: all; }
  .error-msg { color: #f85149; font-size: 0.85rem; margin-top: 0.5rem; display: none; }
</style>
</head>
<body>
<div id="login" class="login-container">
  <div class="login-box">
    <h1>Admin Panel</h1>
    <form id="loginForm">
      <div class="form-group">
        <label for="secret">Admin Secret</label>
        <input type="password" id="secret" placeholder="Enter admin secret" autocomplete="off" required>
      </div>
      <div id="loginError" class="error-msg"></div>
      <button type="submit" class="btn btn-primary">Sign In</button>
    </form>
  </div>
</div>

<div id="dashboard" class="dashboard">
  <div class="header">
    <h1>Admin Panel</h1>
    <button id="logoutBtn" class="btn btn-outline btn-sm">Sign Out</button>
  </div>
  <div class="stats" id="statsGrid"></div>

  <div class="settings-section">
    <h2>Registration Settings</h2>
    <div class="setting-row">
      <label>Registration Mode</label>
      <select id="regModeSelect">
        <option value="invite">Invite Only</option>
        <option value="open">Open</option>
      </select>
    </div>
    <div id="allowedEmailsSection" class="allowed-emails-section">
      <div class="add-row">
        <input type="email" id="newEmailInput" placeholder="user@example.com">
        <button id="addEmailBtn" class="btn btn-primary btn-sm">Add</button>
      </div>
      <div class="email-list" id="emailList"></div>
    </div>
  </div>

  <div class="settings-section">
    <h2>Session Settings</h2>
    <div class="setting-row">
      <label>Session TTL (hours)</label>
      <input type="number" id="sessionTtl" min="1" max="8760" value="24">
      <button id="saveSessionBtn" class="btn btn-primary btn-sm">Save</button>
    </div>
    <div class="setting-row">
      <label>Max sessions/user</label>
      <input type="number" id="maxSessions" min="0" max="1000" value="0">
      <span style="font-size:0.8rem;color:#8b949e;">(0 = unlimited)</span>
    </div>
  </div>

  <div class="settings-section">
    <h2>Change Admin Secret</h2>
    <div class="setting-row">
      <label>Current secret</label>
      <input type="password" id="currentSecret" placeholder="Current secret" autocomplete="off">
    </div>
    <div class="setting-row">
      <label>New secret</label>
      <input type="password" id="newSecret" placeholder="New secret (min 12 chars)" autocomplete="off">
    </div>
    <div class="setting-row">
      <label>Confirm new secret</label>
      <input type="password" id="confirmSecret" placeholder="Confirm new secret" autocomplete="off">
      <button id="changeSecretBtn" class="btn btn-warning btn-sm">Change Secret</button>
    </div>
  </div>

  <h2 style="font-size:0.95rem;color:#c9d1d9;margin-bottom:0.75rem;">Users</h2>
  <table>
    <thead>
      <tr>
        <th>Email</th>
        <th>Display Name</th>
        <th>Role</th>
        <th>Active</th>
        <th>Last Login</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody id="usersBody"></tbody>
  </table>

  <h2 style="font-size:0.95rem;color:#c9d1d9;margin:1.5rem 0 0.75rem;">Investigations</h2>
  <table>
    <thead>
      <tr>
        <th>Name</th>
        <th>Status</th>
        <th>Creator</th>
        <th>Members</th>
        <th>Created</th>
      </tr>
    </thead>
    <tbody id="investigationsBody"></tbody>
  </table>
</div>

<div class="toast-container" id="toasts"></div>

<div id="resetModal" class="modal-overlay">
  <div class="modal">
    <h3 id="modalTitle">Reset Password</h3>
    <p id="modalText"></p>
    <div id="tempPwBox" class="temp-password" style="display:none;"></div>
    <div class="modal-actions">
      <button id="closeModalBtn" class="btn btn-outline btn-sm">Close</button>
      <button id="confirmResetBtn" class="btn btn-danger btn-sm">Reset</button>
    </div>
  </div>
</div>

<script nonce="${nonce}">
var BASE = location.origin;
var token = sessionStorage.getItem('adminToken');
var resetUserId = null;

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

function toast(msg, type) {
  type = type || 'success';
  var el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(function() { el.remove(); }, 3500);
}

function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

/* ─── Login ─────────────────────────────────────────── */

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

/* ─── Logout ────────────────────────────────────────── */

document.getElementById('logoutBtn').addEventListener('click', function() { logout(); });

function logout() {
  token = null;
  sessionStorage.removeItem('adminToken');
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('login').style.display = 'flex';
  document.getElementById('secret').value = '';
}

/* ─── Dashboard ─────────────────────────────────────── */

function showDashboard() {
  document.getElementById('login').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';
  Promise.all([loadStats(), loadUsers(), loadInvestigations(), loadSettings(), loadAllowedEmails()]);
}

function loadStats() {
  return api('/stats').then(function(s) {
    document.getElementById('statsGrid').innerHTML =
      [['Total Users', s.totalUsers], ['Active Users', s.activeUsers], ['Investigations', s.investigations]]
        .map(function(a) { return '<div class="stat-card"><div class="label">' + a[0] + '</div><div class="value">' + a[1] + '</div></div>'; }).join('');
  }).catch(function(err) { toast(err.message, 'error'); });
}

/* ─── Users (event delegation) ──────────────────────── */

function loadUsers() {
  return api('/users').then(function(data) {
    var tbody = document.getElementById('usersBody');
    tbody.innerHTML = data.users.map(function(u) {
      var lastLogin = u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never';
      return '<tr>' +
        '<td>' + esc(u.email) + '</td>' +
        '<td>' + esc(u.displayName) + '</td>' +
        '<td><select data-action="role" data-id="' + esc(u.id) + '">' +
          ['admin','analyst','viewer'].map(function(r) { return '<option value="' + r + '"' + (r === u.role ? ' selected' : '') + '>' + r + '</option>'; }).join('') +
        '</select></td>' +
        '<td><label class="toggle"><input type="checkbox" data-action="active" data-id="' + esc(u.id) + '"' + (u.active ? ' checked' : '') + '><span class="slider"></span></label></td>' +
        '<td>' + lastLogin + '</td>' +
        '<td><button class="btn btn-danger btn-sm" data-action="reset" data-id="' + esc(u.id) + '" data-email="' + esc(u.email) + '">Reset Password</button></td>' +
        '</tr>';
    }).join('');
  }).catch(function(err) { toast(err.message, 'error'); });
}

document.getElementById('usersBody').addEventListener('change', function(e) {
  var el = e.target;
  if (el.dataset.action === 'role') {
    changeRole(el.dataset.id, el.value);
  } else if (el.dataset.action === 'active') {
    toggleActive(el.dataset.id, el.checked);
  }
});

document.getElementById('usersBody').addEventListener('click', function(e) {
  var btn = e.target.closest('[data-action="reset"]');
  if (btn) openResetModal(btn.dataset.id, btn.dataset.email);
});

function changeRole(id, role) {
  api('/users/' + id, { method: 'PATCH', body: JSON.stringify({ role: role }) })
    .then(function() { toast('Role updated'); })
    .catch(function(err) { toast(err.message, 'error'); loadUsers(); });
}

function toggleActive(id, active) {
  api('/users/' + id, { method: 'PATCH', body: JSON.stringify({ active: active }) })
    .then(function() { toast(active ? 'User activated' : 'User deactivated'); })
    .catch(function(err) { toast(err.message, 'error'); loadUsers(); });
}

/* ─── Reset password modal ──────────────────────────── */

document.getElementById('closeModalBtn').addEventListener('click', function() { closeModal(); });
document.getElementById('confirmResetBtn').addEventListener('click', function() { confirmReset(); });

function openResetModal(id, email) {
  resetUserId = id;
  document.getElementById('modalTitle').textContent = 'Reset Password';
  document.getElementById('modalText').textContent = 'Reset password for ' + email + '? This will generate a temporary password.';
  document.getElementById('tempPwBox').style.display = 'none';
  document.getElementById('confirmResetBtn').style.display = '';
  document.getElementById('resetModal').classList.add('active');
}

function closeModal() {
  document.getElementById('resetModal').classList.remove('active');
  resetUserId = null;
}

function confirmReset() {
  if (!resetUserId) return;
  api('/users/' + resetUserId + '/reset-password', { method: 'POST' })
    .then(function(res) {
      document.getElementById('modalText').textContent = 'Temporary password (share securely):';
      document.getElementById('tempPwBox').textContent = res.temporaryPassword;
      document.getElementById('tempPwBox').style.display = 'block';
      document.getElementById('confirmResetBtn').style.display = 'none';
      toast('Password reset');
    })
    .catch(function(err) { toast(err.message, 'error'); closeModal(); });
}

/* ─── Settings ──────────────────────────────────────── */

document.getElementById('regModeSelect').addEventListener('change', function() {
  changeRegMode(this.value);
});

function loadSettings() {
  return api('/settings').then(function(data) {
    document.getElementById('regModeSelect').value = data.registrationMode;
    toggleEmailSection(data.registrationMode);
    document.getElementById('sessionTtl').value = data.ttlHours || 24;
    document.getElementById('maxSessions').value = data.maxPerUser || 0;
  }).catch(function(err) { toast(err.message, 'error'); });
}

function toggleEmailSection(mode) {
  document.getElementById('allowedEmailsSection').style.display = mode === 'invite' ? '' : 'none';
}

function changeRegMode(mode) {
  api('/settings', { method: 'PATCH', body: JSON.stringify({ registrationMode: mode }) })
    .then(function() { toggleEmailSection(mode); toast('Registration mode updated'); })
    .catch(function(err) { toast(err.message, 'error'); loadSettings(); });
}

/* ─── Session settings ──────────────────────────────── */

document.getElementById('saveSessionBtn').addEventListener('click', function() {
  saveSessionSettings();
});

function saveSessionSettings() {
  var ttl = parseInt(document.getElementById('sessionTtl').value, 10);
  var max = parseInt(document.getElementById('maxSessions').value, 10);
  if (isNaN(ttl) || ttl < 1) { toast('TTL must be at least 1 hour', 'error'); return; }
  if (isNaN(max) || max < 0) { toast('Max sessions must be 0 or more', 'error'); return; }
  api('/settings', { method: 'PATCH', body: JSON.stringify({ ttlHours: ttl, maxPerUser: max }) })
    .then(function() { toast('Session settings updated'); })
    .catch(function(err) { toast(err.message, 'error'); });
}

/* ─── Change admin secret ───────────────────────────── */

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

/* ─── Allowed emails (event delegation) ─────────────── */

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
}

/* ─── Investigations ────────────────────────────────── */

function loadInvestigations() {
  return api('/investigations').then(function(data) {
    var tbody = document.getElementById('investigationsBody');
    var statusColors = { active: '#3fb950', closed: '#8b949e', archived: '#d29922' };
    tbody.innerHTML = data.investigations.map(function(inv) {
      var created = new Date(inv.createdAt).toLocaleDateString();
      var color = inv.color || '#8b949e';
      var statusColor = statusColors[inv.status] || '#8b949e';
      return '<tr>' +
        '<td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + color + ';margin-right:6px;vertical-align:middle;"></span>' + esc(inv.name) + '</td>' +
        '<td><span style="color:' + statusColor + '">' + esc(inv.status || 'active') + '</span></td>' +
        '<td>' + esc(inv.creatorName) + ' <span style="color:#8b949e">(' + esc(inv.creatorEmail) + ')</span></td>' +
        '<td>' + inv.memberCount + '</td>' +
        '<td>' + created + '</td>' +
        '</tr>';
    }).join('');
    if (data.investigations.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="color:#8b949e;font-style:italic;">No investigations yet</td></tr>';
    }
  }).catch(function(err) { toast(err.message, 'error'); });
}

/* ─── Init ──────────────────────────────────────────── */

if (token) showDashboard();
</script>
</body>
</html>`;
}
