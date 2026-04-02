/**
 * AgentProfilePicker — modal to deploy agent profiles to an investigation.
 */

import { X, Plus, Check } from 'lucide-react';
import type { AgentProfile, AgentDeployment } from '../../types';
import { cn } from '../../lib/utils';

interface AgentProfilePickerProps {
  profiles: AgentProfile[];
  deployments: AgentDeployment[];
  onDeploy: (profile: AgentProfile) => void;
  onClose: () => void;
}

export function AgentProfilePicker({ profiles, deployments, onDeploy, onClose }: AgentProfilePickerProps) {
  const deployedProfileIds = new Set(deployments.map(d => d.profileId));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface border border-border-subtle rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
          <h3 className="text-sm font-semibold text-text-primary">Deploy Agent Profile</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-secondary">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-2 max-h-96 overflow-auto">
          {profiles.map(profile => {
            const isDeployed = deployedProfileIds.has(profile.id);
            return (
              <button
                key={profile.id}
                onClick={() => !isDeployed && onDeploy(profile)}
                disabled={isDeployed}
                className={cn(
                  'w-full flex items-center gap-3 text-left p-3 rounded-lg border transition-colors',
                  isDeployed
                    ? 'border-accent-green/30 bg-accent-green/5 cursor-default'
                    : 'border-border-subtle bg-surface hover:bg-surface-raised hover:border-border-medium',
                )}
              >
                <span className="text-lg">{profile.icon || '🤖'}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-text-primary">{profile.name}</div>
                  <div className="text-[10px] text-text-muted truncate">
                    {profile.role} — {profile.description?.substring(0, 80) || profile.systemPrompt.substring(0, 80)}
                  </div>
                  {profile.allowedTools && (
                    <div className="text-[9px] text-text-muted mt-0.5">{profile.allowedTools.length} tools</div>
                  )}
                </div>
                {isDeployed ? (
                  <Check size={14} className="text-accent-green shrink-0" />
                ) : (
                  <Plus size={14} className="text-text-muted shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
