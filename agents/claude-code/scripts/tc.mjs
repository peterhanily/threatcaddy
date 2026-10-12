#!/usr/bin/env node
// tc — ThreatCaddy CLI for AI agents via Chrome DevTools Protocol
// Connects to a live ThreatCaddy browser tab and executes tool calls.
// Requires Node 22+ (built-in WebSocket) and Chrome remote debugging enabled.
// No npm dependencies.
//
// Per-tab persistent daemon: the first command spawns a background daemon that
// holds the CDP session open. Chrome's "Allow debugging" popup fires once per
// daemon. Subsequent commands go through a Unix socket — no popup.
// Daemons auto-exit after 20 minutes idle or when the tab closes.

import { readFileSync, unlinkSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';
import net from 'net';

const TIMEOUT = 15000;
const IDLE_TIMEOUT = 20 * 60 * 1000;
const DAEMON_CONNECT_RETRIES = 20;
const DAEMON_CONNECT_DELAY = 300;
const DEFAULT_DEBUG_PORT = 9222;
const SOCK_DIR = '/tmp';
const SOCK_PREFIX = 'tc-daemon-';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function sockPath(targetId) { return `${SOCK_DIR}/${SOCK_PREFIX}${targetId}.sock`; }

// ── Chrome DevTools connection ──────────────────────────────────────────

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
  return res.json();
}

async function getDebugWsUrl(port) {
  // 1. Try fixed debugging port (launched with --remote-debugging-port)
  const ports = port ? [port] : [DEFAULT_DEBUG_PORT];
  for (const p of ports) {
    try {
      const data = await fetchJson(`http://127.0.0.1:${p}/json/version`);
      if (data.webSocketDebuggerUrl) return data.webSocketDebuggerUrl;
    } catch { /* port not listening, try next */ }
  }

  // 2. Fall back to DevToolsActivePort file (chrome://inspect toggle)
  const candidates = [
    resolve(homedir(), 'Library/Application Support/Google/Chrome/DevToolsActivePort'),
    resolve(homedir(), '.config/google-chrome/DevToolsActivePort'),
    resolve(homedir(), '.config/chromium/DevToolsActivePort'),
  ];
  const portFile = candidates.find(p => existsSync(p));
  if (portFile) {
    const lines = readFileSync(portFile, 'utf8').trim().split('\n');
    try {
      const data = await fetchJson(`http://127.0.0.1:${lines[0]}/json/version`);
      if (data.webSocketDebuggerUrl) return data.webSocketDebuggerUrl;
    } catch { /* fall through to raw WS */ }
    return `ws://127.0.0.1:${lines[0]}${lines[1]}`;
  }

  throw new Error(
    'Chrome remote debugging not found.\n' +
    'Option 1 (recommended): Launch Chrome with --remote-debugging-port=9222\n' +
    'Option 2: Open chrome://inspect/#remote-debugging and toggle the switch.'
  );
}

// ── CDP WebSocket client ────────────────────────────────────────────────

class CDP {
  #ws; #id = 0; #pending = new Map(); #closeHandlers = [];

  async connect(wsUrl) {
    return new Promise((res, rej) => {
      this.#ws = new WebSocket(wsUrl);
      this.#ws.onopen = () => res();
      this.#ws.onerror = (e) => rej(new Error('WebSocket error: ' + (e.message || e.type)));
      this.#ws.onclose = () => this.#closeHandlers.forEach(h => h());
      this.#ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && this.#pending.has(msg.id)) {
          const { resolve, reject } = this.#pending.get(msg.id);
          this.#pending.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      };
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      const msg = { id, method, params };
      if (sessionId) msg.sessionId = sessionId;
      this.#ws.send(JSON.stringify(msg));
      setTimeout(() => {
        if (this.#pending.has(id)) {
          this.#pending.delete(id);
          reject(new Error(`Timeout: ${method}`));
        }
      }, TIMEOUT);
    });
  }

