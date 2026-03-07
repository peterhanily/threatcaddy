export function auditTabJs(): string {
  return `/* ═══ AUDIT LOG TAB ═══════════════════════════════════════════ */

var auditPage = 1;
var auditTotal = 0;

function loadAuditLog() {
  var pageSize = parseInt(document.getElementById('auditPageSize').value, 10);
  var params = 'page=' + auditPage + '&pageSize=' + pageSize;
  var userId = document.getElementById('auditUserFilter').value;
  var category = document.getElementById('auditCategoryFilter').value;
  var action = document.getElementById('auditActionFilter').value.trim();
  var folderId = document.getElementById('auditFolderFilter').value;
  var dateFrom = document.getElementById('auditDateFrom').value;
  var dateTo = document.getElementById('auditDateTo').value;
  var search = document.getElementById('auditSearchFilter').value.trim();

  if (userId) params += '&userId=' + encodeURIComponent(userId);
  if (category) params += '&category=' + encodeURIComponent(category);
  if (action) params += '&action=' + encodeURIComponent(action);
  if (folderId) params += '&folderId=' + encodeURIComponent(folderId);
  if (dateFrom) params += '&dateFrom=' + encodeURIComponent(dateFrom + 'T00:00:00Z');
  if (dateTo) params += '&dateTo=' + encodeURIComponent(dateTo + 'T23:59:59Z');
  if (search) params += '&search=' + encodeURIComponent(search);

  api('/audit-log?' + params).then(function(data) {
    auditTotal = data.total;
    var totalPages = Math.max(1, Math.ceil(data.total / pageSize));
    document.getElementById('auditPageInfo').textContent = 'Page ' + data.page + ' of ' + totalPages + ' (' + data.total + ' entries)';
    document.getElementById('auditPrev').disabled = data.page <= 1;
    document.getElementById('auditNext').disabled = data.page >= totalPages;

    var tbody = document.getElementById('auditBody');
    tbody.innerHTML = data.entries.map(function(e) {
      return '<tr>' +
        '<td style="white-space:nowrap;">' + fmtDate(e.timestamp) + '</td>' +
        '<td>' + esc(e.userEmail || e.userId || '') + '</td>' +
        '<td>' + categoryBadge(e.category) + '</td>' +
        '<td>' + esc(e.action) + '</td>' +
        '<td>' + esc(e.detail) + '</td>' +
        '<td>' + esc(e.folderName || '') + '</td>' +
        '</tr>';
    }).join('');
    if (data.entries.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="color:#8b949e;font-style:italic;">No entries found</td></tr>';
    }
  }).catch(function(err) { toast(err.message, 'error'); });

  // Populate user filter if empty
  if (document.getElementById('auditUserFilter').options.length <= 1) {
    allUsers.forEach(function(u) {
      var opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = u.email;
      document.getElementById('auditUserFilter').appendChild(opt);
    });
  }
}

document.getElementById('auditApplyBtn').addEventListener('click', function() {
  auditPage = 1;
  loadAuditLog();
});

document.getElementById('auditPrev').addEventListener('click', function() {
  if (auditPage > 1) { auditPage--; loadAuditLog(); }
});

document.getElementById('auditNext').addEventListener('click', function() {
  auditPage++;
  loadAuditLog();
});

document.getElementById('auditPageSize').addEventListener('change', function() {
  auditPage = 1;
  loadAuditLog();
});

document.getElementById('auditExportBtn').addEventListener('click', function() {
  var params = '';
  var userId = document.getElementById('auditUserFilter').value;
  var category = document.getElementById('auditCategoryFilter').value;
  var action = document.getElementById('auditActionFilter').value.trim();
  var folderId = document.getElementById('auditFolderFilter').value;
  var dateFrom = document.getElementById('auditDateFrom').value;
  var dateTo = document.getElementById('auditDateTo').value;
  var search = document.getElementById('auditSearchFilter').value.trim();

  var parts = [];
  if (userId) parts.push('userId=' + encodeURIComponent(userId));
  if (category) parts.push('category=' + encodeURIComponent(category));
  if (action) parts.push('action=' + encodeURIComponent(action));
  if (folderId) parts.push('folderId=' + encodeURIComponent(folderId));
  if (dateFrom) parts.push('dateFrom=' + encodeURIComponent(dateFrom + 'T00:00:00Z'));
  if (dateTo) parts.push('dateTo=' + encodeURIComponent(dateTo + 'T23:59:59Z'));
  if (search) parts.push('search=' + encodeURIComponent(search));
  if (parts.length > 0) params = '?' + parts.join('&');

  apiRaw('/audit-log/export' + params).then(function(r) { return r.blob(); }).then(function(blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'audit-log.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }).catch(function(err) { toast(err.message, 'error'); });
});

/* ═══ SESSIONS TAB ════════════════════════════════════════════ */

function loadSessions() {
  api('/sessions').then(function(data) {
    var tbody = document.getElementById('sessionsBody');
    tbody.innerHTML = data.sessions.map(function(s) {
      return '<tr>' +
        '<td>' + esc(s.userEmail || '') + '</td>' +
        '<td>' + esc(s.userDisplayName || '') + '</td>' +
        '<td>' + fmtDate(s.createdAt) + '</td>' +
        '<td>' + fmtDate(s.expiresAt) + '</td>' +
        '<td><button class="btn btn-danger btn-sm" data-action="force-logout" data-uid="' + esc(s.userId) + '">Force Logout</button></td>' +
        '</tr>';
    }).join('');
    if (data.sessions.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="color:#8b949e;font-style:italic;">No active sessions</td></tr>';
    }
  }).catch(function(err) { toast(err.message, 'error'); });
}

document.getElementById('sessionsBody').addEventListener('click', function(e) {
  var btn = e.target.closest('[data-action="force-logout"]');
  if (btn) {
    api('/sessions/user/' + btn.dataset.uid, { method: 'DELETE' })
      .then(function(res) { toast('Logged out ' + res.deletedCount + ' session(s)'); loadSessions(); loadStats(); })
      .catch(function(err) { toast(err.message, 'error'); });
  }
});

document.getElementById('forceLogoutAllBtn').addEventListener('click', function() {
  document.getElementById('modalTitle').textContent = 'Force Logout All Users';
  document.getElementById('modalText').textContent = 'This will terminate ALL active user sessions. Are you sure?';
  document.getElementById('modalExtraContent').innerHTML = '';
  document.getElementById('confirmModalBtn').style.display = '';
  document.getElementById('confirmModalBtn').textContent = 'Logout All';
  document.getElementById('confirmModalBtn').onclick = function() {
    api('/sessions/all', { method: 'DELETE' })
      .then(function(res) { toast('Logged out ' + res.deletedCount + ' session(s)'); closeGenericModal(); loadSessions(); loadStats(); })
      .catch(function(err) { toast(err.message, 'error'); closeGenericModal(); });
  };
  document.getElementById('genericModal').classList.add('active');
});`;
}
