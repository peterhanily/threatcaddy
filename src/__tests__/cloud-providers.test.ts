import { describe, it, expect } from 'vitest';
import { CLOUD_PROVIDERS, detectProvider, sanitizePath } from '../lib/cloud-providers';

// ---- OCI Validation ----

describe('OCI provider', () => {
  const provider = CLOUD_PROVIDERS['oci'];

  it('accepts a valid OCI PAR URL', () => {
    const url = 'https://objectstorage.us-ashburn-1.oraclecloud.com/p/abc123/n/ns/b/bucket/o/';
    expect(provider.validateUrl(url)).toEqual({ valid: true });
  });

  it('rejects http:// URLs', () => {
    const url = 'http://objectstorage.us-ashburn-1.oraclecloud.com/p/abc123/n/ns/b/bucket/o/';
    expect(provider.validateUrl(url).valid).toBe(false);
    expect(provider.validateUrl(url).error).toContain('HTTPS');
  });

  it('rejects non-OCI hostnames', () => {
    const url = 'https://evil.com/p/token/n/ns/b/bucket/o/';
    expect(provider.validateUrl(url).valid).toBe(false);
    expect(provider.validateUrl(url).error).toContain('oraclecloud.com');
  });

  it('rejects URLs without /p/ and /o/', () => {
    const url = 'https://objectstorage.us-ashburn-1.oraclecloud.com/n/ns/b/bucket/';
    expect(provider.validateUrl(url).valid).toBe(false);
  });

  it('builds object URL by appending path', () => {
    const base = 'https://objectstorage.us-ashburn-1.oraclecloud.com/p/token/n/ns/b/bucket/o/';
    const url = provider.buildObjectUrl(base, 'threatcaddy/test.json');
    expect(url).toBe(base + 'threatcaddy/test.json');
  });

  it('adds trailing slash to base URL if missing', () => {
    const base = 'https://objectstorage.us-ashburn-1.oraclecloud.com/p/token/n/ns/b/bucket/o';
    const url = provider.buildObjectUrl(base, 'test.json');
    expect(url).toBe(base + '/test.json');
  });

  it('returns no extra headers', () => {
    expect(provider.extraHeaders()).toEqual({});
  });
});

// ---- AWS S3 Validation ----

describe('AWS S3 provider', () => {
  const provider = CLOUD_PROVIDERS['aws-s3'];

  it('accepts a valid S3 presigned URL (virtual-hosted)', () => {
    const url = 'https://mybucket.s3.us-east-1.amazonaws.com/key?X-Amz-Signature=abc';
    expect(provider.validateUrl(url)).toEqual({ valid: true });
  });

  it('accepts a valid S3 presigned URL (path-style)', () => {
    const url = 'https://s3.us-east-1.amazonaws.com/mybucket?X-Amz-Signature=abc';
    expect(provider.validateUrl(url)).toEqual({ valid: true });
  });

  it('rejects http:// URLs', () => {
    const url = 'http://mybucket.s3.us-east-1.amazonaws.com/key';
    expect(provider.validateUrl(url).valid).toBe(false);
  });

  it('rejects non-S3 hostnames', () => {
    const url = 'https://evil.com/bucket/key?X-Amz-Signature=abc';
    expect(provider.validateUrl(url).valid).toBe(false);
    expect(provider.validateUrl(url).error).toContain('amazonaws.com');
  });

  it('builds object URL preserving query params', () => {
    const base = 'https://mybucket.s3.us-east-1.amazonaws.com/?X-Amz-Signature=abc';
    const url = provider.buildObjectUrl(base, 'threatcaddy/test.json');
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/threatcaddy/test.json');
    expect(parsed.searchParams.get('X-Amz-Signature')).toBe('abc');
  });

  it('returns no extra headers', () => {
    expect(provider.extraHeaders()).toEqual({});
  });
});

// ---- Azure Blob Validation ----

