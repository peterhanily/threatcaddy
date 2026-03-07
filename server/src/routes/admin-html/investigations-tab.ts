export function investigationsTabJs(): string {
  return `/* ═══ INVESTIGATIONS TAB ══════════════════════════════════════ */

function loadInvestigationsData() {
  return api('/investigations').then(function(data) {
    allInvestigations = data.investigations;
    renderInvestigations();
    // Also populate audit log folder filter
    var sel = document.getElementById('auditFolderFilter');
    sel.innerHTML = '<option value="">All Investigations</option>';
    data.investigations.forEach(function(inv) {
      sel.innerHTML += '<option value="' + esc(inv.id) + '">' + esc(inv.name) + '</option>';
    });
  }).catch(function(err) { toast(err.message, 'error'); });
}

function getFilteredInvestigations() {
  var search = document.getElementById('invSearch').value.toLowerCase();
  var statusFilter = document.getElementById('invStatusFilter').value;

  return allInvestigations.filter(function(inv) {
    if (search && inv.name.toLowerCase().indexOf(search) === -1) return false;
    if (statusFilter && (inv.status || 'active') !== statusFilter) return false;
    return true;
  });
}

function renderInvestigations() {
  var filtered = getFilteredInvestigations();
  var tbody = document.getElementById('investigationsBody');
  tbody.innerHTML = filtered.map(function(inv) {
    var created = fmtShortDate(inv.createdAt);
    return '<tr>' +
      '<td><a data-action="inv-detail" data-id="' + esc(inv.id) + '">' + esc(inv.name) + '</a></td>' +
      '<td>' + statusBadge(inv.status) + '</td>' +
      '<td>' + esc(inv.creatorName) + ' <span style="color:#8b949e">(' + esc(inv.creatorEmail) + ')</span></td>' +
      '<td>' + inv.memberCount + '</td>' +
      '<td>' + created + '</td>' +
      '</tr>';
  }).join('');
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="color:#8b949e;font-style:italic;">No investigations found</td></tr>';
  }
}

document.getElementById('invSearch').addEventListener('input', function() { renderInvestigations(); });
document.getElementById('invStatusFilter').addEventListener('change', function() { renderInvestigations(); });

document.getElementById('investigationsBody').addEventListener('click', function(e) {
  var link = e.target.closest('[data-action="inv-detail"]');
  if (link) openInvestigationDetail(link.dataset.id);
});

// ─── Investigation Detail Panel ─────────────────────────────

var currentInvId = null;
var currentInvName = null;

function openInvestigationDetail(invId) {
  currentInvId = invId;
  api('/investigations/' + invId + '/detail').then(function(data) {
    var inv = data.investigation;
    currentInvName = inv.name;
    var ec = data.entityCounts;

    var html = '<h3>' + esc(inv.name) + '</h3>';
    html += '<div class="info-grid">';
    html += '<span class="lbl">Status</span><span class="val"><select id="invStatusSelect">';
    ['active','closed','archived'].forEach(function(s) {
      html += '<option value="' + s + '"' + ((inv.status||'active')===s?' selected':'') + '>' + s + '</option>';
    });
    html += '</select></span>';
    html += '<span class="lbl">Creator</span><span class="val">' + esc(inv.creatorName) + ' (' + esc(inv.creatorEmail) + ')</span>';
    html += '<span class="lbl">Created</span><span class="val">' + fmtDate(inv.createdAt) + '</span>';
    if (inv.description) html += '<span class="lbl">Description</span><span class="val">' + esc(inv.description) + '</span>';
    html += '</div>';

    // Entity counts
    html += '<div class="section"><h4>Content</h4>';
    html += '<div class="info-grid">';
    html += '<span class="lbl">Notes</span><span class="val">' + ec.notes + '</span>';
    html += '<span class="lbl">Tasks</span><span class="val">' + ec.tasks + '</span>';
    html += '<span class="lbl">Timeline Events</span><span class="val">' + ec.timelineEvents + '</span>';
    html += '<span class="lbl">Whiteboards</span><span class="val">' + ec.whiteboards + '</span>';
    html += '<span class="lbl">IOCs</span><span class="val">' + ec.standaloneIOCs + '</span>';
    html += '<span class="lbl">Chat Threads</span><span class="val">' + ec.chatThreads + '</span>';
    html += '<span class="lbl">Files</span><span class="val">' + ec.files + '</span>';
    html += '</div></div>';

    // Members
    html += '<div class="section"><h4>Members (' + data.members.length + ')</h4>';
    html += '<div style="margin-bottom:0.5rem;display:flex;gap:0.5rem;align-items:center;">';
    html += '<select id="addMemberUserId">';
    html += '<option value="">Add member...</option>';
    allUsers.forEach(function(u) {
      var isMember = data.members.some(function(m) { return m.userId === u.id; });
      if (!isMember) html += '<option value="' + esc(u.id) + '">' + esc(u.email) + '</option>';
    });
    html += '</select>';
    html += '<select id="addMemberRole"><option value="editor">Editor</option><option value="viewer">Viewer</option><option value="owner">Owner</option></select>';
    html += '<button class="btn btn-primary btn-sm" id="addMemberBtn">Add</button>';
    html += '</div>';
    if (data.members.length > 0) {
      html += '<table><thead><tr><th>User</th><th>Role</th><th>Joined</th><th></th></tr></thead><tbody>';
      data.members.forEach(function(m) {
        html += '<tr>';
        html += '<td>' + esc(m.userEmail || m.userId) + '</td>';
        html += '<td><select data-action="member-role" data-uid="' + esc(m.userId) + '">';
        ['owner','editor','viewer'].forEach(function(r) {
          html += '<option value="' + r + '"' + (r===m.role?' selected':'') + '>' + r + '</option>';
        });
        html += '</select></td>';
        html += '<td>' + fmtShortDate(m.joinedAt) + '</td>';
        html += '<td><button class="btn btn-danger btn-sm" data-action="remove-member" data-uid="' + esc(m.userId) + '">Remove</button></td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
    }
    html += '</div>';

    // Danger Zone
    var totalEntities = ec.notes + ec.tasks + ec.timelineEvents + ec.whiteboards + ec.standaloneIOCs + ec.chatThreads + ec.files;
    html += '<div class="danger-zone"><h4>Danger Zone</h4>';
    html += '<p>Permanently delete all content (' + totalEntities + ' entities) from this investigation.</p>';
    html += '<button class="btn btn-danger btn-sm" id="openPurgeBtn"' + (totalEntities === 0 ? ' disabled' : '') + '>Purge All Content</button>';
    html += '</div>';

    document.getElementById('detailContent').innerHTML = html;
    openDetailPanel();

    // Status change
    document.getElementById('invStatusSelect').addEventListener('change', function() {
      api('/investigations/' + invId, { method: 'PATCH', body: JSON.stringify({ status: this.value }) })
        .then(function() { toast('Status updated'); loadInvestigationsData(); })
        .catch(function(err) { toast(err.message, 'error'); });
    });

    // Add member
    document.getElementById('addMemberBtn').addEventListener('click', function() {
      var uid = document.getElementById('addMemberUserId').value;
      var role = document.getElementById('addMemberRole').value;
      if (!uid) return;
      api('/investigations/' + invId + '/members', { method: 'POST', body: JSON.stringify({ userId: uid, role: role }) })
        .then(function() { toast('Member added'); openInvestigationDetail(invId); })
        .catch(function(err) { toast(err.message, 'error'); });
    });

    // Member role change / remove (delegation on detail content)
    document.getElementById('detailContent').addEventListener('change', function(e) {
      if (e.target.dataset.action === 'member-role') {
        api('/investigations/' + invId + '/members/' + e.target.dataset.uid, { method: 'PATCH', body: JSON.stringify({ role: e.target.value }) })
          .then(function() { toast('Role updated'); })
          .catch(function(err) { toast(err.message, 'error'); openInvestigationDetail(invId); });
      }
    });

    document.getElementById('detailContent').addEventListener('click', function(e) {
      var rmBtn = e.target.closest('[data-action="remove-member"]');
      if (rmBtn) {
        api('/investigations/' + invId + '/members/' + rmBtn.dataset.uid, { method: 'DELETE' })
          .then(function() { toast('Member removed'); openInvestigationDetail(invId); })
          .catch(function(err) { toast(err.message, 'error'); });
      }
    });

    // Purge
    var purgeBtn = document.getElementById('openPurgeBtn');
    if (purgeBtn) {
      purgeBtn.addEventListener('click', function() {
        openPurgeModal(invId, inv.name, ec);
      });
    }
  }).catch(function(err) { toast(err.message, 'error'); });
}

// ─── Purge modal ─────────────────────────────────────────────

function openPurgeModal(invId, invName, ec) {
  document.getElementById('purgeEntityCounts').innerHTML =
    '<strong>This will delete:</strong><br>' +
    ec.notes + ' notes, ' + ec.tasks + ' tasks, ' + ec.timelineEvents + ' timeline events, ' +
    ec.whiteboards + ' whiteboards, ' + ec.standaloneIOCs + ' IOCs, ' + ec.chatThreads + ' chat threads, ' + ec.files + ' files';
  document.getElementById('purgeConfirmInput').value = '';
  document.getElementById('purgeConfirmInput').placeholder = invName;
  document.getElementById('confirmPurge').disabled = true;
  document.getElementById('purgeModal').classList.add('active');

  document.getElementById('purgeConfirmInput').oninput = function() {
    document.getElementById('confirmPurge').disabled = this.value !== invName;
  };

  document.getElementById('confirmPurge').onclick = function() {
    api('/investigations/' + invId + '/content', { method: 'DELETE', body: JSON.stringify({ confirmName: invName }) })
      .then(function(res) {
        toast('Content purged');
        document.getElementById('purgeModal').classList.remove('active');
        openInvestigationDetail(invId);
        loadInvestigationsData();
      })
      .catch(function(err) { toast(err.message, 'error'); });
  };
}

document.getElementById('cancelPurge').addEventListener('click', function() {
  document.getElementById('purgeModal').classList.remove('active');
});`;
}
