export function usersTabJs(): string {
  return `/* ═══ USERS TAB ═══════════════════════════════════════════════ */

function loadUsersData() {
  return api('/users').then(function(data) {
    allUsers = data.users;
    renderUsers();
  }).catch(function(err) { toast(err.message, 'error'); });
}

function getFilteredUsers() {
  var search = document.getElementById('userSearch').value.toLowerCase();
  var roleFilter = document.getElementById('userRoleFilter').value;
  var activeFilter = document.getElementById('userActiveFilter').value;
  var sortBy = document.getElementById('userSort').value;

  var filtered = allUsers.filter(function(u) {
    if (search && u.email.toLowerCase().indexOf(search) === -1 && u.displayName.toLowerCase().indexOf(search) === -1) return false;
    if (roleFilter && u.role !== roleFilter) return false;
    if (activeFilter === 'true' && !u.active) return false;
    if (activeFilter === 'false' && u.active) return false;
    return true;
  });

  filtered.sort(function(a, b) {
    if (sortBy === 'email') return a.email.localeCompare(b.email);
    if (sortBy === 'lastLogin') return (b.lastLoginAt || '').localeCompare(a.lastLoginAt || '');
    return (a.createdAt || '').localeCompare(b.createdAt || '');
  });

  return filtered;
}

function renderUsers() {
  var filtered = getFilteredUsers();
  var tbody = document.getElementById('usersBody');
  tbody.innerHTML = filtered.map(function(u) {
    var lastLogin = u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never';
    return '<tr>' +
      '<td><input type="checkbox" class="row-check user-check" data-id="' + esc(u.id) + '"></td>' +
      '<td><a data-action="user-detail" data-id="' + esc(u.id) + '">' + esc(u.email) + '</a></td>' +
      '<td>' + esc(u.displayName) + '</td>' +
      '<td><select data-action="role" data-id="' + esc(u.id) + '">' +
        ['admin','analyst','viewer'].map(function(r) { return '<option value="' + r + '"' + (r === u.role ? ' selected' : '') + '>' + r + '</option>'; }).join('') +
      '</select></td>' +
      '<td><label class="toggle"><input type="checkbox" data-action="active" data-id="' + esc(u.id) + '"' + (u.active ? ' checked' : '') + '><span class="slider"></span></label></td>' +
      '<td>' + lastLogin + '</td>' +
      '<td><button class="btn btn-danger btn-sm" data-action="reset" data-id="' + esc(u.id) + '" data-email="' + esc(u.email) + '">Reset PW</button></td>' +
      '</tr>';
  }).join('');
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="color:#8b949e;font-style:italic;">No users found</td></tr>';
  }
  updateBulkBar();
}

// Filter event listeners
document.getElementById('userSearch').addEventListener('input', function() { renderUsers(); });
document.getElementById('userRoleFilter').addEventListener('change', function() { renderUsers(); });
document.getElementById('userActiveFilter').addEventListener('change', function() { renderUsers(); });
document.getElementById('userSort').addEventListener('change', function() { renderUsers(); });

// Users table event delegation
document.getElementById('usersBody').addEventListener('change', function(e) {
  var el = e.target;
  if (el.dataset.action === 'role') {
    api('/users/' + el.dataset.id, { method: 'PATCH', body: JSON.stringify({ role: el.value }) })
      .then(function() { toast('Role updated'); return loadUsersData(); })
      .catch(function(err) { toast(err.message, 'error'); loadUsersData(); });
  } else if (el.dataset.action === 'active') {
    api('/users/' + el.dataset.id, { method: 'PATCH', body: JSON.stringify({ active: el.checked }) })
      .then(function() { toast(el.checked ? 'User activated' : 'User deactivated'); return loadUsersData(); })
      .catch(function(err) { toast(err.message, 'error'); loadUsersData(); });
  }
  if (el.classList.contains('user-check')) updateBulkBar();
});

document.getElementById('usersBody').addEventListener('click', function(e) {
  var resetBtn = e.target.closest('[data-action="reset"]');
  if (resetBtn) openResetModal(resetBtn.dataset.id, resetBtn.dataset.email);

  var detailLink = e.target.closest('[data-action="user-detail"]');
  if (detailLink) openUserDetail(detailLink.dataset.id);
});

// Check all
document.getElementById('userCheckAll').addEventListener('change', function() {
  var checked = this.checked;
  document.querySelectorAll('.user-check').forEach(function(cb) { cb.checked = checked; });
  updateBulkBar();
});

// ─── Bulk operations ─────────────────────────────────────────

function getSelectedUserIds() {
  var ids = [];
  document.querySelectorAll('.user-check:checked').forEach(function(cb) { ids.push(cb.dataset.id); });
  return ids;
}

function updateBulkBar() {
  var ids = getSelectedUserIds();
  var bar = document.getElementById('usersBulkBar');
  if (ids.length > 0) {
    bar.classList.add('visible');
    document.getElementById('bulkCount').textContent = ids.length;
  } else {
    bar.classList.remove('visible');
  }
}

document.getElementById('bulkSelectAll').addEventListener('click', function() {
  document.querySelectorAll('.user-check').forEach(function(cb) { cb.checked = true; });
  document.getElementById('userCheckAll').checked = true;
  updateBulkBar();
});

document.getElementById('bulkDeselectAll').addEventListener('click', function() {
  document.querySelectorAll('.user-check').forEach(function(cb) { cb.checked = false; });
  document.getElementById('userCheckAll').checked = false;
  updateBulkBar();
});

document.getElementById('bulkChangeRole').addEventListener('click', function() {
  var ids = getSelectedUserIds();
  if (ids.length === 0) return;
  var role = document.getElementById('bulkRoleSelect').value;
  api('/users/bulk', { method: 'POST', body: JSON.stringify({ userIds: ids, action: 'changeRole', role: role }) })
    .then(function(res) { toast('Changed role for ' + res.affected + ' user(s)'); return loadUsersData(); })
    .catch(function(err) { toast(err.message, 'error'); });
});

document.getElementById('bulkEnable').addEventListener('click', function() {
  var ids = getSelectedUserIds();
  if (ids.length === 0) return;
  api('/users/bulk', { method: 'POST', body: JSON.stringify({ userIds: ids, action: 'enable' }) })
    .then(function(res) { toast('Enabled ' + res.affected + ' user(s)'); return loadUsersData(); })
    .catch(function(err) { toast(err.message, 'error'); });
});

document.getElementById('bulkDisable').addEventListener('click', function() {
  var ids = getSelectedUserIds();
  if (ids.length === 0) return;
  api('/users/bulk', { method: 'POST', body: JSON.stringify({ userIds: ids, action: 'disable' }) })
    .then(function(res) { toast('Disabled ' + res.affected + ' user(s)'); return loadUsersData(); })
    .catch(function(err) { toast(err.message, 'error'); });
});

// ─── Create User ─────────────────────────────────────────────

document.getElementById('createUserBtn').addEventListener('click', function() {
  document.getElementById('newUserEmail').value = '';
  document.getElementById('newUserName').value = '';
  document.getElementById('newUserPassword').value = '';
  document.getElementById('newUserRole').value = 'analyst';
  document.getElementById('createUserModal').classList.add('active');
});

document.getElementById('cancelCreateUser').addEventListener('click', function() {
  document.getElementById('createUserModal').classList.remove('active');
});

document.getElementById('submitCreateUser').addEventListener('click', function() {
  var email = document.getElementById('newUserEmail').value.trim();
  var displayName = document.getElementById('newUserName').value.trim();
  var password = document.getElementById('newUserPassword').value;
  var role = document.getElementById('newUserRole').value;
  if (!email) { toast('Email required', 'error'); return; }
  if (!displayName) { toast('Display name required', 'error'); return; }
  if (password.length < 8) { toast('Password must be at least 8 chars', 'error'); return; }
  api('/users', { method: 'POST', body: JSON.stringify({ email: email, displayName: displayName, password: password, role: role }) })
    .then(function() {
      toast('User created');
      document.getElementById('createUserModal').classList.remove('active');
      loadUsersData();
      loadStats();
    })
    .catch(function(err) { toast(err.message, 'error'); });
});

// ─── Export Users ────────────────────────────────────────────

document.getElementById('exportUsersBtn').addEventListener('click', function() {
  apiRaw('/users/export').then(function(r) { return r.blob(); }).then(function(blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'users.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }).catch(function(err) { toast(err.message, 'error'); });
});

// ─── User Detail Panel ──────────────────────────────────────

function openUserDetail(userId) {
  api('/users/' + userId + '/detail').then(function(data) {
    var u = data.user;
    var html = '<h3>' + esc(u.displayName) + '</h3>';
    html += '<div class="info-grid">';
    html += '<span class="lbl">Email</span><span class="val">' + esc(u.email) + '</span>';
    html += '<span class="lbl">Role</span><span class="val">' + esc(u.role) + '</span>';
    html += '<span class="lbl">Active</span><span class="val">' + (u.active ? 'Yes' : 'No') + '</span>';
    html += '<span class="lbl">Last Login</span><span class="val">' + fmtDate(u.lastLoginAt) + '</span>';
    html += '<span class="lbl">Created</span><span class="val">' + fmtDate(u.createdAt) + '</span>';
    html += '</div>';

    // Sessions
    html += '<div class="section"><h4>Active Sessions (' + data.sessions.length + ')</h4>';
    if (data.sessions.length > 0) {
      html += '<button class="btn btn-danger btn-sm" onclick="forceLogoutUser(\\'' + esc(userId) + '\\')">Force Logout</button>';
      html += '<table style="margin-top:0.5rem;"><thead><tr><th>Created</th><th>Expires</th></tr></thead><tbody>';
      data.sessions.forEach(function(s) {
        html += '<tr><td>' + fmtDate(s.createdAt) + '</td><td>' + fmtDate(s.expiresAt) + '</td></tr>';
      });
      html += '</tbody></table>';
    } else {
      html += '<p style="color:#8b949e;font-size:0.85rem;">No active sessions</p>';
    }
    html += '</div>';

    // Memberships
    html += '<div class="section"><h4>Investigation Memberships (' + data.memberships.length + ')</h4>';
    if (data.memberships.length > 0) {
      html += '<table><thead><tr><th>Investigation</th><th>Role</th></tr></thead><tbody>';
      data.memberships.forEach(function(m) {
        html += '<tr><td>' + esc(m.folderName || m.folderId) + '</td><td>' + esc(m.role) + '</td></tr>';
      });
      html += '</tbody></table>';
    } else {
      html += '<p style="color:#8b949e;font-size:0.85rem;">No memberships</p>';
    }
    html += '</div>';

    // Recent Activity
    html += '<div class="section"><h4>Recent Activity (' + data.recentActivity.length + ')</h4>';
    if (data.recentActivity.length > 0) {
      html += '<table><thead><tr><th>Time</th><th>Category</th><th>Action</th><th>Detail</th></tr></thead><tbody>';
      data.recentActivity.forEach(function(a) {
        html += '<tr><td style="white-space:nowrap;">' + fmtDate(a.timestamp) + '</td><td>' + categoryBadge(a.category) + '</td><td>' + esc(a.action) + '</td><td>' + esc(a.detail) + '</td></tr>';
      });
      html += '</tbody></table>';
    } else {
      html += '<p style="color:#8b949e;font-size:0.85rem;">No activity</p>';
    }
    html += '</div>';

    document.getElementById('detailContent').innerHTML = html;
    openDetailPanel();
  }).catch(function(err) { toast(err.message, 'error'); });
}

function forceLogoutUser(userId) {
  api('/sessions/user/' + userId, { method: 'DELETE' })
    .then(function(res) { toast('Logged out ' + res.deletedCount + ' session(s)'); openUserDetail(userId); loadSessions(); })
    .catch(function(err) { toast(err.message, 'error'); });
}

/* ═══ RESET PASSWORD MODAL ════════════════════════════════════ */

var resetUserId = null;

function openResetModal(id, email) {
  resetUserId = id;
  document.getElementById('modalTitle').textContent = 'Reset Password';
  document.getElementById('modalText').textContent = 'Reset password for ' + email + '? This will generate a temporary password.';
  document.getElementById('modalExtraContent').innerHTML = '';
  document.getElementById('confirmModalBtn').style.display = '';
  document.getElementById('confirmModalBtn').textContent = 'Reset';
  document.getElementById('confirmModalBtn').onclick = confirmReset;
  document.getElementById('genericModal').classList.add('active');
}

document.getElementById('closeModalBtn').addEventListener('click', function() { closeGenericModal(); });

function closeGenericModal() {
  document.getElementById('genericModal').classList.remove('active');
  resetUserId = null;
}

function confirmReset() {
  if (!resetUserId) return;
  api('/users/' + resetUserId + '/reset-password', { method: 'POST' })
    .then(function(res) {
      document.getElementById('modalText').textContent = 'Temporary password (share securely):';
      document.getElementById('modalExtraContent').innerHTML = '<div class="temp-password">' + esc(res.temporaryPassword) + '</div>';
      document.getElementById('confirmModalBtn').style.display = 'none';
      toast('Password reset');
    })
    .catch(function(err) { toast(err.message, 'error'); closeGenericModal(); });
}`;
}
