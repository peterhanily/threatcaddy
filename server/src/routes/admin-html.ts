export const ADMIN_HTML = `<!DOCTYPE html>
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

  .dashboard { display: none; max-width: 1100px; margin: 0 auto; padding: 1.5rem; }
  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; border-bottom: 1px solid #21262d; padding-bottom: 1rem; }
  .header h1 { font-size: 1.25rem; color: #c9d1d9; }

  .settings-section { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1.5rem; }
  .settings-section h2 { font-size: 0.95rem; color: #c9d1d9; margin-bottom: 0.75rem; }
  .setting-row { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; }
  .setting-row label { font-size: 0.85rem; color: #8b949e; min-width: 130px; }
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
    <button class="btn btn-outline btn-sm" onclick="logout()">Sign Out</button>
  </div>
  <div class="stats" id="statsGrid"></div>

  <div class="settings-section">
    <h2>Registration Settings</h2>
    <div class="setting-row">
      <label>Registration Mode</label>
      <select id="regModeSelect" onchange="changeRegMode(this.value)">
        <option value="invite">Invite Only</option>
        <option value="open">Open</option>
      </select>
    </div>
    <div id="allowedEmailsSection" class="allowed-emails-section">
      <div class="add-row">
        <input type="email" id="newEmailInput" placeholder="user@example.com" onkeydown="if(event.key==='Enter'){addEmail();}">
        <button class="btn btn-primary btn-sm" onclick="addEmail()">Add</button>
      </div>
      <div class="email-list" id="emailList"></div>
    </div>
  </div>

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
</div>

<div class="toast-container" id="toasts"></div>

<div id="resetModal" class="modal-overlay">
  <div class="modal">
    <h3 id="modalTitle">Reset Password</h3>
    <p id="modalText"></p>
    <div id="tempPwBox" class="temp-password" style="display:none;"></div>
    <div class="modal-actions">
      <button class="btn btn-outline btn-sm" onclick="closeModal()">Close</button>
      <button id="confirmResetBtn" class="btn btn-danger btn-sm" onclick="confirmReset()">Reset</button>
    </div>
  </div>
</div>

<script>
const BASE = location.origin;
let token = sessionStorage.getItem('adminToken');
let resetUserId = null;

function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  return fetch(BASE + '/admin/api' + path, { ...opts, headers }).then(async r => {
    if (r.status === 401 && token) { logout(); throw new Error('Session expired'); }
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Request failed');
    return data;
  });
}

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('loginError');
  errEl.style.display = 'none';
  try {
    const res = await api('/login', { method: 'POST', body: JSON.stringify({ secret: document.getElementById('secret').value }) });
    token = res.token;
    sessionStorage.setItem('adminToken', token);
    showDashboard();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
});

function logout() {
  token = null;
  sessionStorage.removeItem('adminToken');
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('login').style.display = 'flex';
  document.getElementById('secret').value = '';
}

async function showDashboard() {
  document.getElementById('login').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';
  await Promise.all([loadStats(), loadUsers(), loadSettings(), loadAllowedEmails()]);
}

async function loadStats() {
  try {
    const s = await api('/stats');
    document.getElementById('statsGrid').innerHTML =
      [['Total Users', s.totalUsers], ['Active Users', s.activeUsers], ['Investigations', s.investigations]]
        .map(([l, v]) => '<div class="stat-card"><div class="label">' + l + '</div><div class="value">' + v + '</div></div>').join('');
  } catch (err) { toast(err.message, 'error'); }
}

async function loadUsers() {
  try {
    const data = await api('/users');
    const tbody = document.getElementById('usersBody');
    tbody.innerHTML = data.users.map(u => {
      const lastLogin = u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never';
      return '<tr>' +
        '<td>' + esc(u.email) + '</td>' +
        '<td>' + esc(u.displayName) + '</td>' +
        '<td><select onchange="changeRole(\\'' + u.id + '\\', this.value)">' +
          ['admin','analyst','viewer'].map(r => '<option value="' + r + '"' + (r === u.role ? ' selected' : '') + '>' + r + '</option>').join('') +
        '</select></td>' +
        '<td><label class="toggle"><input type="checkbox"' + (u.active ? ' checked' : '') + ' onchange="toggleActive(\\'' + u.id + '\\', this.checked)"><span class="slider"></span></label></td>' +
        '<td>' + lastLogin + '</td>' +
        '<td><button class="btn btn-danger btn-sm" onclick="openResetModal(\\'' + u.id + '\\', \\'' + esc(u.email) + '\\')">Reset Password</button></td>' +
        '</tr>';
    }).join('');
  } catch (err) { toast(err.message, 'error'); }
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

async function changeRole(id, role) {
  try {
    await api('/users/' + id, { method: 'PATCH', body: JSON.stringify({ role }) });
    toast('Role updated');
  } catch (err) { toast(err.message, 'error'); loadUsers(); }
}

async function toggleActive(id, active) {
  try {
    await api('/users/' + id, { method: 'PATCH', body: JSON.stringify({ active }) });
    toast(active ? 'User activated' : 'User deactivated');
  } catch (err) { toast(err.message, 'error'); loadUsers(); }
}

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

async function confirmReset() {
  if (!resetUserId) return;
  try {
    const res = await api('/users/' + resetUserId + '/reset-password', { method: 'POST' });
    document.getElementById('modalText').textContent = 'Temporary password (share securely):';
    document.getElementById('tempPwBox').textContent = res.temporaryPassword;
    document.getElementById('tempPwBox').style.display = 'block';
    document.getElementById('confirmResetBtn').style.display = 'none';
    toast('Password reset');
  } catch (err) { toast(err.message, 'error'); closeModal(); }
}

// ─── Registration Settings ───────────────────────────────────────

async function loadSettings() {
  try {
    const data = await api('/settings');
    document.getElementById('regModeSelect').value = data.registrationMode;
    toggleEmailSection(data.registrationMode);
  } catch (err) { toast(err.message, 'error'); }
}

function toggleEmailSection(mode) {
  document.getElementById('allowedEmailsSection').style.display = mode === 'invite' ? '' : 'none';
}

async function changeRegMode(mode) {
  try {
    await api('/settings', { method: 'PATCH', body: JSON.stringify({ registrationMode: mode }) });
    toggleEmailSection(mode);
    toast('Registration mode updated');
  } catch (err) { toast(err.message, 'error'); loadSettings(); }
}

async function loadAllowedEmails() {
  try {
    const data = await api('/allowed-emails');
    const list = document.getElementById('emailList');
    if (data.emails.length === 0) {
      list.innerHTML = '<div class="email-empty">No emails on the allowlist</div>';
      return;
    }
    list.innerHTML = data.emails.map(e =>
      '<div class="email-item"><span class="email-addr">' + esc(e.email) + '</span>' +
      '<button class="btn btn-danger btn-sm" onclick="removeEmail(\\'' + esc(e.email) + '\\')">Remove</button></div>'
    ).join('');
  } catch (err) { toast(err.message, 'error'); }
}

async function addEmail() {
  const input = document.getElementById('newEmailInput');
  const email = input.value.trim().toLowerCase();
  if (!email) return;
  try {
    await api('/allowed-emails', { method: 'POST', body: JSON.stringify({ email }) });
    input.value = '';
    toast('Email added');
    loadAllowedEmails();
  } catch (err) { toast(err.message, 'error'); }
}

async function removeEmail(email) {
  try {
    await api('/allowed-emails/' + encodeURIComponent(email), { method: 'DELETE' });
    toast('Email removed');
    loadAllowedEmails();
  } catch (err) { toast(err.message, 'error'); }
}

// Auto-login if token exists
if (token) showDashboard();
</script>
</body>
</html>`;
