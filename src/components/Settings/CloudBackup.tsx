import { useState, useRef, useEffect } from 'react';
import { AlertCircle, CheckCircle, Cloud, Upload, Loader2, Trash2, Plus, ToggleLeft, ToggleRight } from 'lucide-react';
import { useSettings } from '../../hooks/useSettings';
import { useCloudSync } from '../../hooks/useCloudSync';
import { testDestination } from '../../lib/cloud-sync';
import { CLOUD_PROVIDERS, detectProvider } from '../../lib/cloud-providers';
import { ConfirmDialog } from '../Common/ConfirmDialog';
import { useLogActivity } from '../../hooks/ActivityLogContext';
import type { CloudProvider, BackupDestination } from '../../types';

const PROVIDER_OPTIONS: { value: CloudProvider; label: string }[] = [
  { value: 'oci', label: 'Oracle Cloud (OCI)' },
  { value: 'aws-s3', label: 'AWS S3' },
  { value: 'azure-blob', label: 'Azure Blob Storage' },
  { value: 'gcs', label: 'Google Cloud Storage' },
];

export function CloudBackup() {
  const { settings, updateSettings } = useSettings();
  const cloud = useCloudSync();
  const logActivity = useLogActivity();

  const destinations = settings.backupDestinations ?? [];

  // Add-destination form state
  const [addProvider, setAddProvider] = useState<CloudProvider>('oci');
  const [addLabel, setAddLabel] = useState('');
  const [addUrl, setAddUrl] = useState('');
  const [addError, setAddError] = useState('');

  // Test results keyed by destination id
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; error?: string; testing: boolean }>>({});

  const [message, setMessage] = useState('');
  const [confirmPush, setConfirmPush] = useState(false);

  const msgTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(msgTimeoutRef.current), []);

  const showMessage = (msg: string) => {
    setMessage(msg);
    clearTimeout(msgTimeoutRef.current);
    msgTimeoutRef.current = setTimeout(() => setMessage(''), 5000);
  };

  // Auto-detect provider when URL is pasted
  const handleUrlChange = (url: string) => {
    setAddUrl(url);
    setAddError('');
    const detected = detectProvider(url);
    if (detected) setAddProvider(detected);
  };

  const handleAddDestination = () => {
    const trimmedUrl = addUrl.trim();
    const trimmedLabel = addLabel.trim();
    if (!trimmedUrl) { setAddError('URL is required'); return; }
    if (!trimmedLabel) { setAddError('Label is required'); return; }

    const provider = CLOUD_PROVIDERS[addProvider];
    const validation = provider.validateUrl(trimmedUrl);
    if (!validation.valid) { setAddError(validation.error || 'Invalid URL'); return; }

    const newDest: BackupDestination = {
      id: `dest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      provider: addProvider,
      label: trimmedLabel,
      url: trimmedUrl,
      enabled: true,
    };

    updateSettings({ backupDestinations: [...destinations, newDest] });
    setAddUrl('');
    setAddLabel('');
    setAddError('');
    showMessage('Destination added');
  };

  const handleRemoveDestination = (id: string) => {
    updateSettings({ backupDestinations: destinations.filter((d) => d.id !== id) });
  };

  const handleToggleDestination = (id: string) => {
    updateSettings({
      backupDestinations: destinations.map((d) =>
        d.id === id ? { ...d, enabled: !d.enabled } : d,
      ),
    });
  };

  const handleTestDestination = async (dest: BackupDestination) => {
    setTestResults((prev) => ({ ...prev, [dest.id]: { ok: false, testing: true } }));
    const result = await testDestination(dest);
    setTestResults((prev) => ({ ...prev, [dest.id]: { ...result, testing: false } }));
  };

  const handlePushBackup = async () => {
    setConfirmPush(false);
    await cloud.pushFullBackup();
    if (!cloud.error) {
      showMessage('Backup pushed successfully');
      logActivity('sync', 'backup', `Pushed full backup to ${cloud.lastResults.length} destination(s)`);
    }
  };

  const maskUrl = (url: string) => {
    try {
      const parsed = new URL(url);
      return `${parsed.protocol}//${parsed.hostname}/***`;
    } catch {
      return '***';
    }
  };

  const providerBadge = (provider: CloudProvider) => {
    const labels: Record<CloudProvider, string> = { 'oci': 'OCI', 'aws-s3': 'S3', 'azure-blob': 'Azure', 'gcs': 'GCS' };
    const colors: Record<CloudProvider, string> = { 'oci': 'bg-red-900/30 text-red-400', 'aws-s3': 'bg-orange-900/30 text-orange-400', 'azure-blob': 'bg-blue-900/30 text-blue-400', 'gcs': 'bg-green-900/30 text-green-400' };
    return <span className={`text-[10px] px-1.5 py-0.5 rounded ${colors[provider]}`}>{labels[provider]}</span>;
  };

  const btnClass = 'flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors';
  const inputClass = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent';

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
        <Cloud size={16} />
        Cloud Backup
      </h3>

      {/* Existing destinations */}
      {destinations.length > 0 && (
        <div className="space-y-2">
          {destinations.map((dest) => {
            const test = testResults[dest.id];
            return (
              <div key={dest.id} className="bg-gray-800/50 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  {providerBadge(dest.provider)}
                  <span className="text-sm text-gray-200 flex-1 truncate">{dest.label}</span>
                  <button
                    onClick={() => handleToggleDestination(dest.id)}
                    className="p-1 rounded text-gray-400 hover:text-gray-200"
                    title={dest.enabled ? 'Disable' : 'Enable'}
                    aria-label={dest.enabled ? 'Disable destination' : 'Enable destination'}
                  >
                    {dest.enabled ? <ToggleRight size={18} className="text-green-400" /> : <ToggleLeft size={18} />}
                  </button>
                  <button
                    onClick={() => handleTestDestination(dest)}
                    disabled={test?.testing}
                    className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 disabled:opacity-50"
                  >
                    {test?.testing ? <Loader2 size={12} className="animate-spin" /> : 'Test'}
                  </button>
                  <button
                    onClick={() => handleRemoveDestination(dest.id)}
                    className="p-1 rounded text-gray-500 hover:text-red-400"
                    title="Remove"
                    aria-label="Remove destination"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="text-xs text-gray-500 font-mono truncate">{maskUrl(dest.url)}</div>
                {test && !test.testing && (
                  <p className={`text-xs flex items-center gap-1 ${test.ok ? 'text-green-400' : 'text-red-400'}`}>
                    {test.ok ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
                    {test.ok ? 'Connected successfully' : test.error}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add destination form */}
      <div className="bg-gray-800/30 rounded-lg p-3 space-y-3">
        <h4 className="text-xs font-semibold text-gray-400 flex items-center gap-1">
          <Plus size={12} />
          Add Destination
        </h4>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Provider</label>
          <select
            value={addProvider}
            onChange={(e) => setAddProvider(e.target.value as CloudProvider)}
            className={`${inputClass} cursor-pointer`}
          >
            {PROVIDER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Label</label>
          <input
            type="text"
            value={addLabel}
            onChange={(e) => setAddLabel(e.target.value)}
            className={inputClass}
            placeholder="e.g. Team S3 Bucket"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Presigned / SAS URL</label>
          <input
            type="password"
            value={addUrl}
            onChange={(e) => handleUrlChange(e.target.value)}
            className={`${inputClass} font-mono`}
            placeholder={CLOUD_PROVIDERS[addProvider].placeholder}
          />
        </div>

        {addError && (
          <p className="text-xs text-red-400 flex items-center gap-1">
            <AlertCircle size={12} />
            {addError}
          </p>
        )}

        <button
          onClick={handleAddDestination}
          className={`${btnClass} bg-accent hover:bg-accent-hover text-white`}
        >
          <Plus size={16} />
          Add Destination
        </button>
      </div>

      {/* Full Backup */}
      <div className="pt-2 border-t border-gray-800 space-y-3">
        <h4 className="text-sm font-semibold text-gray-400">Full Backup</h4>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => setConfirmPush(true)}
            disabled={!cloud.hasDestinations || cloud.syncing}
            className={`${btnClass} bg-gray-700 hover:bg-gray-600 text-gray-200 disabled:opacity-50`}
          >
            {cloud.syncing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            Push Backup
          </button>
        </div>
        {cloud.lastSyncAt && (
          <p className="text-xs text-gray-500">Last sync: {new Date(cloud.lastSyncAt).toLocaleString()}</p>
        )}
        {/* Per-destination results */}
        {cloud.lastResults.length > 1 && (
          <div className="space-y-1">
            {cloud.lastResults.map((r) => (
              <p key={r.destinationId} className={`text-xs flex items-center gap-1 ${r.ok ? 'text-green-400' : 'text-red-400'}`}>
                {r.ok ? <CheckCircle size={10} /> : <AlertCircle size={10} />}
                {r.label}: {r.ok ? 'OK' : r.error}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Status */}
      {(cloud.progress || cloud.error || message) && (
        <div className="pt-2">
          {cloud.progress && <p className="text-sm text-accent">{cloud.progress}</p>}
          {cloud.error && (
            <p className="text-sm text-red-400 flex items-center gap-1">
              <AlertCircle size={14} />
              {cloud.error}
            </p>
          )}
          {message && !cloud.error && !cloud.progress && (
            <p className="text-sm text-green-400">{message}</p>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmPush}
        onClose={() => setConfirmPush(false)}
        onConfirm={handlePushBackup}
        title="Push Backup"
        message={`This will upload your entire database to ${destinations.filter((d) => d.enabled).length} cloud destination(s). Continue?`}
        confirmLabel="Push Backup"
      />
    </div>
  );
}
