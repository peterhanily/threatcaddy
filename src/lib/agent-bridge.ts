/**
 * Agent Bridge — exposes ThreatCaddy's tool API on `window.threatcaddy`
 * so external AI agents (Claude Code, Codex, etc.) can interact with
 * the live session via Chrome DevTools Protocol `Runtime.evaluate`.
 *
 * Security:
 * - Nonce validation: callers must present the nonce returned by `installAgentBridge`
 *   to execute tools, preventing arbitrary page scripts from abusing the bridge.
 * - Audit logging: every tool call is logged to IndexedDB activityLog.
 */

import { executeTool } from './llm-tools';
import { TOOL_DEFINITIONS, isWriteTool } from './llm-tool-defs';
import { db } from '../db';
import type { ToolUseBlock } from '../types';
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
  /** Set the active investigation by ID. Requires valid nonce. */
  setFolderId: (nonce: string, id: string | undefined) => void;
  /** List investigations with basic metadata */
  investigations: () => Promise<string>;
  /** Bridge version for compatibility checks */
  version: string;
}

let activeFolderId: string | undefined;
let bridgeNonce: string | undefined;

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
  version: '1.1.0',

  async exec(nonce: string, toolName: string, input: Record<string, unknown> = {}): Promise<string> {
    validateNonce(nonce);
    requireReadyWorkspace();
    const toolUse: ToolUseBlock = {
      type: 'tool_use',
      id: `agent-${Date.now()}`,
      name: toolName,
      input,
    };
    const { result, isError } = await executeTool(toolUse, activeFolderId);
    await logBridgeCall(toolName, activeFolderId, isError);
    if (isError) throw new Error(result);
    // Notify the UI to reload when a write tool succeeds
    if (isWriteTool(toolName)) {
      window.dispatchEvent(new CustomEvent('threatcaddy:entities-changed'));
    }
    return result;
  },

  tools(): string[] {
    return TOOL_DEFINITIONS.map(t => t.name);
  },

  folderId(): string | undefined {
    requireReadyWorkspace();
    return activeFolderId;
  },

  setFolderId(nonce: string, id: string | undefined): void {
    validateNonce(nonce);
    requireReadyWorkspace();
    activeFolderId = id;
  },

  async investigations(): Promise<string> {
    requireReadyWorkspace();
    const folders = await db.folders.toArray();
    return JSON.stringify(folders.map(f => ({
      id: f.id,
      name: f.name,
      status: f.status || 'active',
    })));
  },
};

/**
 * Call once at app startup to expose the bridge on window.
 * Returns the nonce that agents must present with each exec/setFolderId call.
 * The nonce is available on `window.__tcNonce` for the CDP daemon to read.
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