describe('Azure Blob provider', () => {
  const provider = CLOUD_PROVIDERS['azure-blob'];

  it('accepts a valid Azure SAS URL', () => {
    const url = 'https://myaccount.blob.core.windows.net/container?sv=2020&sig=abc';
    expect(provider.validateUrl(url)).toEqual({ valid: true });
  });

  it('rejects http:// URLs', () => {
    const url = 'http://myaccount.blob.core.windows.net/container?sv=2020&sig=abc';
    expect(provider.validateUrl(url).valid).toBe(false);
  });

  it('rejects non-Azure hostnames', () => {
    const url = 'https://evil.com/container?sv=2020&sig=abc';
    expect(provider.validateUrl(url).valid).toBe(false);
    expect(provider.validateUrl(url).error).toContain('blob.core.windows.net');
  });

  it('builds object URL preserving SAS query params', () => {
    const base = 'https://myaccount.blob.core.windows.net/container?sv=2020&sig=abc';
    const url = provider.buildObjectUrl(base, 'threatcaddy/test.json');
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/container/threatcaddy/test.json');
    expect(parsed.searchParams.get('sv')).toBe('2020');
    expect(parsed.searchParams.get('sig')).toBe('abc');
  });

  it('returns x-ms-blob-type header', () => {
    expect(provider.extraHeaders()).toEqual({ 'x-ms-blob-type': 'BlockBlob' });
  });
});

// ---- GCS Validation ----

describe('GCS provider', () => {
  const provider = CLOUD_PROVIDERS['gcs'];

  it('accepts a valid GCS signed URL (googleapis.com)', () => {
    const url = 'https://storage.googleapis.com/bucket/key?X-Goog-Signature=abc';
    expect(provider.validateUrl(url)).toEqual({ valid: true });
  });

  it('accepts a valid GCS URL (cloud.google.com)', () => {
    const url = 'https://storage.cloud.google.com/bucket/key';
    expect(provider.validateUrl(url)).toEqual({ valid: true });
  });

  it('rejects http:// URLs', () => {
    const url = 'http://storage.googleapis.com/bucket/key';
    expect(provider.validateUrl(url).valid).toBe(false);
  });

  it('rejects non-GCS hostnames', () => {
    const url = 'https://evil.com/bucket/key?X-Goog-Signature=abc';
    expect(provider.validateUrl(url).valid).toBe(false);
    expect(provider.validateUrl(url).error).toContain('storage.googleapis.com');
  });

  it('builds object URL preserving query params', () => {
    const base = 'https://storage.googleapis.com/bucket?X-Goog-Signature=abc';
    const url = provider.buildObjectUrl(base, 'threatcaddy/test.json');
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/bucket/threatcaddy/test.json');
    expect(parsed.searchParams.get('X-Goog-Signature')).toBe('abc');
  });

  it('returns no extra headers', () => {
    expect(provider.extraHeaders()).toEqual({});
  });
});

// ---- detectProvider ----

describe('detectProvider', () => {
  it('detects OCI from hostname', () => {
    expect(detectProvider('https://objectstorage.us-ashburn-1.oraclecloud.com/p/token/n/ns/b/bucket/o/')).toBe('oci');
  });

  it('detects AWS S3 from virtual-hosted hostname', () => {
    expect(detectProvider('https://mybucket.s3.us-east-1.amazonaws.com/key')).toBe('aws-s3');
  });

  it('detects AWS S3 from path-style hostname', () => {
    expect(detectProvider('https://s3.us-east-1.amazonaws.com/bucket')).toBe('aws-s3');
  });

  it('detects Azure Blob from hostname', () => {
    expect(detectProvider('https://myaccount.blob.core.windows.net/container')).toBe('azure-blob');
  });

  it('detects GCS from googleapis.com', () => {
    expect(detectProvider('https://storage.googleapis.com/bucket/key')).toBe('gcs');
  });

  it('detects GCS from cloud.google.com', () => {
    expect(detectProvider('https://storage.cloud.google.com/bucket/key')).toBe('gcs');
  });

  it('returns null for unknown URLs', () => {
    expect(detectProvider('https://example.com/file')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(detectProvider('')).toBeNull();
  });

  it('returns null for invalid URL', () => {
    expect(detectProvider('not-a-url')).toBeNull();
  });
});

// ---- sanitizePath ----

describe('sanitizePath', () => {
  it('strips .. sequences', () => {
    expect(sanitizePath('threatcaddy/../secret')).not.toContain('..');
  });

  it('strips query params', () => {
    expect(sanitizePath('test.json?evil=1')).not.toContain('?');
  });

  it('strips hash fragments', () => {
    expect(sanitizePath('test.json#frag')).not.toContain('#');
  });

  it('strips leading slashes', () => {
    expect(sanitizePath('///test.json')).toBe('test.json');
  });

  it('decodes percent-encoded path traversal', () => {
    expect(sanitizePath('%2e%2e/secret')).not.toContain('..');
  });

  it('returns empty string for pure traversal', () => {
    expect(sanitizePath('../../../')).toBe('');
  });

  it('handles normal paths unchanged', () => {
    expect(sanitizePath('threatcaddy/backups/test.json')).toBe('threatcaddy/backups/test.json');
  });
});
