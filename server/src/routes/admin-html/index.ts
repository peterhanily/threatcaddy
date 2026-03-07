import { adminStyles } from './styles.js';
import { sharedJs } from './shared-js.js';
import { usersTabJs } from './users-tab.js';
import { investigationsTabJs } from './investigations-tab.js';
import { botsTabJs } from './bots-tab.js';
import { auditTabJs } from './audit-tab.js';
import { settingsTabJs } from './settings-tab.js';

export function getAdminHtml(nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Admin Panel</title>
<style>
${adminStyles()}
</style>
</head>
<body>

<!-- ═══ LOGIN ═══════════════════════════════════════════════════ -->
<div id="login" class="login-container">
  <div class="login-box">
    <h1>Admin Panel</h1>
    <form id="loginForm">
      <div class="form-group">
        <label for="secret">Admin Secret</label>
        <input type="password" id="secret" placeholder="Enter admin secret" autocomplete="off" required>
      </div>
      <div id="loginError" class="error-msg"></div>
      <button type="submit" class="btn btn-primary full-width">Sign In</button>
    </form>
  </div>
</div>

<!-- ═══ DASHBOARD ═══════════════════════════════════════════════ -->
<div id="dashboard" class="dashboard">
  <div class="header">
    <h1>Admin Panel</h1>
    <button id="logoutBtn" class="btn btn-outline btn-sm">Sign Out</button>
  </div>

  <div class="tab-bar">
    <button class="tab-btn active" data-tab="tab-dashboard">Dashboard</button>
    <button class="tab-btn" data-tab="tab-users">Users</button>
    <button class="tab-btn" data-tab="tab-investigations">Investigations</button>
    <button class="tab-btn" data-tab="tab-audit">Audit Log</button>
    <button class="tab-btn" data-tab="tab-sessions">Sessions</button>
    <button class="tab-btn" data-tab="tab-bots">Bots</button>
  </div>

  <!-- ─── Dashboard Tab ──────────────────────────────────── -->
  <div id="tab-dashboard" class="tab-content active">
    <div class="stats" id="statsGrid"></div>

    <div class="settings-section">
      <h2>Server Identity</h2>
      <div class="setting-row">
        <label>Server Name</label>
        <div style="display:flex;gap:8px;align-items:center">
          <input type="text" id="serverNameInput" maxlength="100" style="flex:1">
          <button id="saveServerNameBtn" class="btn btn-primary btn-sm">Save</button>
        </div>
      </div>
    </div>

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
      <h2>Data Retention</h2>
      <div class="setting-row">
        <label>Notifications (days)</label>
        <input type="number" id="notifRetention" min="1" max="3650" value="90">
      </div>
      <div class="setting-row">
        <label>Audit log (days)</label>
        <input type="number" id="auditRetention" min="1" max="3650" value="365">
        <button id="saveRetentionBtn" class="btn btn-primary btn-sm">Save</button>
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
  </div>

  <!-- ─── Users Tab ──────────────────────────────────────── -->
  <div id="tab-users" class="tab-content">
    <div class="filter-bar">
      <input type="text" id="userSearch" placeholder="Search email/name...">
      <select id="userRoleFilter">
        <option value="">All Roles</option>
        <option value="admin">Admin</option>
        <option value="analyst">Analyst</option>
        <option value="viewer">Viewer</option>
      </select>
      <select id="userActiveFilter">
        <option value="">All Status</option>
        <option value="true">Active</option>
        <option value="false">Disabled</option>
      </select>
      <select id="userSort">
        <option value="created">Created</option>
        <option value="email">Email</option>
        <option value="lastLogin">Last Login</option>
      </select>
      <div style="flex:1;"></div>
      <button id="createUserBtn" class="btn btn-primary btn-sm">Create User</button>
      <button id="exportUsersBtn" class="btn btn-outline btn-sm">Export CSV</button>
    </div>

    <div id="usersBulkBar" class="bulk-bar">
      <span class="count" id="bulkCount">0</span> selected
      <button id="bulkSelectAll" class="btn btn-outline btn-sm">Select All</button>
      <button id="bulkDeselectAll" class="btn btn-outline btn-sm">Deselect All</button>
      <select id="bulkRoleSelect">
        <option value="admin">Admin</option>
        <option value="analyst">Analyst</option>
        <option value="viewer">Viewer</option>
      </select>
      <button id="bulkChangeRole" class="btn btn-outline btn-sm">Change Role</button>
      <button id="bulkEnable" class="btn btn-primary btn-sm">Enable</button>
      <button id="bulkDisable" class="btn btn-danger btn-sm">Disable</button>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th style="width:30px;"><input type="checkbox" id="userCheckAll" class="row-check"></th>
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
  </div>

  <!-- ─── Investigations Tab ─────────────────────────────── -->
  <div id="tab-investigations" class="tab-content">
    <div class="filter-bar">
      <input type="text" id="invSearch" placeholder="Search name...">
      <select id="invStatusFilter">
        <option value="">All Status</option>
        <option value="active">Active</option>
        <option value="closed">Closed</option>
        <option value="archived">Archived</option>
      </select>
    </div>
    <div class="table-wrap">
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
  </div>

  <!-- ─── Audit Log Tab ──────────────────────────────────── -->
  <div id="tab-audit" class="tab-content">
    <div class="filter-bar">
      <select id="auditUserFilter"><option value="">All Users</option></select>
      <select id="auditCategoryFilter">
        <option value="">All Categories</option>
        <option value="admin">admin</option>
        <option value="auth">auth</option>
        <option value="note">note</option>
        <option value="task">task</option>
        <option value="investigation">investigation</option>
        <option value="timeline">timeline</option>
        <option value="whiteboard">whiteboard</option>
        <option value="ioc">ioc</option>
        <option value="chat">chat</option>
        <option value="file">file</option>
      </select>
      <input type="text" id="auditActionFilter" placeholder="Action...">
      <select id="auditFolderFilter"><option value="">All Investigations</option></select>
      <input type="date" id="auditDateFrom">
      <input type="date" id="auditDateTo">
      <input type="text" id="auditSearchFilter" placeholder="Search detail...">
      <button id="auditApplyBtn" class="btn btn-primary btn-sm">Apply</button>
      <button id="auditExportBtn" class="btn btn-outline btn-sm">Export CSV</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>User</th>
            <th>Category</th>
            <th>Action</th>
            <th>Detail</th>
            <th>Investigation</th>
          </tr>
        </thead>
        <tbody id="auditBody"></tbody>
      </table>
    </div>
    <div class="pagination" id="auditPagination">
      <button id="auditPrev" class="btn btn-outline btn-sm" disabled>Prev</button>
      <span id="auditPageInfo">Page 1</span>
      <button id="auditNext" class="btn btn-outline btn-sm">Next</button>
      <select id="auditPageSize">
        <option value="25">25</option>
        <option value="50" selected>50</option>
        <option value="100">100</option>
      </select>
      <span>per page</span>
    </div>
  </div>

  <!-- ─── Sessions Tab ───────────────────────────────────── -->
  <div id="tab-sessions" class="tab-content">
    <div style="margin-bottom:1rem;">
      <button id="forceLogoutAllBtn" class="btn btn-danger btn-sm">Force Logout All Users</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>User Email</th>
            <th>Display Name</th>
            <th>Session Created</th>
            <th>Expires</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="sessionsBody"></tbody>
      </table>
    </div>
  </div>

  <!-- ─── Bots Tab ──────────────────────────────────────────── -->
  <div id="tab-bots" class="tab-content">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
      <h2 style="font-size:1rem;color:#c9d1d9;">Bot Management</h2>
      <button id="createBotBtn" class="btn btn-primary btn-sm">+ Create Bot</button>
    </div>
    <div class="filter-bar">
      <input type="text" id="botSearch" placeholder="Search bots..." style="min-width:200px;">
      <select id="botTypeFilter">
        <option value="">All types</option>
        <option value="enrichment">Enrichment</option>
        <option value="feed">Feed</option>
        <option value="monitor">Monitor</option>
        <option value="triage">Triage</option>
        <option value="report">Report</option>
        <option value="correlation">Correlation</option>
        <option value="ai-agent">AI Agent</option>
        <option value="custom">Custom</option>
      </select>
      <select id="botStatusFilter">
        <option value="">All status</option>
        <option value="enabled">Enabled</option>
        <option value="disabled">Disabled</option>
      </select>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Status</th>
            <th>Scope</th>
            <th>Runs</th>
            <th>Errors</th>
            <th>Last Run</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="botsBody"></tbody>
      </table>
    </div>
  </div>
</div>

<!-- ═══ TOASTS ═══════════════════════════════════════════════════ -->
<div class="toast-container" id="toasts"></div>

<!-- ═══ MODALS ═══════════════════════════════════════════════════ -->

<!-- Generic modal (reset password, confirmations) -->
<div id="genericModal" class="modal-overlay">
  <div class="modal">
    <h3 id="modalTitle">Confirm</h3>
    <p id="modalText"></p>
    <div id="modalExtraContent"></div>
    <div class="modal-actions">
      <button id="closeModalBtn" class="btn btn-outline btn-sm">Close</button>
      <button id="confirmModalBtn" class="btn btn-danger btn-sm">Confirm</button>
    </div>
  </div>
</div>

<!-- Create User modal -->
<div id="createUserModal" class="modal-overlay">
  <div class="modal">
    <h3>Create User</h3>
    <div class="form-group">
      <label>Email</label>
      <input type="email" id="newUserEmail" placeholder="user@example.com">
    </div>
    <div class="form-group">
      <label>Display Name</label>
      <input type="text" id="newUserName" placeholder="Display name" maxlength="15">
    </div>
    <div class="form-group">
      <label>Password (min 8 chars)</label>
      <input type="password" id="newUserPassword" placeholder="Password">
    </div>
    <div class="form-group">
      <label>Role</label>
      <select id="newUserRole">
        <option value="analyst">Analyst</option>
        <option value="admin">Admin</option>
        <option value="viewer">Viewer</option>
      </select>
    </div>
    <div class="modal-actions">
      <button id="cancelCreateUser" class="btn btn-outline btn-sm">Cancel</button>
      <button id="submitCreateUser" class="btn btn-primary btn-sm">Create</button>
    </div>
  </div>
</div>

<!-- Purge Confirmation modal -->
<div id="purgeModal" class="modal-overlay">
  <div class="modal">
    <h3 style="color:#f85149;">Purge All Content</h3>
    <p>This will permanently delete ALL content from this investigation. The investigation and its members will be kept.</p>
    <div id="purgeEntityCounts" style="margin-bottom:1rem;font-size:0.85rem;color:#c9d1d9;"></div>
    <div class="form-group">
      <label>Type the investigation name to confirm:</label>
      <input type="text" id="purgeConfirmInput" placeholder="">
    </div>
    <div class="modal-actions">
      <button id="cancelPurge" class="btn btn-outline btn-sm">Cancel</button>
      <button id="confirmPurge" class="btn btn-danger btn-sm" disabled>Purge</button>
    </div>
  </div>
</div>

<!-- Create Bot Modal -->
<div id="createBotModal" class="modal-overlay">
  <div class="modal" style="max-width:600px;">
    <h3>Create Bot</h3>
    <div class="form-group">
      <label>Name *</label>
      <input type="text" id="newBotName" placeholder="e.g. IOC Enricher" maxlength="100">
    </div>
    <div class="form-group">
      <label>Description</label>
      <input type="text" id="newBotDesc" placeholder="What does this bot do?">
    </div>
    <div class="form-group">
      <label>Type *</label>
      <select id="newBotType">
        <option value="enrichment">Enrichment</option>
        <option value="feed">Feed</option>
        <option value="monitor">Monitor</option>
        <option value="triage">Triage</option>
        <option value="report">Report</option>
        <option value="correlation">Correlation</option>
        <option value="ai-agent">AI Agent</option>
        <option value="custom">Custom</option>
      </select>
    </div>
    <div class="form-group">
      <label>Capabilities</label>
      <div class="checkbox-grid">
        <label><input type="checkbox" class="bot-cap-check" value="read_entities"> Read Entities</label>
        <label><input type="checkbox" class="bot-cap-check" value="create_entities"> Create Entities</label>
        <label><input type="checkbox" class="bot-cap-check" value="update_entities"> Update Entities</label>
        <label><input type="checkbox" class="bot-cap-check" value="post_to_feed"> Post to Feed</label>
        <label><input type="checkbox" class="bot-cap-check" value="notify_users"> Notify Users</label>
        <label><input type="checkbox" class="bot-cap-check" value="call_external_apis"> Call External APIs</label>
        <label><input type="checkbox" class="bot-cap-check" value="cross_investigation"> Cross Investigation</label>
        <label><input type="checkbox" class="bot-cap-check" value="execute_remote"> Execute Remote</label>
      </div>
    </div>
    <div id="aiAgentConfigGroup" style="display:none;">
      <div class="form-group">
        <label>LLM Provider</label>
        <select id="newBotLlmProvider">
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="openai">OpenAI</option>
          <option value="gemini">Google Gemini</option>
          <option value="mistral">Mistral</option>
        </select>
      </div>
      <div class="form-group">
        <label>LLM Model</label>
        <input type="text" id="newBotLlmModel" placeholder="e.g. claude-sonnet-4-20250514">
      </div>
      <div class="form-group">
        <label>System Prompt</label>
        <textarea id="newBotSystemPrompt" rows="4" placeholder="Custom instructions for the AI agent..."
          style="font-size:0.85rem;resize:vertical;"></textarea>
        <span style="font-size:0.75rem;color:#8b949e;">Appended to the agent's built-in system prompt.</span>
      </div>
      <div class="form-group">
        <label>Max Iterations</label>
        <input type="number" id="newBotMaxIter" value="10" min="1" max="25">
        <span style="font-size:0.75rem;color:#8b949e;">Max tool-calling loops per run (hard cap: 25)</span>
      </div>
    </div>
    <div class="form-group">
      <label>Bot Config (JSON)</label>
      <textarea id="newBotConfig" rows="4" placeholder='{"apiKey": "...", "baseUrl": "..."}'
        style="font-family:monospace;font-size:0.8rem;resize:vertical;"></textarea>
      <span style="font-size:0.75rem;color:#8b949e;">Bot-specific settings (API keys, URLs, etc). Secret fields are auto-encrypted.</span>
      <span id="botConfigSecretNote" style="font-size:0.75rem;color:#d29922;display:none;">Note: Secret values show as "***configured***". Leave unchanged to keep existing secrets.</span>
    </div>
    <div class="form-group">
      <label>Scope</label>
      <select id="newBotScope">
        <option value="investigation">Investigation-scoped</option>
        <option value="global">Global</option>
      </select>
    </div>
    <div class="form-group" id="scopeFolderIdsGroup" style="display:none;">
      <label>Investigations</label>
      <div id="scopeFolderIdsList" class="checkbox-grid" style="max-height:150px;overflow-y:auto;"></div>
    </div>
    <div class="trigger-section">
      <label style="font-size:0.85rem;color:#8b949e;display:block;margin-bottom:0.5rem;">Triggers</label>
      <div class="form-group">
        <label>Event Triggers</label>
        <div class="checkbox-grid">
          <label><input type="checkbox" class="bot-event-check" value="entity.created"> Entity Created</label>
          <label><input type="checkbox" class="bot-event-check" value="entity.updated"> Entity Updated</label>
          <label><input type="checkbox" class="bot-event-check" value="entity.deleted"> Entity Deleted</label>
          <label><input type="checkbox" class="bot-event-check" value="investigation.created"> Investigation Created</label>
          <label><input type="checkbox" class="bot-event-check" value="investigation.closed"> Investigation Closed</label>
          <label><input type="checkbox" class="bot-event-check" value="investigation.archived"> Investigation Archived</label>
          <label><input type="checkbox" class="bot-event-check" value="post.created"> Post Created</label>
          <label><input type="checkbox" class="bot-event-check" value="member.added"> Member Added</label>
          <label><input type="checkbox" class="bot-event-check" value="member.removed"> Member Removed</label>
          <label><input type="checkbox" class="bot-event-check" value="webhook.received"> Webhook Received</label>
        </div>
      </div>
      <div class="form-group" id="eventFilterGroup" style="display:none;">
        <label>Event Table Filter</label>
        <input type="text" id="newBotEventTables" placeholder="e.g. standaloneIOCs,notes,tasks">
        <span style="font-size:0.75rem;color:#8b949e;">Comma-separated table names to filter events (leave blank for all)</span>
      </div>
      <div class="form-group">
        <label>Schedule (cron)</label>
        <input type="text" id="newBotSchedule" placeholder="e.g. */30 * * * * (every 30 min)">
      </div>
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:0.5rem;"><input type="checkbox" id="newBotWebhook"> Enable webhook trigger</label>
      </div>
    </div>
    <div class="form-group">
      <label>Allowed Domains (comma-separated)</label>
      <input type="text" id="newBotDomains" placeholder="e.g. api.virustotal.com, otx.alienvault.com">
    </div>
    <div style="display:flex;gap:0.5rem;">
      <div class="form-group" style="flex:1;">
        <label>Rate Limit / Hour</label>
        <input type="number" id="newBotRateHour" value="100" min="1">
      </div>
      <div class="form-group" style="flex:1;">
        <label>Rate Limit / Day</label>
        <input type="number" id="newBotRateDay" value="1000" min="1">
      </div>
    </div>
    <div class="modal-actions">
      <button id="cancelCreateBot" class="btn btn-outline">Cancel</button>
      <button id="submitCreateBot" class="btn btn-primary">Create Bot</button>
    </div>
  </div>
</div>

<!-- ═══ DETAIL PANELS ════════════════════════════════════════════ -->
<div id="detailBackdrop" class="detail-backdrop"></div>
<div id="detailPanel" class="detail-panel">
  <button class="close-btn" id="closeDetailBtn">&times;</button>
  <div id="detailContent"></div>
</div>

<script nonce="${nonce}">
${sharedJs()}
${settingsTabJs()}
${usersTabJs()}
${investigationsTabJs()}
${auditTabJs()}
${botsTabJs()}

/* ═══ INIT ════════════════════════════════════════════════════ */

if (token) showDashboard();
</script>
</body>
</html>`;
}
