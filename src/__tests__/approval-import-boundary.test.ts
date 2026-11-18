/**
 * A-BOUNDARY-1: only a person's action can create a HumanApproval. The chat
 * card handler (ChatView) and the agent action queue are the only producers,
 * and the autonomous loops cannot reach the queue's approval functions.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');
const files: string[] = [];
(function walk(dir: string) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(ts|tsx)$/.test(entry)) files.push(relative(SRC, path).split(sep).join('/'));
  }
})(SRC);
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');
const isTest = (file: string) => file.startsWith('__tests__/');
const using = (pattern: RegExp) => files.filter(file => !isTest(file) && pattern.test(read(file))).sort();

describe('A-BOUNDARY-1 human approval import boundary', () => {
  it('scans the source tree', () => {
    expect(files).toContain('lib/human-approval.ts');
    expect(files.length).toBeGreaterThan(100);
  });

  it('mints approvals only in the chat card handler and the agent action queue', () => {
    expect(using(/mintHumanApproval/)).toEqual(['components/Chat/ChatView.tsx', 'lib/agent-action-approval.ts', 'lib/human-approval.ts']);
  });

  it('exposes the approval functions to the agent panel only', () => {
    expect(using(/agent-action-approval['"]/)).toEqual(['components/Agent/AgentPanel.tsx']);
  });

  it('keeps the approval registry private', () => {
    const registry = ['humanApproval', 'Registry'].join('');
    expect(read('lib/human-approval.ts')).toContain(registry);
    expect(files.filter(file => file !== 'lib/human-approval.ts' && read(file).includes(registry))).toEqual([]);
  });
});
