import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getToolBinding } from '../lib/tool-binding';
import { executeTool } from '../lib/llm-tools';
import { executeApprovedAction } from '../lib/caddy-agent';
import { queueAgentAction } from '../lib/agent-action-approval';
import { workspaceStorageKey } from '../lib/workspace-profiles';
import { db } from '../db';
import { DEFAULT_SETTINGS, type Settings, type ToolUseBlock } from '../types';

const tool: ToolUseBlock = { type: 'tool_use', id: 'summary-call', name: 'host:reports:summary', input: { document: 'fixture' } };
const settings: Settings = { ...DEFAULT_SETTINGS, agentHosts: [{ id: 'reports-id', name: 'reports', displayName: 'Reports', url: 'https://reports.example', enabled: true, apiKey: 'synthetic-key', skills: [{ name: 'summary', description: 'Read a prepared report', parameters: { type: 'object', properties: { document: { type: 'string' } }, required: ['document'] }, actionClass: 'read' }] }] };
const saveSettings = (value: Settings) => localStorage.setItem(workspaceStorageKey('threatcaddy-settings'), JSON.stringify(value));
beforeEach(async () => { saveSettings(settings); await db.agentActions.clear(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Prepared report'))); });
afterEach(() => { vi.unstubAllGlobals(); localStorage.removeItem(workspaceStorageKey('threatcaddy-settings')); });

describe('dynamic tool approval bindings', () => {
  it('permits the exact reviewed read-only call and stores only a digest', async () => {
    const binding = await getToolBinding(tool, 'case', 'act');
    expect(binding).toMatch(/^v1:[a-f0-9]{64}$/);
    expect(binding).not.toContain('synthetic-key');
    const result = await executeTool(tool, 'case', undefined, { allowedTools: new Set([tool.name]), toolBinding: binding });
    expect(result).toEqual({ result: 'Prepared report', isError: false });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(['endpoint', 'schema', 'classification', 'credential', 'disabled'] as const)('requires new approval after %s changes', async change => {
    const binding = await getToolBinding(tool, 'case', 'act');
    const next = structuredClone(settings);
    const host = next.agentHosts![0];
    if (change === 'endpoint') host.url = 'https://new-reports.example';
    if (change === 'schema') host.skills![0].parameters.required = [];
    if (change === 'classification') host.skills![0].actionClass = 'modify';
    if (change === 'credential') host.apiKey = 'new-synthetic-key';
    if (change === 'disabled') host.enabled = false;
    saveSettings(next);
    const result = await executeTool(tool, 'case', undefined, { allowedTools: new Set([tool.name]), toolBinding: binding });
    expect(result.isError).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('binds arguments, investigation scope and Plan/Act mode', async () => {
    const binding = await getToolBinding(tool, 'case', 'act');
    for (const [call, scope, readOnly] of [
      [{ ...tool, input: { document: 'different' } }, 'case', false],
      [tool, 'different-case', false], [tool, 'case', true],
    ] as const) {
      expect((await executeTool(call, scope, undefined, { allowedTools: new Set([tool.name]), toolBinding: binding, readOnly })).isError).toBe(true);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('invalidates a durable proposal instead of executing it against changed configuration', async () => {
    const toolBinding = await getToolBinding(tool, 'case');
    const { action } = await queueAgentAction({ investigationId: 'case', threadId: 'thread', toolName: tool.name, toolInput: tool.input, toolBinding, rationale: 'Review a prepared report' });
    saveSettings({ ...settings, agentHosts: [] });
    expect((await executeApprovedAction(action)).isError).toBe(true);
    expect((await db.agentActions.get(action.id))?.status).toBe('failed');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not reuse an older unbound proposal and rejects unbound dispatch', async () => {
    const proposal = { investigationId: 'case', threadId: 'thread', toolName: tool.name, toolInput: tool.input, rationale: 'Read summary' };
    await queueAgentAction(proposal);
    const bound = await queueAgentAction({ ...proposal, toolBinding: await getToolBinding(tool, 'case') });
    expect(bound.alreadyPending).toBe(false);
    expect((await executeTool(tool, 'case')).isError).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});