  onEvent(method, handler) {
    // Piggyback on the message handler for CDP events
    this.#ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.method === method) handler(msg.params || {});
      // Still process pending responses
      if (msg.id && this.#pending.has(msg.id)) {
        const { resolve, reject } = this.#pending.get(msg.id);
        this.#pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };
  }

  onClose(handler) { this.#closeHandlers.push(handler); }
  close() { this.#ws.close(); }
}

// ── Find ThreatCaddy tab ────────────────────────────────────────────────

async function findThreatCaddyTab(cdp) {
  const { targetInfos } = await cdp.send('Target.getTargets');
  const pages = targetInfos.filter(t => t.type === 'page');

  // First try: find by title containing ThreatCaddy
  let target = pages.find(p => /threatcaddy/i.test(p.title));

  // Second try: find by URL pattern
  if (!target) {
    const tcPatterns = [/threatcaddy/i, /localhost:\d+/, /127\.0\.0\.1:\d+/];
    target = pages.find(p => tcPatterns.some(re => re.test(p.url)));
  }

  if (!target) {
    const pageList = pages.map(p => `  ${p.targetId.slice(0, 8)}  ${p.title.slice(0, 50)}  ${p.url}`).join('\n');
    throw new Error(
      'ThreatCaddy tab not found. Open tabs:\n' + pageList +
      '\n\nOpen ThreatCaddy in Chrome first, or use --target <id> to specify a tab.'
    );
  }

  return target;
}

// ── Page evaluation helpers ─────────────────────────────────────────────

async function evalInPage(cdp, sessionId, expression) {
  await cdp.send('Runtime.enable', {}, sessionId);
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }, sessionId);

  if (result.exceptionDetails) {
    const desc = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
    throw new Error(`Page eval error: ${desc}`);
  }

  return result.result.value;
}

// ── Daemon mode ─────────────────────────────────────────────────────────
// Spawned as a background process. Holds the CDP session open so
// Chrome's "Allow debugging" popup only fires once per tab.

async function runDaemon(targetId, wsUrl) {
  const sp = sockPath(targetId);

  const cdp = new CDP();
  try {
    await cdp.connect(wsUrl);
  } catch (e) {
    process.stderr.write(`Daemon: cannot connect to Chrome: ${e.message}\n`);
    process.exit(1);
  }

  let sessionId;
  try {
    const res = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    sessionId = res.sessionId;
  } catch (e) {
    process.stderr.write(`Daemon: attach failed: ${e.message}\n`);
    cdp.close();
    process.exit(1);
  }

  // Verify bridge and read nonce for authenticated calls
  let tcNonce;
  try {
    const check = await evalInPage(cdp, sessionId, 'typeof window.threatcaddy');
    if (check !== 'object') {
      process.stderr.write('Daemon: ThreatCaddy bridge not found on this tab.\n');
      cdp.close();
      process.exit(1);
    }
    tcNonce = await evalInPage(cdp, sessionId, 'window.__tcNonce');
    if (!tcNonce) {
      process.stderr.write('Daemon: warning — bridge nonce not found, calls may fail.\n');
    }
  } catch (e) {
    process.stderr.write(`Daemon: bridge check failed: ${e.message}\n`);
    cdp.close();
    process.exit(1);
  }

  // Shutdown helpers
  let alive = true;
  function shutdown() {
    if (!alive) return;
    alive = false;
    server.close();
    try { unlinkSync(sp); } catch { /* Best-effort removal of the task socket. */ }
    cdp.close();
    process.exit(0);
  }

  // Exit if target goes away or Chrome disconnects
  cdp.onEvent('Target.targetDestroyed', (params) => {
    if (params.targetId === targetId) shutdown();
  });
  cdp.onEvent('Target.detachedFromTarget', (params) => {
    if (params.sessionId === sessionId) shutdown();
  });
  cdp.onClose(() => shutdown());
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Idle timer — auto-exit after 20 minutes of no commands
  let idleTimer = setTimeout(shutdown, IDLE_TIMEOUT);
  function resetIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(shutdown, IDLE_TIMEOUT);
  }

