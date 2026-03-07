export function adminStyles(): string {
  return `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f1117; color: #e1e4e8; min-height: 100vh; }

  /* ─── Login ──────────────────────────────────────────── */
  .login-container { display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .login-box { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 2rem; width: 360px; }
  .login-box h1 { font-size: 1.25rem; margin-bottom: 1.5rem; text-align: center; color: #c9d1d9; }

  /* ─── Forms ──────────────────────────────────────────── */
  .form-group { margin-bottom: 1rem; }
  .form-group label { display: block; font-size: 0.85rem; color: #8b949e; margin-bottom: 0.35rem; }
  .form-group input, .form-group select { width: 100%; padding: 0.5rem 0.75rem; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 0.9rem; }
  .form-group input:focus, .form-group select:focus { outline: none; border-color: #58a6ff; }

  /* ─── Buttons ────────────────────────────────────────── */
  .btn { display: inline-block; padding: 0.5rem 1rem; border: none; border-radius: 6px; font-size: 0.85rem; cursor: pointer; font-weight: 500; }
  .btn-primary { background: #238636; color: #fff; }
  .btn-primary:hover { background: #2ea043; }
  .btn-sm { padding: 0.3rem 0.6rem; font-size: 0.8rem; }
  .btn-danger { background: #da3633; color: #fff; }
  .btn-danger:hover { background: #f85149; }
  .btn-outline { background: transparent; border: 1px solid #30363d; color: #c9d1d9; }
  .btn-outline:hover { border-color: #58a6ff; color: #58a6ff; }
  .btn-warning { background: #d29922; color: #fff; }
  .btn-warning:hover { background: #e3b341; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-primary.full-width { width: 100%; padding: 0.6rem; }

  /* ─── Dashboard layout ──────────────────────────────── */
  .dashboard { display: none; max-width: 1200px; margin: 0 auto; padding: 1.5rem; }
  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0; border-bottom: 1px solid #21262d; padding-bottom: 1rem; }
  .header h1 { font-size: 1.25rem; color: #c9d1d9; }

  /* ─── Tabs ───────────────────────────────────────────── */
  .tab-bar { display: flex; gap: 0; border-bottom: 1px solid #21262d; margin-bottom: 1.5rem; position: sticky; top: 0; background: #0f1117; z-index: 10; padding-top: 1rem; }
  .tab-btn { padding: 0.6rem 1.25rem; background: none; border: none; border-bottom: 2px solid transparent; color: #8b949e; font-size: 0.9rem; cursor: pointer; font-weight: 500; }
  .tab-btn:hover { color: #c9d1d9; }
  .tab-btn.active { color: #58a6ff; border-bottom-color: #58a6ff; }
  .tab-content { display: none; }
  .tab-content.active { display: block; }

  /* ─── Settings sections ─────────────────────────────── */
  .settings-section { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1.5rem; }
  .settings-section h2 { font-size: 0.95rem; color: #c9d1d9; margin-bottom: 0.75rem; }
  .setting-row { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; flex-wrap: wrap; }
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

  /* ─── Stats cards ───────────────────────────────────── */
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
  .stat-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1rem 1.25rem; }
  .stat-card .label { font-size: 0.8rem; color: #8b949e; margin-bottom: 0.25rem; }
  .stat-card .value { font-size: 1.5rem; font-weight: 600; color: #58a6ff; }

  /* ─── Tables ─────────────────────────────────────────── */
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; background: #161b22; border: 1px solid #30363d; border-radius: 8px; overflow: hidden; }
  th, td { padding: 0.6rem 0.75rem; text-align: left; border-bottom: 1px solid #21262d; font-size: 0.85rem; }
  th { background: #1c2128; color: #8b949e; font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; }
  td { color: #c9d1d9; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #1c2128; }
  td a { color: #58a6ff; text-decoration: none; cursor: pointer; }
  td a:hover { text-decoration: underline; }

  /* ─── Form controls ─────────────────────────────────── */
  select { background: #0d1117; border: 1px solid #30363d; color: #c9d1d9; padding: 0.25rem 0.4rem; border-radius: 4px; font-size: 0.8rem; }
  .toggle { position: relative; display: inline-block; width: 36px; height: 20px; cursor: pointer; }
  .toggle input { opacity: 0; width: 0; height: 0; }
  .toggle .slider { position: absolute; inset: 0; background: #30363d; border-radius: 20px; transition: 0.2s; }
  .toggle .slider::before { content: ''; position: absolute; width: 14px; height: 14px; left: 3px; bottom: 3px; background: #8b949e; border-radius: 50%; transition: 0.2s; }
  .toggle input:checked + .slider { background: #238636; }
  .toggle input:checked + .slider::before { transform: translateX(16px); background: #fff; }

  /* ─── Filter bars ───────────────────────────────────── */
  .filter-bar { display: flex; gap: 0.5rem; margin-bottom: 1rem; flex-wrap: wrap; align-items: center; }
  .filter-bar input, .filter-bar select { padding: 0.4rem 0.6rem; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 0.85rem; }
  .filter-bar input:focus, .filter-bar select:focus { outline: none; border-color: #58a6ff; }
  .filter-bar input[type="text"], .filter-bar input[type="date"] { min-width: 140px; }

  /* ─── Bulk action bar ───────────────────────────────── */
  .bulk-bar { display: none; align-items: center; gap: 0.75rem; padding: 0.5rem 0.75rem; background: #1c2128; border: 1px solid #30363d; border-radius: 6px; margin-bottom: 1rem; font-size: 0.85rem; flex-wrap: wrap; }
  .bulk-bar.visible { display: flex; }
  .bulk-bar .count { color: #58a6ff; font-weight: 600; }

  /* ─── Pagination ─────────────────────────────────────── */
  .pagination { display: flex; align-items: center; gap: 0.75rem; margin-top: 1rem; font-size: 0.85rem; color: #8b949e; }
  .pagination button { padding: 0.3rem 0.6rem; }

  /* ─── Badge ──────────────────────────────────────────── */
  .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 10px; font-size: 0.75rem; font-weight: 600; }
  .badge-green { background: rgba(35,134,54,0.2); color: #3fb950; }
  .badge-gray { background: rgba(139,148,158,0.2); color: #8b949e; }
  .badge-yellow { background: rgba(210,153,34,0.2); color: #e3b341; }
  .badge-blue { background: rgba(88,166,255,0.15); color: #58a6ff; }
  .badge-red { background: rgba(218,54,51,0.15); color: #f85149; }

  /* ─── Toast ──────────────────────────────────────────── */
  .toast-container { position: fixed; top: 1rem; right: 1rem; z-index: 1000; display: flex; flex-direction: column; gap: 0.5rem; }
  .toast { padding: 0.6rem 1rem; border-radius: 6px; font-size: 0.85rem; animation: fadeIn 0.2s; max-width: 360px; }
  .toast-success { background: #238636; color: #fff; }
  .toast-error { background: #da3633; color: #fff; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }

  /* ─── Modal ──────────────────────────────────────────── */
  .modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 500; align-items: center; justify-content: center; }
  .modal-overlay.active { display: flex; }
  .modal { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1.5rem; min-width: 340px; max-width: 500px; width: 90%; max-height: 90vh; overflow-y: auto; }
  .modal h3 { margin-bottom: 1rem; color: #c9d1d9; }
  .modal p { margin-bottom: 1rem; color: #8b949e; font-size: 0.9rem; }
  .modal-actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
  .temp-password { background: #0d1117; border: 1px solid #30363d; padding: 0.75rem; border-radius: 6px; font-family: monospace; font-size: 1rem; color: #58a6ff; word-break: break-all; margin-bottom: 1rem; user-select: all; }
  .error-msg { color: #f85149; font-size: 0.85rem; margin-top: 0.5rem; display: none; }

  /* ─── Detail panel (overlay side panel) ─────────────── */
  .detail-panel { display: none; position: fixed; top: 0; right: 0; width: 600px; max-width: 100vw; height: 100vh; background: #161b22; border-left: 1px solid #30363d; z-index: 400; overflow-y: auto; padding: 1.5rem; }
  .detail-panel.active { display: block; }
  .detail-panel .close-btn { position: absolute; top: 1rem; right: 1rem; background: none; border: none; color: #8b949e; font-size: 1.25rem; cursor: pointer; }
  .detail-panel .close-btn:hover { color: #c9d1d9; }
  .detail-panel h3 { font-size: 1.1rem; margin-bottom: 1rem; color: #c9d1d9; padding-right: 2rem; }
  .detail-panel .section { margin-bottom: 1.5rem; }
  .detail-panel .section h4 { font-size: 0.9rem; color: #8b949e; margin-bottom: 0.5rem; text-transform: uppercase; letter-spacing: 0.04em; }
  .detail-panel .info-grid { display: grid; grid-template-columns: 120px 1fr; gap: 0.3rem 1rem; font-size: 0.85rem; margin-bottom: 1rem; }
  .detail-panel .info-grid .lbl { color: #8b949e; }
  .detail-panel .info-grid .val { color: #c9d1d9; }
  .detail-backdrop { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: 399; }
  .detail-backdrop.active { display: block; }

  /* ─── Danger zone ───────────────────────────────────── */
  .danger-zone { border: 1px solid #da3633; border-radius: 8px; padding: 1rem; margin-top: 1.5rem; }
  .danger-zone h4 { color: #f85149; font-size: 0.9rem; margin-bottom: 0.5rem; }
  .danger-zone p { color: #8b949e; font-size: 0.85rem; margin-bottom: 0.75rem; }

  tr.self-row td { background: rgba(88,166,255,0.05); }

  input[type="checkbox"].row-check { width: 16px; height: 16px; accent-color: #58a6ff; cursor: pointer; }

  /* ─── Bot-specific styles ──────────────────────────────── */
  .bot-type-badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 10px; font-size: 0.75rem; font-weight: 600; }
  .bot-type-enrichment { background: rgba(88,166,255,0.15); color: #58a6ff; }
  .bot-type-feed { background: rgba(63,185,80,0.15); color: #3fb950; }
  .bot-type-monitor { background: rgba(210,153,34,0.15); color: #e3b341; }
  .bot-type-triage { background: rgba(188,140,255,0.15); color: #bc8cff; }
  .bot-type-report { background: rgba(139,148,158,0.15); color: #8b949e; }
  .bot-type-correlation { background: rgba(255,123,114,0.15); color: #ff7b72; }
  .bot-type-ai-agent { background: rgba(210,153,34,0.15); color: #f0883e; }
  .bot-type-custom { background: rgba(139,148,158,0.15); color: #8b949e; }
  .cap-tag { display: inline-block; padding: 0.1rem 0.4rem; margin: 0.1rem; border-radius: 4px; font-size: 0.7rem; background: rgba(88,166,255,0.1); color: #58a6ff; }
  .bot-stat { display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.8rem; color: #8b949e; }
  .bot-stat .num { color: #c9d1d9; font-weight: 600; }
  .run-status-success { color: #3fb950; }
  .run-status-error { color: #f85149; }
  .run-status-running { color: #58a6ff; }
  .run-status-timeout { color: #e3b341; }
  .checkbox-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 0.3rem; margin: 0.5rem 0; }
  .checkbox-grid label { display: flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; color: #c9d1d9; cursor: pointer; }
  .checkbox-grid input[type="checkbox"] { accent-color: #58a6ff; }
  .trigger-section { margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid #21262d; }

  /* ─── AI Assistant styles ──────────────────────────────── */
  .ai-msg { padding: 0.75rem; margin-bottom: 0.5rem; border-radius: 6px; font-size: 0.85rem; line-height: 1.5; word-wrap: break-word; }
  .ai-msg-user { background: rgba(88,166,255,0.08); border-left: 3px solid #58a6ff; }
  .ai-msg-assistant { background: rgba(63,185,80,0.06); border-left: 3px solid #3fb950; }
  .ai-tool-call, .ai-tool-result { margin-top: 0.5rem; padding: 0.5rem; border-radius: 4px; font-size: 0.8rem; }
  .ai-tool-call { background: rgba(210,153,34,0.08); border: 1px solid rgba(210,153,34,0.2); }
  .ai-tool-result { background: rgba(88,166,255,0.06); border: 1px solid rgba(88,166,255,0.15); }`;
}
