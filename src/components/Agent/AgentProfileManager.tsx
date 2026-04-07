/**
 * AgentProfileManager — CRUD UI for agent profiles in Settings.
 * Follows TemplateManager pattern: builtin (read-only + duplicate) + user (full CRUD).
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Plus, Pencil, Trash2, Copy, ChevronDown, ChevronRight, X, Download, Upload } from 'lucide-react';
import type { AgentProfile } from '../../types';
import { cn } from '../../lib/utils';

interface AgentProfileManagerProps {
  profiles: AgentProfile[];
  userProfiles: AgentProfile[];
  builtinProfiles: AgentProfile[];
  onCreateProfile: (partial: Partial<AgentProfile> & { name: string; systemPrompt: string }) => Promise<AgentProfile>;
  onUpdateProfile: (id: string, updates: Partial<AgentProfile>) => Promise<void>;
  onDeleteProfile: (id: string) => Promise<void>;
  onDuplicateBuiltin: (id: string) => Promise<AgentProfile | null>;
}

export function AgentProfileManager({
  userProfiles, builtinProfiles,
  onCreateProfile, onUpdateProfile, onDeleteProfile, onDuplicateBuiltin,
}: AgentProfileManagerProps) {
  const { t } = useTranslation('agent');
  const [expanded, setExpanded] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full text-left mb-2"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Bot size={16} className="text-accent-blue" />
        <span className="text-sm font-semibold text-text-secondary">{t('profile.agentProfiles')}</span>
        <span className="text-xs text-text-muted ml-auto">{t('profile.customAndBuiltin', { custom: userProfiles.length, builtin: builtinProfiles.length })}</span>
      </button>

      {expanded && (
        <div className="space-y-3 ml-6">
          {/* User profiles */}
          {userProfiles.length > 0 && (
            <div>
              <div className="text-[10px] text-text-muted uppercase tracking-wide mb-1">{t('profile.yourProfiles')}</div>
              {userProfiles.map(p => (
                editingId === p.id ? (
                  <ProfileForm
                    key={p.id}
                    profile={p}
                    onSave={async (updates) => { await onUpdateProfile(p.id, updates); setEditingId(null); }}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <ProfileRow
                    key={p.id}
                    profile={p}
                    onEdit={() => setEditingId(p.id)}
                    onDelete={() => onDeleteProfile(p.id)}
                  />
                )
              ))}
            </div>
          )}

          {/* Create form */}
          {showCreate ? (
            <ProfileForm
              onSave={async (data) => {
                await onCreateProfile(data as Partial<AgentProfile> & { name: string; systemPrompt: string });
                setShowCreate(false);
              }}
              onCancel={() => setShowCreate(false)}
            />
          ) : (
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 text-xs text-accent-blue hover:underline"
            >
              <Plus size={12} />
              {t('profile.createProfile')}
            </button>
          )}

          {/* Export/Import */}
          <div className="flex gap-2 mt-1">
            {userProfiles.length > 0 && (
              <button onClick={() => {
                const json = JSON.stringify(userProfiles, null, 2);
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = 'agent-profiles.json'; a.click();
                URL.revokeObjectURL(url);
              }} className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-secondary">
                <Download size={10} /> {t('profile.export')}
              </button>
            )}
            <button onClick={() => {
              const input = document.createElement('input'); input.type = 'file'; input.accept = '.json';
              input.onchange = async (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (!file) return;
                try {
                  const text = await file.text();
                  const profiles = JSON.parse(text);
                  if (!Array.isArray(profiles)) return;
                  for (const p of profiles) {
                    if (p.name && p.systemPrompt) {
                      await onCreateProfile({ ...p, id: undefined, source: 'user' } as Partial<AgentProfile> & { name: string; systemPrompt: string });
                    }
                  }
                } catch { /* invalid file */ }
              };
              input.click();
            }} className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-secondary">
              <Upload size={10} /> {t('profile.import')}
            </button>
          </div>

          {/* Built-in profiles */}
          <div>
            <div className="text-[10px] text-text-muted uppercase tracking-wide mb-1 mt-3">{t('profile.builtinProfiles')}</div>
            {builtinProfiles.map(p => (
              <ProfileRow
                key={p.id}
                profile={p}
                isBuiltin
                onDuplicate={() => onDuplicateBuiltin(p.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileRow({ profile, isBuiltin, onEdit, onDelete, onDuplicate }: {
  profile: AgentProfile;
  isBuiltin?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
}) {
  const { t } = useTranslation('agent');
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded border border-border-subtle/50 mb-1">
      {/* Header row */}
      <div className="flex items-center gap-2 py-1.5 px-2 cursor-pointer hover:bg-surface-raised/50 group" role="button" tabIndex={0} aria-expanded={expanded} onClick={() => setExpanded(!expanded)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(!expanded); } }}>
        <span className="text-sm">{profile.icon || '🤖'}</span>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-text-primary truncate">{profile.name}</div>
          <div className="text-[10px] text-text-muted truncate">{profile.role} — {profile.description?.substring(0, 60) || t('profile.noDescription')}</div>
        </div>
        <div className="flex items-center gap-1">
          <ChevronDown size={12} className={cn('text-text-muted transition-transform', !expanded && '-rotate-90')} />
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
            {isBuiltin ? (
              <button onClick={onDuplicate} className="text-text-muted hover:text-text-secondary p-0.5" title={t('profile.duplicateToCustomize')}>
                <Copy size={12} />
              </button>
            ) : (
              <>
                <button onClick={onEdit} className="text-text-muted hover:text-text-secondary p-0.5" title="Edit">
                  <Pencil size={12} />
                </button>
                <button onClick={() => { if (onDelete && confirm(t('profile.deleteConfirm', { name: profile.name }))) onDelete(); }} className="text-text-muted hover:text-red-400 p-0.5" title={t('common:delete')} aria-label={`${t('common:delete')} ${profile.name}`}>
                  <Trash2 size={12} />
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-3 pb-2 space-y-2 border-t border-border-subtle/50">
          <div className="mt-2">
            <span className="text-[9px] text-text-muted uppercase tracking-wide">{t('profile.systemPrompt')}</span>
            <pre className="text-[10px] text-text-secondary bg-surface-raised rounded p-2 mt-0.5 whitespace-pre-wrap max-h-24 overflow-auto font-mono">{profile.systemPrompt}</pre>
          </div>
          <div className="flex gap-4">
            <div className="flex-1">
              <span className="text-[9px] text-text-muted uppercase tracking-wide">{t('profile.role')}</span>
              <p className="text-[10px] text-text-primary mt-0.5">{profile.role}</p>
            </div>
            <div className="flex-1">
              <span className="text-[9px] text-text-muted uppercase tracking-wide">{t('profile.priority')}</span>
              <p className="text-[10px] text-text-primary mt-0.5">{profile.priority ?? t('profile.default')}</p>
            </div>
            <div className="flex-1">
              <span className="text-[9px] text-text-muted uppercase tracking-wide">{t('profile.modelLabel')}</span>
              <p className="text-[10px] text-text-primary mt-0.5">{profile.model || t('profile.auto')}</p>
            </div>
          </div>
          {profile.allowedTools && (
            <div>
              <span className="text-[9px] text-text-muted uppercase tracking-wide">{t('profile.allowedTools', { count: profile.allowedTools.length })}</span>
              <p className="text-[10px] text-text-muted mt-0.5 font-mono">{profile.allowedTools.join(', ')}</p>
            </div>
          )}
          {!profile.allowedTools && (
            <p className="text-[10px] text-text-muted">{t('profile.allToolsAvailable')}</p>
          )}
          {profile.readOnlyEntityTypes?.length ? (
            <div>
              <span className="text-[9px] text-text-muted uppercase tracking-wide">Read-only entities</span>
              <p className="text-[10px] text-text-muted mt-0.5">{profile.readOnlyEntityTypes.join(', ')}</p>
            </div>
          ) : null}
          <div>
            <span className="text-[9px] text-text-muted uppercase tracking-wide">{t('profile.autoApprovePolicy')}</span>
            <div className="flex gap-2 mt-0.5 text-[10px]">
              <span className={profile.policy.autoApproveReads ? 'text-accent-green' : 'text-text-muted'}>{t('profile.reads')} {profile.policy.autoApproveReads ? '✓' : '✗'}</span>
              <span className={profile.policy.autoApproveEnrich ? 'text-accent-green' : 'text-text-muted'}>{t('profile.enrichLabel')} {profile.policy.autoApproveEnrich ? '✓' : '✗'}</span>
              <span className={profile.policy.autoApproveFetch ? 'text-accent-green' : 'text-text-muted'}>{t('profile.fetchLabel')} {profile.policy.autoApproveFetch ? '✓' : '✗'}</span>
              <span className={profile.policy.autoApproveCreate ? 'text-accent-green' : 'text-text-muted'}>{t('profile.createLabel')} {profile.policy.autoApproveCreate ? '✓' : '✗'}</span>
              <span className={profile.policy.autoApproveModify ? 'text-accent-green' : 'text-text-muted'}>{t('profile.modifyLabel')} {profile.policy.autoApproveModify ? '✓' : '✗'}</span>
            </div>
          </div>
          {/* Soul */}
          {profile.soul ? (
            <div className="border border-border-subtle rounded-lg p-2.5 space-y-2 bg-surface-base/50">
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-text-muted uppercase tracking-wide">Soul</span>
                <span className="text-[10px] font-mono text-accent-blue">{profile.soul.lifetimeMetrics.performanceScore}/100</span>
              </div>
              <p className="text-[10px] text-text-secondary italic">{profile.soul.identity}</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
                <div><span className="text-text-muted">Investigations:</span> <span className="text-text-primary">{profile.soul.lifetimeMetrics.investigationsWorked}</span></div>
                <div><span className="text-text-muted">Cycles:</span> <span className="text-text-primary">{profile.soul.lifetimeMetrics.totalCycles}</span></div>
                <div><span className="text-text-muted">Tasks done:</span> <span className="text-text-primary">{profile.soul.lifetimeMetrics.tasksCompleted}</span></div>
                <div><span className="text-text-muted">Rejected:</span> <span className="text-text-primary">{profile.soul.lifetimeMetrics.tasksRejected}</span></div>
              </div>
              {profile.soul.strengths.length > 0 && (
                <div>
                  <span className="text-[9px] text-accent-green">Strengths:</span>
                  <span className="text-[10px] text-text-muted ml-1">{profile.soul.strengths.slice(0, 5).join(', ')}</span>
                </div>
              )}
              {profile.soul.weaknesses.length > 0 && (
                <div>
                  <span className="text-[9px] text-accent-amber">Improve:</span>
                  <span className="text-[10px] text-text-muted ml-1">{profile.soul.weaknesses.slice(0, 5).join(', ')}</span>
                </div>
              )}
              {profile.soul.lessons.length > 0 && (
                <div>
                  <span className="text-[9px] text-text-muted">Recent lessons ({profile.soul.lessons.length}):</span>
                  <ul className="mt-0.5 space-y-0.5">
                    {profile.soul.lessons.slice(0, 3).map((l, i) => (
                      <li key={i} className="text-[10px] text-text-muted pl-2 border-l border-border-subtle">{l.substring(0, 150)}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p className="text-[10px] text-text-muted italic">{t('profile.noSoulYet')}</p>
          )}
          {isBuiltin && (
            <button onClick={onDuplicate} className="text-[10px] text-accent-blue hover:underline">
              {t('profile.customize')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ProfileForm({ profile, onSave, onCancel }: {
  profile?: AgentProfile;
  onSave: (data: Partial<AgentProfile>) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation('agent');
  const [name, setName] = useState(profile?.name || '');
  const [description, setDescription] = useState(profile?.description || '');
  const [icon, setIcon] = useState(profile?.icon || '🤖');
  const [role, setRole] = useState<'executive' | 'lead' | 'specialist' | 'observer'>(profile?.role || 'specialist');
  const [systemPrompt, setSystemPrompt] = useState(profile?.systemPrompt || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim() || !systemPrompt.trim()) return;
    setSaving(true);
    await onSave({ name: name.trim(), description: description.trim(), icon, role: role as AgentProfile['role'], systemPrompt: systemPrompt.trim() });
    setSaving(false);
  };

  const inputClass = 'w-full bg-surface-raised border border-border-subtle rounded px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-blue/50';

  return (
    <div className="border border-border-subtle rounded-lg p-3 space-y-2 bg-surface-raised/30">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-text-secondary">{profile ? t('profile.editProfile') : t('profile.newProfile')} {t('profile.profileLabel')}</span>
        <button onClick={onCancel} className="text-text-muted hover:text-text-secondary"><X size={12} /></button>
      </div>
      <div className="flex gap-2">
        <input value={icon} onChange={e => setIcon(e.target.value)} className="w-10 bg-surface-raised border border-border-subtle rounded px-1 py-1.5 text-xs text-center text-text-primary focus:outline-none focus:border-accent-blue/50" maxLength={2} title="Icon emoji" />
        <input value={name} onChange={e => setName(e.target.value)} placeholder={t('profile.profileName')} className={cn(inputClass, 'flex-1')} />
      </div>
      <input value={description} onChange={e => setDescription(e.target.value)} placeholder={t('profile.briefDescription')} className={inputClass} />
      <select value={role} onChange={e => setRole(e.target.value as 'executive' | 'lead' | 'specialist' | 'observer')} className={inputClass}>
        <option value="executive">{t('profile.executiveRole')}</option>
        <option value="lead">{t('profile.leadRole')}</option>
        <option value="specialist">{t('profile.specialistRole')}</option>
        <option value="observer">{t('profile.observerRole')}</option>
      </select>
      <textarea
        value={systemPrompt}
        onChange={e => setSystemPrompt(e.target.value)}
        placeholder={t('profile.systemPromptPlaceholder')}
        rows={4}
        className={cn(inputClass, 'resize-none')}
      />
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="text-xs text-text-muted hover:text-text-secondary px-2 py-1">{t('common:cancel')}</button>
        <button
          onClick={handleSave}
          disabled={!name.trim() || !systemPrompt.trim() || saving}
          className="text-xs bg-accent-blue text-white px-3 py-1 rounded disabled:opacity-50"
        >
          {saving ? t('profile.saving') : profile ? t('profile.update') : t('common:create')}
        </button>
      </div>
    </div>
  );
}