  // Handle a command from the Unix socket
  async function handleCommand({ cmd, args }) {
    resetIdle();
    try {
      let result;
      switch (cmd) {
        case 'status':
          result = await evalInPage(cdp, sessionId,
            `JSON.stringify({ version: window.threatcaddy?.version, tools: window.threatcaddy?.tools()?.length, folderId: window.threatcaddy?.folderId() })`
          );
          break;
        case 'investigations':
          result = await evalInPage(cdp, sessionId, 'window.threatcaddy.investigations()');
          break;
        case 'folder_get':
          result = await evalInPage(cdp, sessionId, 'window.threatcaddy.folderId()');
          break;
        case 'folder_set':
          await evalInPage(cdp, sessionId, `window.threatcaddy.setFolderId(${JSON.stringify(tcNonce)}, ${JSON.stringify(args[0])})`);
          result = `Active investigation set to: ${args[0]}`;
          break;
        case 'tools':
          result = await evalInPage(cdp, sessionId, 'JSON.stringify(window.threatcaddy.tools())');
          break;
        case 'exec': {
          const toolName = args[0];
          const input = args[1] ? JSON.parse(args[1]) : {};
          const inputJson = JSON.stringify(input);
          const expr = `window.threatcaddy.exec(${JSON.stringify(tcNonce)}, ${JSON.stringify(toolName)}, ${inputJson})`;
          result = await evalInPage(cdp, sessionId, expr);
          break;
        }
        case 'stop':
          return { ok: true, result: 'Daemon stopped', stopAfter: true };
        default:
          return { ok: false, error: `Unknown daemon command: ${cmd}` };
      }
      return { ok: true, result: result ?? '' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // Unix socket server — NDJSON protocol
  // Request:  { "id": <n>, "cmd": "<command>", "args": [...] }
  // Response: { "id": <n>, "ok": true, "result": "<string>" }
  //        or { "id": <n>, "ok": false, "error": "<message>" }
  const server = net.createServer((conn) => {
    let buf = '';
    conn.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let req;
        try { req = JSON.parse(line); }
        catch { conn.write(JSON.stringify({ ok: false, error: 'Invalid JSON', id: null }) + '\n'); continue; }
        handleCommand(req).then((res) => {
          const payload = JSON.stringify({ ...res, id: req.id }) + '\n';
          if (res.stopAfter) conn.end(payload, shutdown);
          else conn.write(payload);
        });
      }
    });
  });

  try { unlinkSync(sp); } catch { /* A previous task socket may already be absent. */ }
  server.listen(sp);
}

// ── CLI ↔ Daemon communication ──────────────────────────────────────────

function connectToSocket(sp) {
  return new Promise((resolve, reject) => {
    const conn = net.connect(sp);
    conn.on('connect', () => resolve(conn));
    conn.on('error', reject);
  });
}

async function getOrStartDaemon(targetId, wsUrl) {
  const sp = sockPath(targetId);

  // Try existing daemon
  try { return await connectToSocket(sp); } catch { /* Fall through to the existing daemon-start path. */ }

  // Clean stale socket
  try { unlinkSync(sp); } catch { /* Best-effort stale socket cleanup before startup. */ }

  // Spawn daemon as detached background process
  const child = spawn(process.execPath, [process.argv[1], '_daemon', targetId, wsUrl], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  // Wait for socket to come up (includes time for user to click Allow on first use)
  for (let i = 0; i < DAEMON_CONNECT_RETRIES; i++) {
    await sleep(DAEMON_CONNECT_DELAY);
    try { return await connectToSocket(sp); } catch { /* Retry until the existing startup deadline. */ }
  }
  throw new Error('Daemon failed to start — did you click Allow in Chrome\'s debugging prompt?');
}

function sendCommand(conn, req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    let settled = false;
    const cleanup = () => { conn.off('data', onData); conn.off('error', onErr); conn.off('end', onEnd); };
    const onData = (chunk) => {
      buf += chunk.toString();
      const idx = buf.indexOf('\n');
      if (idx === -1) return;
      settled = true; cleanup();
      resolve(JSON.parse(buf.slice(0, idx)));
      conn.end();
    };
    const onErr = (e) => { if (!settled) { settled = true; cleanup(); reject(e); } };
    const onEnd = () => { if (!settled) { settled = true; cleanup(); reject(new Error('Connection closed')); } };
    conn.on('data', onData);
    conn.on('error', onErr);
    conn.on('end', onEnd);
    req.id = 1;
    conn.write(JSON.stringify(req) + '\n');
  });
}

function listDaemonSockets() {
  try {
    return readdirSync(SOCK_DIR)
      .filter(f => f.startsWith(SOCK_PREFIX) && f.endsWith('.sock'))
      .map(f => ({ targetId: f.slice(SOCK_PREFIX.length, -5), socketPath: `${SOCK_DIR}/${f}` }));
  } catch { return []; }
}

// ── Main ────────────────────────────────────────────────────────────────

