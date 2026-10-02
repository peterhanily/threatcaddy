import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';

const originalKey = process.env.BOT_MASTER_KEY;
afterEach(() => {
  if (originalKey === undefined) delete process.env.BOT_MASTER_KEY;
  else process.env.BOT_MASTER_KEY = originalKey;
  vi.resetModules();
});

async function store(key = 'a'.repeat(64)) {
  process.env.BOT_MASTER_KEY = key;
  vi.resetModules();
  return import('../bots/secret-store.js');
}

describe('persistent bot credential boundaries', () => {
  it('refuses missing, short and whitespace-mutated master keys without exposing their values', async () => {
    const secrets = await store();
    for (const key of [undefined, '', 'short-synthetic-key', ` ${'b'.repeat(64)}`, `${'b'.repeat(64)}\n`]) {
      if (key === undefined) delete process.env.BOT_MASTER_KEY;
      else process.env.BOT_MASTER_KEY = key;
      expect(() => secrets.encryptSecret('synthetic credential')).toThrow('BOT_MASTER_KEY');
    }
  });

  it('preserves secure legacy master key bytes and rejects an in-process key change', async () => {
    const secrets = await store('existing-configured-legacy-key-32-characters');
    const ciphertext = secrets.encryptSecret('synthetic legacy credential');
    expect(secrets.decryptSecret(ciphertext)).toBe('synthetic legacy credential');
    process.env.BOT_MASTER_KEY = 'b'.repeat(64);
    expect(() => secrets.decryptSecret(ciphertext)).toThrow('changed while the server was running');
  });

  it('encrypts and redacts runtime credential spellings through nested arrays', async () => {
    const secrets = await store();
    const original = {
      hosts: [{ host: 'synthetic.example.invalid', privateKey: 'synthetic-pem', passphrase: 'synthetic-phrase',
        connections: [[{ private_key: 'synthetic-legacy-pem', headers: { Authorization: 'synthetic-auth' } }]] }],
      token: ['synthetic-token-1', 'synthetic-token-2'],
      retryCount: 3,
    };
    const encrypted = secrets.encryptConfigSecrets(original);
    expect(JSON.stringify(encrypted)).not.toContain('synthetic-pem');
    expect(JSON.stringify(encrypted)).not.toContain('synthetic-phrase');
    expect(JSON.stringify(encrypted)).not.toContain('synthetic-token');
    expect(secrets.decryptConfigSecrets(encrypted)).toEqual(original);
    const redacted = secrets.redactConfigSecrets(original);
    expect(JSON.stringify(redacted)).not.toMatch(/synthetic-(pem|phrase|legacy-pem|auth|token)/);
    expect(redacted.retryCount).toBe(3);
    expect(original.hosts[0].privateKey).toBe('synthetic-pem');
  });

  it('redacts ciphertext even when the containing field is not a known credential name', async () => {
    const secrets = await store();
    const ciphertext = secrets.encryptSecret('synthetic arbitrary secret');
    expect(secrets.redactConfigSecrets({ details: [{ value: ciphertext }] })).toEqual({ details: [{ value: '***configured***' }] });
  });

  it('reports only plaintext credential paths for operator exposure assessment', async () => {
    const secrets = await store();
    const config = { hosts: [{ privateKey: 'synthetic-unencrypted', passphrase: 'synthetic-passphrase' }], token: secrets.encryptSecret('synthetic-encrypted'), apiKey: '***configured***' };
    expect(secrets.findPlaintextSecretPaths(config)).toEqual(['hosts[0].privateKey', 'hosts[0].passphrase']);
  });

  it('decrypts persisted ciphertext in a new process using the same stable key', () => {
    const env = { PATH: process.env.PATH, BOT_MASTER_KEY: 'c'.repeat(64) };
    const first = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
      "import { encryptSecret } from './src/bots/secret-store.ts'; process.stdout.write(encryptSecret('synthetic persisted credential'));"],
    { env, encoding: 'utf8', timeout: 15000 });
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toMatch(/^enc2:/);
    const second = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
      "import { decryptSecret } from './src/bots/secret-store.ts'; import { readFileSync } from 'node:fs'; process.stdout.write(decryptSecret(readFileSync(0, 'utf8')));"],
    { env, input: first.stdout, encoding: 'utf8', timeout: 15000 });
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toBe('synthetic persisted credential');
  });
});
