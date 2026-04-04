/**
 * AgentProfilePicker — modal to deploy agent profiles to an investigation.
 * Allows multiple deployments of the same profile (for competition/redundancy).
 */

import { useEffect } from 'react';
import { X, Plus, Wrench } from 'lucide-react';
import type { AgentProfile, AgentDeployment } from '../../types';

interface AgentProfilePickerProps {
  profiles: AgentProfile[];
  deployments: AgentDeployment[];
  onDeploy: (profile: AgentProfile) => void;
  onCreateProfile?: () => void;
  onClose: () => void;
}

export function AgentProfilePicker({ profiles, deployments, onDeploy, onCreateProfile, onClose }: AgentProfilePickerProps) {
  // Escape key closes modal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);
  // Count how many of each profile are deployed (allow multiples)
  const deployedCounts = new Map<string, number>();
  for (const d of deployments) {
    deployedCounts.set(d.profileId, (deployedCounts.get(d.profileId) || 0) + 1);
  }

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
            const count = deployedCounts.get(profile.id) || 0;
            return (
              <button
                key={profile.id}
                onClick={() => onDeploy(profile)}
                className="w-full flex items-center gap-3 text-left p-3 rounded-lg border transition-colors border-border-subtle bg-surface hover:bg-surface-raised hover:border-border-medium"
              >
                <span className="text-lg">{profile.icon || '🤖'}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-text-primary">{profile.name}</div>
                  <div className="text-[10px] text-text-muted truncate">
                    {profile.role} — {profile.description?.substring(0, 80) || profile.systemPrompt.substring(0, 80)}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {count > 0 && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent-green/10 text-accent-green">
                      {count} active
                    </span>
                  )}
                  <Plus size={14} className="text-text-muted" />
                </div>
              </button>
            );
          })}

          {/* Create new profile */}
          {onCreateProfile && (
            <button
              onClick={onCreateProfile}
              className="w-full flex items-center gap-3 text-left p-3 rounded-lg border border-dashed border-border-medium bg-transparent hover:bg-surface-raised transition-colors"
            >
              <Wrench size={16} className="text-text-muted" />
              <div className="flex-1">
                <div className="text-xs font-medium text-text-secondary">Create Custom Profile</div>
                <div className="text-[10px] text-text-muted">Define a new agent with custom role and instructions</div>
              </div>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
