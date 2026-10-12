import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackupDestination } from '../types';
import { cloudPut, multiCloudPut, testDestination } from '../lib/cloud-sync';
import { CLOUD_PROVIDERS } from '../lib/cloud-providers';

const fetchMock = vi.fn();
const ociRoot = 'https://objectstorage.example.oraclecloud.com/p/example/n/test/b/test/o/';
const makeDestination = (provider: BackupDestination['provider'], url: string): BackupDestination => ({
  id: 'synthetic-destination', label: 'Synthetic destination', provider, url, enabled: true,
});
const unsupported = [
  makeDestination('aws-s3', 'https://example.s3.eu-west-1.amazonaws.com/backup.json?X-Amz-Signature=synthetic'),
  makeDestination('gcs', 'https://storage.googleapis.com/example/backup.json?X-Goog-Signature=synthetic'),
  makeDestination('azure-blob', 'https://example.blob.core.windows.net/container/backup.json?sr=b&sig=synthetic'),
  makeDestination('azure-blob', 'https://example.blob.core.windows.net/container/prefix?sr=d&sig=synthetic'),
  makeDestination('azure-blob', 'https://example.blob.core.windows.net/container?ss=b&srt=o&sig=synthetic'),
  makeDestination('azure-blob', 'https://example.blob.core.windows.net/container/backup.json?sr=c&sig=synthetic'),
  makeDestination('oci', `${ociRoot}backup.json`),
  makeDestination('oci', `${ociRoot}nested/o`),
];
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('cloud destination authorization shape', () => {
  it.each(unsupported)('does not write a connectivity test or backup to unsupported $provider URL $url', async (destination) => {
    expect(CLOUD_PROVIDERS[destination.provider].validateUrl(destination.url).valid).toBe(false);
    expect(await testDestination(destination)).toMatchObject({ ok: false, error: expect.stringMatching(/not supported/) });
    expect(await cloudPut(destination, 'threatcaddy/backups/backup.json', '{}')).toMatchObject({ ok: false, destinationId: destination.id });
    expect(await multiCloudPut([destination], 'threatcaddy/backups/backup.json', '{}')).toMatchObject([{ ok: false, destinationId: destination.id }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { destination: makeDestination('oci', ociRoot), expected: `${ociRoot}threatcaddy/backups/backup.json` },
    { destination: makeDestination('oci', `${ociRoot}team/`), expected: `${ociRoot}team/threatcaddy/backups/backup.json` },
    { destination: makeDestination('azure-blob', 'https://example.blob.core.windows.net/container?sr=c&sig=synthetic'),
      expected: 'https://example.blob.core.windows.net/container/threatcaddy/backups/backup.json?sr=c&sig=synthetic' },
  ])('retains generated backup paths for supported $destination.provider destinations', async ({ destination, expected }) => {
    expect(CLOUD_PROVIDERS[destination.provider].validateUrl(destination.url)).toEqual({ valid: true });
    expect((await cloudPut(destination, 'threatcaddy/backups/backup.json', '{}')).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(expected, expect.objectContaining({ method: 'PUT', body: '{}' }));
  });

  it('keeps OCI input whitespace outside the actual upload URL', () => {
    expect(CLOUD_PROVIDERS.oci.buildObjectUrl(` ${ociRoot} `, 'backup.json')).toBe(`${ociRoot}backup.json`);
  });

  it('rejects ambiguous OCI query URLs and incomplete Azure container grants before writing', async () => {
    for (const destination of [makeDestination('oci', `${ociRoot}?format=json`),
      makeDestination('azure-blob', 'https://example.blob.core.windows.net/container?sr=c')]) {
      expect((await testDestination(destination)).ok).toBe(false);
      expect((await cloudPut(destination, 'backup.json', '{}')).ok).toBe(false);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
