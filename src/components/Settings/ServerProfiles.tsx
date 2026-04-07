import { useState } from 'react';
import { Server, Trash2, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { loadServerProfiles, saveServerProfiles, type ServerProfile } from '../../lib/server-profiles';

interface ServerProfilesProps {
  onSelectProfile: (profile: ServerProfile) => void;
  currentUrl?: string;
}

export function ServerProfiles({ onSelectProfile, currentUrl }: ServerProfilesProps) {
  const { t } = useTranslation('settings');
  const [profiles, setProfiles] = useState<ServerProfile[]>(loadServerProfiles);

  const handleDelete = (id: string) => {
    const updated = profiles.filter(p => p.id !== id);
    setProfiles(updated);
    saveServerProfiles(updated);
  };

  if (profiles.length === 0) return null;

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider">{t('server.savedServers')}</h4>
      <div className="space-y-1.5">
        {profiles.map(p => (
          <div
            key={p.id}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
              currentUrl === p.url
                ? 'border-green-600/40 bg-green-600/5'
                : 'border-[var(--border)] hover:bg-[var(--bg-tertiary)]'
            }`}
            onClick={() => onSelectProfile(p)}
          >
            <Server size={14} className={currentUrl === p.url ? 'text-green-500' : 'text-[var(--text-tertiary)]'} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-[var(--text-primary)] truncate">{p.label}</div>
              <div className="text-[10px] text-[var(--text-tertiary)] font-mono truncate">{p.url}</div>
            </div>
            {p.lastConnected && (
              <div className="flex items-center gap-1 text-[10px] text-[var(--text-tertiary)] shrink-0">
                <Clock size={10} />
                {new Date(p.lastConnected).toLocaleDateString()}
              </div>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }}
              className="p-1 rounded hover:bg-red-500/15 text-[var(--text-tertiary)] hover:text-red-400 transition-colors shrink-0"
              title={t('server.deleteSavedServer')}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
