import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { decryptBackup, encryptBackup, type EncryptedBackupBlob } from '../lib/backup-crypto';

const password = 'synthetic-envelope-password';
let valid: EncryptedBackupBlob;
beforeAll(async () => { valid = await encryptBackup(password, { notes: [], title: 'Synthetic recovery 中文' }); });
afterEach(() => vi.restoreAllMocks());

describe('encrypted backup v1 envelope validation', () => {
  it.each([
    { salt: '' }, { salt: 'AAAA' }, { salt: 'A'.repeat(24) }, { salt: 123 },
    { iv: '' }, { iv: 'AAAA' }, { iv: 'A'.repeat(20) }, { iv: {} },
    { ct: '' }, { ct: 'AAAA' }, { ct: 'A'.repeat(23) }, { ct: '!'.repeat(24) }, { ct: null },
  ])('rejects malformed fields before key derivation: %j', async fields => {
    const derive = vi.spyOn(crypto.subtle, 'deriveKey');
    await expect(decryptBackup(password, { ...valid, ...fields } as EncryptedBackupBlob)).rejects.toThrow('Invalid encrypted backup envelope');
    expect(derive).not.toHaveBeenCalled();
  });

  it.each([null, [], 'not an envelope'])('rejects non-envelope inputs', async input => {
    await expect(decryptBackup(password, input as unknown as EncryptedBackupBlob)).rejects.toThrow('Invalid encrypted backup envelope');
  });

  it('retains the existing format and real authenticated decryption', async () => {
    expect(await decryptBackup(password, valid)).toEqual({ notes: [], title: 'Synthetic recovery 中文' });
    await expect(decryptBackup('wrong synthetic password', valid)).rejects.toThrow('Wrong password or corrupted backup');
  });
});
