import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ create: vi.fn(), pull: vi.fn() }));
vi.mock('dockerode', () => ({
  default: class {
    createContainer = fixture.create;
    pull = fixture.pull;
    modem = { followProgress: (_stream: unknown, done: (error: Error | null) => void) => done(null) };
  },
}));
vi.mock('../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const LANGUAGES = { python: 'SANDBOX_PYTHON_IMAGE', nodejs: 'SANDBOX_NODE_IMAGE', bash: 'SANDBOX_BASH_IMAGE' } as const;
// An official image, its full version tag, and the multi-platform index digest it resolved to.
const PINNED = /^(python|node|alpine):(\d+)\.(\d+)\.\d+[\w.-]*@sha256:[a-f0-9]{64}$/;

async function sandbox() {
  vi.resetModules();
  return import('../bots/sandbox.js');
}

async function imageFor(language: keyof typeof LANGUAGES): Promise<string> {
  const { executeCode } = await sandbox();
  fixture.create.mockRejectedValueOnce(new Error('synthetic: no container'));
  await expect(executeCode(language, 'true')).rejects.toThrow('synthetic');
  return (fixture.create.mock.calls.at(-1)?.[0] as { Image: string } | undefined)?.Image ?? '';
}

beforeEach(() => {
  vi.resetAllMocks();
  for (const name of Object.values(LANGUAGES)) vi.stubEnv(name, '');
  fixture.pull.mockImplementation((_image: string, done: (error: Error | null, stream: unknown) => void) => done(null, {}));
});
afterEach(() => vi.unstubAllEnvs());

describe('default sandbox images', () => {
  it('pin every default image by digest to a supported release', async () => {
    const defaults: Record<string, string> = {};
    for (const language of Object.keys(LANGUAGES)) defaults[language] = await imageFor(language as keyof typeof LANGUAGES);
    for (const image of Object.values(defaults)) expect(image).toMatch(PINNED);
    const [, , alpineMajor, alpineMinor] = PINNED.exec(defaults.bash) ?? [];
    // Alpine 3.19 left support in November 2025; 3.22 is the oldest release supported through 2026.
    expect(defaults.bash.startsWith('alpine:')).toBe(true);
    expect(Number(alpineMajor) * 100 + Number(alpineMinor)).toBeGreaterThanOrEqual(322);
    expect(defaults.nodejs.startsWith('node:22.')).toBe(true);
    expect(defaults.python.startsWith('python:3.12.')).toBe(true);
  });

  it('pre-pulls exactly the pinned references, and an operator override replaces its default', async () => {
    const pinned = await imageFor('python');
    const { prePullSandboxImages } = await sandbox();
    await prePullSandboxImages();
    const pulled = fixture.pull.mock.calls.map(call => call[0]);
    expect(pulled).toHaveLength(3);
    expect(pulled).toContain(pinned);
    for (const image of pulled) expect(image).toMatch(PINNED);
    vi.stubEnv('SANDBOX_PYTHON_IMAGE', 'registry.example/sandbox/python:fixture');
    expect(await imageFor('python')).toBe('registry.example/sandbox/python:fixture');
  });

  it('match the defaults the operator documentation lists', async () => {
    const docs = ['../../../docs/deployment.md', '../../README.md'].map(path => readFileSync(new URL(path, import.meta.url), 'utf8'));
    for (const [language, variable] of Object.entries(LANGUAGES)) {
      const image = await imageFor(language as keyof typeof LANGUAGES);
      for (const text of docs) {
        const row = text.split('\n').find(line => line.startsWith(`| \`${variable}\` |`));
        expect(row, variable).toContain(`\`${image}\``);
      }
    }
  });
});
