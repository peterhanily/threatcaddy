export function adminAccountsTabJs(): string {
  return `/* ═══ ADMIN ACCOUNTS TAB ══════════════════════════════════════ */

function loadAdminAccounts() {
  return api('/admin-accounts').then(function(data) {
    var body = document.getElementById('adminsBody');
    if (!data.accounts || data.accounts.length === 0) {
      body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#8b949e;">No admin accounts</td></tr>';
      return;
    }
    body.innerHTML = data.accounts.map(function(a) {
      var isSelf = currentAdmin && currentAdmin.id === a.id;
      return '<tr' + (isSelf ? ' class="self-row"' : '') + '>' +
        '<td>' + esc(a.username) + (isSelf ? ' <span class="badge badge-blue">you</span>' : '') + '</td>' +
        '<td>' + esc(a.displayName) + '</td>' +
        '<td>' + (a.active ? '<span class="badge badge-green">Active</span>' : '<span class="badge badge-gray">Disabled</span>') + '</td>' +
        '<td>' + fmtDate(a.lastLoginAt) + '</td>' +
        '<td>' + fmtShortDate(a.createdAt) + '</td>' +
        '<td>' +
          (isSelf
            ? '<button class="btn btn-primary btn-sm" onclick="changeMyPassword()">Change My Password</button>'
            : '<button class="btn btn-outline btn-sm" onclick="resetAdminPassword(\\'' + a.id + '\\',\\'' + esc(a.username) + '\\')">Reset Password</button> ' +
              (a.active
                ? '<button class="btn btn-warning btn-sm" onclick="toggleAdmin(\\'' + a.id + '\\',false)">Disable</button> '
                : '<button class="btn btn-primary btn-sm" onclick="toggleAdmin(\\'' + a.id + '\\',true)">Enable</button> ') +
              '<button class="btn btn-danger btn-sm" onclick="deleteAdmin(\\'' + a.id + '\\',\\'' + esc(a.username) + '\\')">Delete</button>'
          ) +
        '</td>' +
      '</tr>';
    }).join('');
  }).catch(function(err) { toast(err.message, 'error'); });
}

/* ─── Create Admin ────────────────────────────────────────── */

document.getElementById('createAdminBtn').addEventListener('click', function() {
  document.getElementById('newAdminUsername').value = '';
  document.getElementById('newAdminDisplayName').value = '';
  document.getElementById('newAdminPassword').value = '';
  document.getElementById('createAdminModal').classList.add('active');
});

document.getElementById('cancelCreateAdmin').addEventListener('click', function() {
  document.getElementById('createAdminModal').classList.remove('active');
});

document.getElementById('submitCreateAdmin').addEventListener('click', function() {
  var username = document.getElementById('newAdminUsername').value.trim();
  var displayName = document.getElementById('newAdminDisplayName').value.trim();
  var password = document.getElementById('newAdminPassword').value;

  if (!username || username.length < 2) { toast('Username must be at least 2 characters', 'error'); return; }
  if (!displayName) { toast('Display name required', 'error'); return; }
  if (password.length < 12) { toast('Password must be at least 12 characters', 'error'); return; }

  api('/admin-accounts', {
    method: 'POST',
    body: JSON.stringify({ username: username, displayName: displayName, password: password })
  }).then(function() {
    document.getElementById('createAdminModal').classList.remove('active');
    toast('Admin account created');
    loadAdminAccounts();
  }).catch(function(err) { toast(err.message, 'error'); });
});

/* ─── Toggle Active ───────────────────────────────────────── */

function toggleAdmin(id, active) {
  api('/admin-accounts/' + id, {
    method: 'PATCH',
    body: JSON.stringify({ active: active })
  }).then(function() {
    toast(active ? 'Admin account enabled' : 'Admin account disabled');
    loadAdminAccounts();
  }).catch(function(err) { toast(err.message, 'error'); });
}

/* ─── Reset Password ──────────────────────────────────────── */

function resetAdminPassword(id, username) {
  var newPw = prompt('New password for "' + username + '" (min 12 chars):');
  if (!newPw) return;
  if (newPw.length < 12) { toast('Password must be at least 12 characters', 'error'); return; }

  api('/admin-accounts/' + id + '/reset-password', {
    method: 'POST',
    body: JSON.stringify({ password: newPw })
  }).then(function() {
    toast('Password reset successfully');
  }).catch(function(err) { toast(err.message, 'error'); });
}

/* ─── Delete Admin ────────────────────────────────────────── */

function deleteAdmin(id, username) {
  if (!confirm('Delete admin account "' + username + '"? This cannot be undone.')) return;
  api('/admin-accounts/' + id, { method: 'DELETE' })
    .then(function() { toast('Admin account deleted'); loadAdminAccounts(); })
    .catch(function(err) { toast(err.message, 'error'); });
}

/* ─── Change My Password ─────────────────────────────────────── */

function changeMyPassword() {
  var content = document.getElementById('modalExtraContent');
  content.innerHTML = '<div class="form-group"><label>Current Password</label>' +
    '<input type="password" id="myCurrentPw" autocomplete="current-password"></div>' +
    '<div class="form-group"><label>New Password (min 12 chars)</label>' +
    '<input type="password" id="myNewPw" autocomplete="new-password"></div>' +
    '<div class="form-group"><label>Confirm New Password</label>' +
    '<input type="password" id="myConfirmPw" autocomplete="new-password"></div>';
  document.getElementById('modalTitle').textContent = 'Change My Password';
  document.getElementById('modalText').textContent = '';
  var confirmBtn = document.getElementById('confirmModalBtn');
  confirmBtn.textContent = 'Change Password';
  confirmBtn.className = 'btn btn-primary btn-sm';
  confirmBtn.onclick = function() {
    var cur = document.getElementById('myCurrentPw').value;
    var nw = document.getElementById('myNewPw').value;
    var conf = document.getElementById('myConfirmPw').value;
    if (!cur) { toast('Current password required', 'error'); return; }
    if (nw.length < 12) { toast('New password must be at least 12 characters', 'error'); return; }
    if (nw !== conf) { toast('Passwords do not match', 'error'); return; }
    api('/admin-accounts/me/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: cur, newPassword: nw })
    }).then(function() {
      document.getElementById('genericModal').classList.remove('active');
      toast('Password changed successfully');
    }).catch(function(err) { toast(err.message, 'error'); });
  };
  document.getElementById('genericModal').classList.add('active');
}`;
}
