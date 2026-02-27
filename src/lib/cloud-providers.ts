import type { CloudProvider } from '../types';

export interface CloudProviderConfig {
  name: string;
  placeholder: string;
  hostnameHint: string;
  validateUrl: (url: string) => { valid: boolean; error?: string };
  buildObjectUrl: (baseUrl: string, objectPath: string) => string;
  extraHeaders: () => Record<string, string>;
}

// ---- Shared helpers ----

export function sanitizePath(objectPath: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(objectPath);
  } catch {
    decoded = objectPath;
  }
  const sanitized = decoded
    .replace(/\.\./g, '')
    .replace(/[?#]/g, '')
    .replace(/^\/+/, '');
  return sanitized;
}

function requireHttps(url: string): { parsed: URL } | { error: string } {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return { error: 'Invalid URL format' };
  }
  if (parsed.protocol !== 'https:') {
    return { error: 'URL must use HTTPS' };
  }
  return { parsed };
}

// ---- OCI ----

const ociConfig: CloudProviderConfig = {
  name: 'Oracle Cloud (OCI)',
  placeholder: 'https://objectstorage.us-ashburn-1.oraclecloud.com/p/.../o/',
  hostnameHint: 'objectstorage.*.oraclecloud.com',
  validateUrl(url) {
    if (!url || typeof url !== 'string') return { valid: false, error: 'URL is required' };
    const result = requireHttps(url);
    if ('error' in result) return { valid: false, error: result.error };
    if (!/^objectstorage\..*\.oraclecloud\.com$/i.test(result.parsed.hostname)) {
      return { valid: false, error: 'OCI URL must be an objectstorage.*.oraclecloud.com endpoint' };
    }
    if (!url.includes('/p/') || !url.includes('/o/')) {
      return { valid: false, error: 'OCI PAR URL must contain /p/ and /o/ path segments' };
    }
    return { valid: true };
  },
  buildObjectUrl(baseUrl, objectPath) {
    const safe = sanitizePath(objectPath);
    if (!safe) throw new Error('Invalid object path');
    const prefix = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
    return prefix + safe;
  },
  extraHeaders: () => ({}),
};

// ---- AWS S3 ----

const awsS3Config: CloudProviderConfig = {
  name: 'AWS S3',
  placeholder: 'https://bucket.s3.us-east-1.amazonaws.com/...',
  hostnameHint: '*.s3.*.amazonaws.com',
  validateUrl(url) {
    if (!url || typeof url !== 'string') return { valid: false, error: 'URL is required' };
    const result = requireHttps(url);
    if ('error' in result) return { valid: false, error: result.error };
    const h = result.parsed.hostname;
    if (!/(?:^|\.)s3[.-].*\.amazonaws\.com$/i.test(h)) {
      return { valid: false, error: 'AWS S3 URL must be a *.s3.*.amazonaws.com endpoint' };
    }
    return { valid: true };
  },
  buildObjectUrl(baseUrl, objectPath) {
    const safe = sanitizePath(objectPath);
    if (!safe) throw new Error('Invalid object path');
    // S3 presigned URLs have query params — insert path before them
    const parsed = new URL(baseUrl.trim());
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') + '/' + safe;
    return parsed.toString();
  },
  extraHeaders: () => ({}),
};

// ---- Azure Blob ----

const azureBlobConfig: CloudProviderConfig = {
  name: 'Azure Blob Storage',
  placeholder: 'https://account.blob.core.windows.net/container?sv=...',
  hostnameHint: '*.blob.core.windows.net',
  validateUrl(url) {
    if (!url || typeof url !== 'string') return { valid: false, error: 'URL is required' };
    const result = requireHttps(url);
    if ('error' in result) return { valid: false, error: result.error };
    if (!/\.blob\.core\.windows\.net$/i.test(result.parsed.hostname)) {
      return { valid: false, error: 'Azure URL must be a *.blob.core.windows.net endpoint' };
    }
    return { valid: true };
  },
  buildObjectUrl(baseUrl, objectPath) {
    const safe = sanitizePath(objectPath);
    if (!safe) throw new Error('Invalid object path');
    // Azure SAS URLs have query params — insert path before them
    const parsed = new URL(baseUrl.trim());
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') + '/' + safe;
    return parsed.toString();
  },
  extraHeaders: () => ({ 'x-ms-blob-type': 'BlockBlob' }),
};

// ---- GCS ----

const gcsConfig: CloudProviderConfig = {
  name: 'Google Cloud Storage',
  placeholder: 'https://storage.googleapis.com/bucket/...',
  hostnameHint: 'storage.googleapis.com',
  validateUrl(url) {
    if (!url || typeof url !== 'string') return { valid: false, error: 'URL is required' };
    const result = requireHttps(url);
    if ('error' in result) return { valid: false, error: result.error };
    const h = result.parsed.hostname.toLowerCase();
    if (h !== 'storage.googleapis.com' && h !== 'storage.cloud.google.com') {
      return { valid: false, error: 'GCS URL must be a storage.googleapis.com or storage.cloud.google.com endpoint' };
    }
    return { valid: true };
  },
  buildObjectUrl(baseUrl, objectPath) {
    const safe = sanitizePath(objectPath);
    if (!safe) throw new Error('Invalid object path');
    // GCS signed URLs may have query params
    const parsed = new URL(baseUrl.trim());
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') + '/' + safe;
    return parsed.toString();
  },
  extraHeaders: () => ({}),
};

// ---- Registry ----

export const CLOUD_PROVIDERS: Record<CloudProvider, CloudProviderConfig> = {
  'oci': ociConfig,
  'aws-s3': awsS3Config,
  'azure-blob': azureBlobConfig,
  'gcs': gcsConfig,
};

// ---- Auto-detect provider from URL ----

export function detectProvider(url: string): CloudProvider | null {
  if (!url) return null;
  let hostname: string;
  try {
    hostname = new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (/^objectstorage\..*\.oraclecloud\.com$/i.test(hostname)) return 'oci';
  if (/(?:^|\.)s3[.-].*\.amazonaws\.com$/i.test(hostname)) return 'aws-s3';
  if (/\.blob\.core\.windows\.net$/i.test(hostname)) return 'azure-blob';
  if (hostname === 'storage.googleapis.com' || hostname === 'storage.cloud.google.com') return 'gcs';
  return null;
}
