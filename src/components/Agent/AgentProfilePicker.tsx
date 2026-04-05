/**
 * AgentProfilePicker — multi-select modal to deploy agent profiles.
 * Supports deploying multiple profiles at once with quantity per profile.
 */

import { useState, useEffect, useMemo } from 'react';
import { X, Plus, Minus, Wrench, Users } from 'lucide-react';
import type { AgentProfile, AgentDeployment } from '../../types';
import { cn } from '../../lib/utils';

interface AgentProfilePickerProps {
  profiles: AgentProfile[];
  deployments: AgentDeployment[];
  onDeployMultiple: (selections: { profile: AgentProfile; count: number }[]) => void;
  onCreateProfile?: () => void;
  onClose: () => void;
}

export function AgentProfilePicker({ profiles, deployments, onDeployMultiple, onCreateProfile, onClose }: AgentProfilePickerProps) {
  const [selections, setSelections] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const deployedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of deployments) counts.set(d.profileId, (counts.get(d.profileId) || 0) + 1);
    return counts;
  }, [deployments]);

  const totalSelected = Array.from(selections.values()).reduce((s, v) => s + v, 0);

  const toggleProfile = (id: string) => {
    const next = new Map(selections);
    if (next.has(id)) next.delete(id);
    else next.set(id, 1);
    setSelections(next);
  };

  const setCount = (id: string, count: number) => {
    const next = new Map(selections);
    if (count <= 0) next.delete(id);
    else next.set(id, Math.min(count, 5));
    setSelections(next);
  };

  const handleDeploy = () => {
    const result = Array.from(selections.entries())
      .filter(([, count]) => count > 0)
      .map(([id, count]) => ({ profile: profiles.find(p => p.id === id)!, count }))
      .filter(s => s.profile);
    if (result.length > 0) onDeployMultiple(result);
  };

  // Group profiles by category
  const groups = useMemo(() => {
    const g: { label: string; profiles: AgentProfile[] }[] = [];
    const exec = profiles.filter(p => p.role === 'executive' || p.role === 'lead');
    const spec = profiles.filter(p => p.role === 'specialist');
    const obs = profiles.filter(p => p.role === 'observer');
    if (exec.length) g.push({ label: 'Leadership', profiles: exec });
    if (spec.length) g.push({ label: 'Specialists', profiles: spec });
    if (obs.length) g.push({ label: 'Stakeholders & Advisors', profiles: obs });
    return g;
  }, [profiles]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface border border-border-subtle rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Deploy Agents</h3>
            <p className="text-[10px] text-text-muted">Select profiles and quantities to deploy</p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-secondary"><X size={16} /></button>
        </div>

        {/* Profile list */}
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {groups.map(group => (
            <div key={group.label}>
              <div className="text-[10px] text-text-muted uppercase tracking-wide mb-1.5">{group.label}</div>
              <div className="space-y-1.5">
                {group.profiles.map(profile => {
                  const selected = selections.has(profile.id);
                  const count = selections.get(profile.id) || 0;
                  const existing = deployedCounts.get(profile.id) || 0;
                  return (
                    <div key={profile.id} className={cn(
                      'flex items-center gap-2 p-2 rounded-lg border transition-colors cursor-pointer group',
                      selected ? 'border-accent-blue/40 bg-accent-blue/5' : 'border-border-subtle bg-surface hover:bg-surface-raised',
                    )} onClick={() => toggleProfile(profile.id)}
                    title={`${profile.name} (${profile.role}): ${profile.description || profile.systemPrompt.substring(0, 120)}`}>
                      <span className="text-lg shrink-0">{profile.icon || '🤖'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-text-primary">{profile.name}</div>
                        <div className="text-[10px] text-text-muted truncate">{profile.description?.substring(0, 70)}</div>
                      </div>
                      {existing > 0 && <span className="text-[9px] text-text-muted shrink-0">{existing} active</span>}
                      {selected && (
                        <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                          <button onClick={() => setCount(profile.id, count - 1)} className="w-5 h-5 flex items-center justify-center rounded bg-surface-raised hover:bg-bg-hover text-text-muted"><Minus size={10} /></button>
                          <span className="text-xs font-medium text-text-primary w-4 text-center">{count}</span>
                          <button onClick={() => setCount(profile.id, count + 1)} className="w-5 h-5 flex items-center justify-center rounded bg-surface-raised hover:bg-bg-hover text-text-muted"><Plus size={10} /></button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {onCreateProfile && (
            <button onClick={onCreateProfile}
              className="w-full flex items-center gap-2 p-2 rounded-lg border border-dashed border-border-medium hover:bg-surface-raised transition-colors">
              <Wrench size={14} className="text-text-muted" />
              <span className="text-xs text-text-secondary">Create Custom Profile</span>
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border-subtle shrink-0">
          <span className="text-xs text-text-muted">
            {totalSelected > 0 ? `${totalSelected} agent${totalSelected !== 1 ? 's' : ''} selected` : 'Select profiles to deploy'}
          </span>
          <button onClick={handleDeploy} disabled={totalSelected === 0}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium bg-accent-blue text-white hover:bg-accent-blue/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            <Users size={12} />
            Deploy {totalSelected > 0 ? `(${totalSelected})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
