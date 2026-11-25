/**
 * Agent Bridge — exposes ThreatCaddy's tool API on `window.threatcaddy`
 * so external AI agents (Claude Code, Codex, etc.) can interact with
 * the live session via Chrome DevTools Protocol `Runtime.evaluate`.
 *
 * Security:
 * - Off unless Settings.agentBridgeEnabled is set on this device.
 * - The nonce is published on `window.__tcNonce` for the CDP daemon, so any page
 *   script can read it too. It is not an authentication boundary; the limits are:
 * - Scope: only the investigation selected in ThreatCaddy (no re-scoping), and the
 *   dispatcher's bridge surface refuses web, vendor, skill and cross-investigation
 *   reach. Agent lifecycle, cross-case, web, enrichment, SIEM and ticket tools are not offered.
 * - Audit logging: every tool call is logged to IndexedDB activityLog.
 */

import { executeTool } from './llm-tools';
import { TOOL_DEFINITIONS, isWriteTool } from './llm-tool-defs';
import { AGENT_NEVER_TOOLS, EXPLICIT_ONLY_TOOLS, IDENTITY_TOOLS, isEgressToolName } from './caddy-agent-policy';
import { isFolderLocalOnly, isShareableFolder } from './ai-scope';
import { workspaceStorageKey } from './workspace-profiles';
import { db } from '../db';
import i18n from '../i18n';
import type { Settings, ToolUseBlock } from '../types';
import { isEncryptionEnabled, getEncryptionMeta } from './encryptionStore';
import { ENCRYPTION_COVERAGE_VERSION, getSessionKey } from './encryptionMiddleware';
import { isWorkspaceInitialized } from './workspace-initialization';

interface ThreatCaddyBridge {
  /** Execute a CaddyAI tool by name with JSON input. Requires valid nonce. Returns JSON string. */
  exec: (nonce: string, toolName: string, input: Record<string, unknown>) => Promise<string>;
  /** List available tool names */
  tools: () => string[];
  /** Get the currently selected investigation (folder) ID, if any */
  folderId: () => string | undefined;
  /** Retired: the bridge follows the investigation selected in ThreatCaddy. Always throws. */
  setFolderId: (nonce: string, id: string | undefined) => void;
  /** List investigations with basic metadata. Requires valid nonce and the bridge turned on. */
  investigations: (nonce: string) => Promise<string>;
  /** Bridge version for compatibility checks */
  version: string;
}

let activeFolderId: string | undefined;
let bridgeNonce: string | undefined;

/** In-scope tools only; the dispatcher's bridge surface enforces the rest.
 * Network tools are left out because the bridge surface refuses every call. Identity tools are
 * left out: the bridge runs writes without asking, and identities hold personal data. */
export const BRIDGE_TOOLS: ReadonlySet<string> = new Set(TOOL_DEFINITIONS.map(t => t.name)
  .filter(name => !AGENT_NEVER_TOOLS.has(name) && !EXPLICIT_ONLY_TOOLS.has(name) && !isEgressToolName(name) && !IDENTITY_TOOLS.has(name)));

/** Read at call time, like the dispatcher reads settings. */
function isBridgeEnabled(): boolean {
  try {
    const settings: Partial<Settings> = JSON.parse(localStorage.getItem(workspaceStorageKey('threatcaddy-settings')) || '{}');
    return settings.agentBridgeEnabled === true;
  } catch {
    return false;
  }
}

