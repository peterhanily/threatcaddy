/**
 * read_soul peer-read behaviour. Goes through the public executeTool dispatcher
 * so the agentRole gate is exercised end-to-end.
 *
 * Three things being locked in:
 *   1. Self-read still works (no agentName) — preserves existing behaviour.
 *   2. Executive can pass agentName to read another agent's soul — new surface.
 *   3. Non-executive caller is rejected when they try to peer-read — gate works.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '../db';
import type { ToolUseBlock } from '../types';
import { DEFAULT_AGENT_POLICY } from '../types';
import { execTool } from './helpers/tool-exec';

const CISO_ID = 'ap-ciso';
const SPECIALIST_ID = 'ap-threat-hunter';
const PEER_TARGET_ID = 'ap-malware-analyst';

function readSoulCall(agentName?: string): ToolUseBlock {
  return {
    type: 'tool_use',
    id: 'tu-1',
    name: 'read_soul',
    input: agentName ? { agentName } : {},
  };
}

describe('read_soul peer-read', () => {
  beforeEach(async () => {
    await db.agentProfiles.clear();
    await db.agentDeployments.clear();
    // Seed a soul on the peer target so peer reads have something to return.
    await db.agentProfiles.add({
      id: PEER_TARGET_ID,
      name: 'Malware Analyst',
      role: 'specialist',
      icon: '🦠',
      description: '',
      systemPrompt: '',
      policy: { ...DEFAULT_AGENT_POLICY },
      priority: 0,
      source: 'user',
      soul: {
        identity: 'Methodical malware specialist.',
        lessons: ['Always check the strings table first.'],
        strengths: ['Static analysis'],
        weaknesses: ['Slow on novel packers'],
        lifetimeMetrics: {
          investigationsWorked: 3,
          totalCycles: 50,
          totalToolCalls: 200,
          tasksCompleted: 12,
          tasksRejected: 1,
          meetingsAttended: 4,
          performanceScore: 85,
        },
        updatedAt: Date.now(),
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  it('self-read with no agentName still works', async () => {
    const r = await execTool(readSoulCall(), 'fid', { surface: 'agent', agentContext: { profileId: PEER_TARGET_ID } });
    const parsed = JSON.parse(r.result);
    expect(parsed.error).toBeUndefined();
    expect(parsed.profile).toBe('Malware Analyst');
    expect(parsed.isPeerRead).toBe(false);
    expect(parsed.soul.identity).toBe('Methodical malware specialist.');
  });

  it('executive can read another agent\'s soul by name', async () => {
    const r = await execTool(readSoulCall('Malware Analyst'), 'fid', { surface: 'agent', agentContext: { profileId: CISO_ID } });
    const parsed = JSON.parse(r.result);
    expect(parsed.error).toBeUndefined();
    expect(parsed.profile).toBe('Malware Analyst');
    expect(parsed.isPeerRead).toBe(true);
    expect(parsed.soul.identity).toBe('Methodical malware specialist.');
    expect(parsed.soul.lessons).toEqual(['Always check the strings table first.']);
  });

  it('executive peer-read accepts a partial-name match', async () => {
    const r = await execTool(readSoulCall('malware'), 'fid', { surface: 'agent', agentContext: { profileId: CISO_ID } });
    const parsed = JSON.parse(r.result);
    expect(parsed.error).toBeUndefined();
    expect(parsed.profile).toBe('Malware Analyst');
  });

  it('non-executive caller is rejected when peer-reading', async () => {
    const r = await execTool(readSoulCall('Malware Analyst'), 'fid', { surface: 'agent', agentContext: { profileId: SPECIALIST_ID } });
    const parsed = JSON.parse(r.result);
    expect(parsed.error).toBeDefined();
    expect(parsed.error).toMatch(/executive/i);
    expect(parsed.profile).toBeUndefined();
  });

  it('peer-read with unknown agentName returns a clear error', async () => {
    const r = await execTool(readSoulCall('Nonexistent Agent'), 'fid', { surface: 'agent', agentContext: { profileId: CISO_ID } });
    const parsed = JSON.parse(r.result);
    expect(parsed.error).toMatch(/not found/i);
  });
});