const USAGE = `tc — ThreatCaddy CLI for AI agents

Usage: tc <command> [args]

  status                              Check bridge connection and version
  investigations                      List all investigations
  folder [id]                         Get or set the active investigation
  tools                               List available tool names
  exec <tool_name> '<json_input>'     Execute a CaddyAI tool
  stop                                Stop the background daemon
  help                                Show this help

Examples:
  tc status
  tc investigations
  tc folder abc123
  tc exec search_notes '{"query": "malware"}'
  tc exec create_note '{"title": "Finding", "content": "# APT29 activity detected"}'
  tc exec bulk_create_iocs '{"iocs": [{"type":"ipv4","value":"10.0.0.1","confidence":"high"}]}'
  tc exec create_timeline_event '{"title": "Initial access", "timestamp": "2025-06-15T14:00:00Z", "eventType": "initial-access"}'

Options:
  --port <port>                       Chrome debugging port (default: 9222)
  --target <id>                       Target a specific tab by ID prefix

Prerequisites:
  1. Chrome remote debugging enabled (one of):
     a. Launch Chrome with: --remote-debugging-port=9222 (no popup)
     b. Toggle chrome://inspect/#remote-debugging (popup fires once per session)
  2. ThreatCaddy open in a Chrome tab
  3. Node.js 22+

The first command spawns a background daemon that holds the Chrome session
open. Chrome's "Allow debugging" popup fires once; all subsequent commands
reuse the session with no popup. The daemon auto-exits after 20min idle.
`;

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  // Internal: daemon mode
  if (cmd === '_daemon') {
    await runDaemon(args[1], args[2]);
    return;
  }

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(USAGE);
    process.exit(0);
  }

  // Parse optional flags
  let targetOverride;
  const targetIdx = args.indexOf('--target');
  if (targetIdx !== -1) {
    targetOverride = args[targetIdx + 1];
    args.splice(targetIdx, 2);
  }

  let debugPort;
  const portIdx = args.indexOf('--port');
  if (portIdx !== -1) {
    debugPort = parseInt(args[portIdx + 1], 10);
    args.splice(portIdx, 2);
  }

  // Stop daemon
  if (cmd === 'stop') {
    const daemons = listDaemonSockets();
    if (daemons.length === 0) {
      console.log('No daemons running.');
    }
    for (const d of daemons) {
      try {
        const conn = await connectToSocket(d.socketPath);
        await sendCommand(conn, { cmd: 'stop' });
        console.log(`Stopped daemon for ${d.targetId.slice(0, 8)}`);
      } catch {
        try { unlinkSync(d.socketPath); } catch { /* The stopped task socket may already be absent. */ }
      }
    }
    return;
  }

  // Check for existing daemon first — if one is running, use it directly
  const daemons = listDaemonSockets();
  let conn;

  if (daemons.length > 0) {
    // Try to connect to existing daemon
    for (const d of daemons) {
      try {
        conn = await connectToSocket(d.socketPath);
        break;
      } catch {
        // Stale socket, clean up
        try { unlinkSync(d.socketPath); } catch { /* Best-effort cleanup of the unreachable task socket. */ }
      }
    }
  }

  if (!conn) {
    // No running daemon — need to find tab and start one
    const wsUrl = await getDebugWsUrl(debugPort);
    const cdp = new CDP();
    try {
      await cdp.connect(wsUrl);
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }

    let target;
    try {
      if (targetOverride) {
        const { targetInfos } = await cdp.send('Target.getTargets');
        target = targetInfos.find(t =>
          t.targetId.toUpperCase().startsWith(targetOverride.toUpperCase())
        );
        if (!target) throw new Error(`No tab matching target prefix: ${targetOverride}`);
      } else {
        target = await findThreatCaddyTab(cdp);
      }
    } catch (e) {
      console.error(e.message);
      cdp.close();
      process.exit(1);
    }

    cdp.close();

    // Start daemon and connect
    conn = await getOrStartDaemon(target.targetId, wsUrl);
  }

  // Route command through daemon
  let daemonCmd, daemonArgs;
  switch (cmd) {
    case 'status':
      daemonCmd = 'status'; daemonArgs = [];
      break;
    case 'investigations':
      daemonCmd = 'investigations'; daemonArgs = [];
      break;
    case 'folder':
      if (args[1]) {
        daemonCmd = 'folder_set'; daemonArgs = [args[1]];
      } else {
        daemonCmd = 'folder_get'; daemonArgs = [];
      }
      break;
    case 'tools':
      daemonCmd = 'tools'; daemonArgs = [];
      break;
    case 'exec': {
      const toolName = args[1];
      if (!toolName) {
        console.error('Usage: tc exec <tool_name> \'<json_input>\'');
        process.exit(1);
      }
      const jsonStr = args.slice(2).join(' ') || '{}';
      try { JSON.parse(jsonStr); } catch (e) {
        console.error(`Invalid JSON input: ${e.message}`);
        process.exit(1);
      }
      daemonCmd = 'exec'; daemonArgs = [toolName, jsonStr];
      break;
    }
    default:
      console.error(`Unknown command: ${cmd}\n`);
      console.log(USAGE);
      process.exit(1);
  }

  const response = await sendCommand(conn, { cmd: daemonCmd, args: daemonArgs });
  if (response.ok) {
    if (response.result) console.log(response.result);
  } else {
    console.error('Error:', response.error);
    process.exitCode = 1;
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