function generateNonce(): string {
  const array = new Uint8Array(24);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

function validateNonce(nonce: string): void {
  if (!bridgeNonce || nonce !== bridgeNonce) {
    throw new Error('Invalid agent bridge nonce');
  }
}

function requireReadyWorkspace(): void {
  const metadata = getEncryptionMeta();
  if (!isWorkspaceInitialized() || (isEncryptionEnabled() && (!getSessionKey() || !metadata || metadata.transition || (metadata.coverageVersion ?? 1) < ENCRYPTION_COVERAGE_VERSION))) {
    throw new Error('Unlock the workspace and finish preparing its data before using the agent bridge.');
  }
}

async function logBridgeCall(toolName: string, folderId: string | undefined, isError: boolean) {
  try {
    await db.activityLog.add({
      id: `agent-log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      category: 'agent-bridge',
      action: isError ? 'tool.error' : 'tool.exec',
      detail: `Agent bridge called ${toolName}${folderId ? ` in investigation ${folderId}` : ''}`,
      itemTitle: toolName,
      timestamp: Date.now(),
    });
  } catch {
    // Don't let logging failures break tool execution
  }
}

const bridge: ThreatCaddyBridge = {
  version: '1.2.0',

  async exec(nonce: string, toolName: string, input: Record<string, unknown> = {}): Promise<string> {
    validateNonce(nonce);
    requireReadyWorkspace();
    if (!isBridgeEnabled()) throw new Error('Turn on the agent bridge in Settings → AI');
    // With no home, the bridge surface could not tell a cross-investigation read.
    const folderId = activeFolderId;
    if (!folderId) throw new Error('Select an investigation in ThreatCaddy first');
    // One plain copy, read once: the scope check and the tool must see the same
    // values, which a getter or Proxy in the caller's object could change.
    let snapshot: Record<string, unknown>;
    try { snapshot = JSON.parse(JSON.stringify(input)); } catch { throw new Error('Tool input must be plain JSON.'); }
    const toolUse: ToolUseBlock = {
      type: 'tool_use',
      id: `agent-${Date.now()}`,
      name: toolName,
      input: snapshot,
    };
    // Builtin agent names come from the 'agent' namespace, which the hosted build loads on demand.
    if (toolName === 'list_deployed_agents') await i18n.loadNamespaces('agent');
    const { result, isError } = await executeTool(toolUse, folderId, undefined, { surface: 'bridge', allowedTools: BRIDGE_TOOLS });
    await logBridgeCall(toolName, folderId, isError);
    if (isError) throw new Error(result);
    // Notify the UI to reload when a write tool succeeds
    if (isWriteTool(toolName)) {
      window.dispatchEvent(new CustomEvent('threatcaddy:entities-changed'));
    }
    return result;
  },

  tools(): string[] {
    return [...BRIDGE_TOOLS];
  },

  folderId(): string | undefined {
    requireReadyWorkspace();
    return activeFolderId;
  },

  setFolderId(): void {
    throw new Error('The agent bridge follows the investigation selected in ThreatCaddy');
  },

  async investigations(nonce: string): Promise<string> {
    validateNonce(nonce);
    requireReadyWorkspace();
    if (!isBridgeEnabled()) throw new Error('Turn on the agent bridge in Settings → AI');
    // From a shareable investigation, local-only investigations do not exist.
    const hideLocalOnly = await isShareableFolder(activeFolderId);
    const folders = [];
    for (const folder of await db.folders.toArray()) if (!hideLocalOnly || !await isFolderLocalOnly(folder)) folders.push(folder);
    return JSON.stringify(folders.map(f => ({
      id: f.id,
      name: f.name,
      status: f.status || 'active',
    })));
  },
};

/**
 * Call once at app startup to expose the bridge on window.
 * Returns the nonce that agents must present with each exec/investigations call.
 * The nonce is available on `window.__tcNonce` for the CDP daemon to read, and
 * so to every script on the page.
 */
export function installAgentBridge(): string {
  bridgeNonce = generateNonce();
  (window as unknown as Record<string, unknown>).threatcaddy = bridge;
  (window as unknown as Record<string, unknown>).__tcNonce = bridgeNonce;
  return bridgeNonce;
}

/** Keep the bridge folderId in sync with the app's selected folder. */
export function syncBridgeFolderId(folderId: string | undefined): void {
  activeFolderId = folderId;
}
