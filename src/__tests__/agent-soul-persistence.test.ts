/**
 * Soul-write upsert behaviour for builtin agent profiles.
 *
 * Built-in profiles only live in BUILTIN_AGENT_PROFILES; until something
 * writes a row, db.agentProfiles has no entry for them and Dexie's
 * Table.update() silently no-ops on missing keys. The persistSoul helper
 * (used by reflect_on_performance and dismiss_agent) does an upsert so
 * the soul actually persists.
 *
 * These tests go through the public executeTool dispatcher so the full
 * path including agent-context resolution and the merged-profile lookup
 * is exercised.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '../db';
import type { ToolUseBlock } from '../types';
import { execTool } from './helpers/tool-exec';

const CISO_ID = 'ap-ciso';                    // executive — for dismiss + read
const HUNTER_ID = 'ap-threat-hunter';         // specialist — for reflect-on-self

function reflectCall(lesson: string, identity?: string): ToolUseBlock {
  return {
    type: 'tool_use', id: 'tu-r', name: 'reflect_on_performance',
    input: identity ? { lesson, identity } : { lesson },
  };
}

function readSoulCall(agentName?: string): ToolUseBlock {
  return {
    type: 'tool_use', id: 'tu-s', name: 'read_soul',
    input: agentName ? { agentName } : {},
  };
}

describe('soul persistence on builtin profiles', () => {
  beforeEach(async () => {
    await db.agentProfiles.clear();
  });

  it('reflect_on_performance persists a soul on a builtin profile', async () => {
    // Sanity: no DB row exists for the builtin yet.
    expect(await db.agentProfiles.get(HUNTER_ID)).toBeUndefined();

    const r = await execTool(
      reflectCall('Always check the timeline before forming a hypothesis.'), 'fid', { surface: 'agent', agentContext: { profileId: HUNTER_ID } },
    );
    const parsed = JSON.parse(r.result);
    expect(parsed.success).toBe(true);
    expect(parsed.lessonsCount).toBe(1);

    // The DB row now exists with the soul attached.
    const row = await db.agentProfiles.get(HUNTER_ID);
    expect(row).toBeDefined();
    expect(row?.soul?.lessons[0]).toBe('Always check the timeline before forming a hypothesis.');
    expect(row?.role).toBe('specialist');
    expect(row?.systemPrompt).toBeTruthy();
  });

  it('reflect_on_performance updates the soul on subsequent calls (no row duplication)', async () => {
    await execTool(reflectCall('First lesson.'), 'fid', { surface: 'agent', agentContext: { profileId: HUNTER_ID } });
    await execTool(reflectCall('Second lesson.'), 'fid', { surface: 'agent', agentContext: { profileId: HUNTER_ID } });
    await execTool(reflectCall('Third lesson.'), 'fid', { surface: 'agent', agentContext: { profileId: HUNTER_ID } });

    const rows = await db.agentProfiles.where('id').equals(HUNTER_ID).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].soul?.lessons).toHaveLength(3);
    // Newest lesson is at index 0 (per executeReflectOnPerformance).
    expect(rows[0].soul?.lessons[0]).toBe('Third lesson.');
  });

  it('read_soul (peer-read by executive) sees the persisted soul on a builtin', async () => {
    await execTool(
      reflectCall('Specialists should always cite a source.', 'I am the Threat Hunter, evidence-driven.'), 'fid', { surface: 'agent', agentContext: { profileId: HUNTER_ID } },
    );

    const r = await execTool(readSoulCall('Threat Hunter'), 'fid', { surface: 'agent', agentContext: { profileId: CISO_ID } });
    const parsed = JSON.parse(r.result);
    expect(parsed.error).toBeUndefined();
    expect(parsed.profile).toBe('Threat Hunter');
    expect(parsed.isPeerRead).toBe(true);
    expect(parsed.soul?.identity).toBe('I am the Threat Hunter, evidence-driven.');
    expect(parsed.soul?.lessons[0]).toBe('Specialists should always cite a source.');
  });

  it('reflect snapshot preserves builtin role + systemPrompt at write time', async () => {
    await execTool(reflectCall('initial'), 'fid', { surface: 'agent', agentContext: { profileId: HUNTER_ID } });
    const row = await db.agentProfiles.get(HUNTER_ID);
    // The materialised row carries the i18n-resolved name primitive (not a getter)
    // and the full-fat profile fields, so it round-trips through structured-clone
    // (Dexie storage) without losing data.
    expect(typeof row?.name).toBe('string');
    expect(row?.name.length).toBeGreaterThan(0);
    expect(row?.systemPrompt.length).toBeGreaterThan(50);
    expect(row?.policy).toBeDefined();
  });
});
