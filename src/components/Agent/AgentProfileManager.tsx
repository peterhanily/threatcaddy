/**
 * AgentProfileManager — CRUD UI for agent profiles in Settings.
 * Follows TemplateManager pattern: builtin (read-only + duplicate) + user (full CRUD).
 */

import { useState } from 'react';
import { Bot, Plus, Pencil, Trash2, Copy, ChevronDown, ChevronRight, X } from 'lucide-react';
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
        <span className="text-sm font-semibold text-gray-300">Agent Profiles</span>
        <span className="text-xs text-gray-500 ml-auto">{userProfiles.length} custom, {builtinProfiles.length} built-in</span>
      </button>

      {expanded && (
        <div className="space-y-3 ml-6">
          {/* User profiles */}
          {userProfiles.length > 0 && (
            <div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Your Profiles</div>
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
              Create Profile
            </button>
          )}

          {/* Built-in profiles */}
          <div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1 mt-3">Built-in Profiles</div>
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
  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-gray-800/50 group">
      <span className="text-sm">{profile.icon || '🤖'}</span>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-gray-200 truncate">{profile.name}</div>
        <div className="text-[10px] text-gray-500 truncate">{profile.role} — {profile.description?.substring(0, 60) || 'No description'}</div>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {isBuiltin ? (
          <button onClick={onDuplicate} className="text-gray-500 hover:text-gray-300 p-0.5" title="Duplicate to customize">
            <Copy size={12} />
          </button>
        ) : (
          <>
            <button onClick={onEdit} className="text-gray-500 hover:text-gray-300 p-0.5" title="Edit">
              <Pencil size={12} />
            </button>
            <button onClick={onDelete} className="text-gray-500 hover:text-red-400 p-0.5" title="Delete">
              <Trash2 size={12} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ProfileForm({ profile, onSave, onCancel }: {
  profile?: AgentProfile;
  onSave: (data: Partial<AgentProfile>) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(profile?.name || '');
  const [description, setDescription] = useState(profile?.description || '');
  const [icon, setIcon] = useState(profile?.icon || '🤖');
  const [role, setRole] = useState<'lead' | 'specialist' | 'observer'>(profile?.role || 'specialist');
  const [systemPrompt, setSystemPrompt] = useState(profile?.systemPrompt || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim() || !systemPrompt.trim()) return;
    setSaving(true);
    await onSave({ name: name.trim(), description: description.trim(), icon, role: role as AgentProfile['role'], systemPrompt: systemPrompt.trim() });
    setSaving(false);
  };

  const inputClass = 'w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-accent-blue/50';

  return (
    <div className="border border-gray-700 rounded-lg p-3 space-y-2 bg-gray-800/30">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-300">{profile ? 'Edit' : 'New'} Profile</span>
        <button onClick={onCancel} className="text-gray-500 hover:text-gray-300"><X size={12} /></button>
      </div>
      <div className="flex gap-2">
        <input value={icon} onChange={e => setIcon(e.target.value)} className={cn(inputClass, 'w-10 text-center')} maxLength={2} />
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Profile name" className={cn(inputClass, 'flex-1')} />
      </div>
      <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Brief description" className={inputClass} />
      <select value={role} onChange={e => setRole(e.target.value as 'lead' | 'specialist' | 'observer')} className={inputClass}>
        <option value="lead">Lead — can delegate to other agents</option>
        <option value="specialist">Specialist — focused on specific tasks</option>
        <option value="observer">Observer — read-only analysis</option>
      </select>
      <textarea
        value={systemPrompt}
        onChange={e => setSystemPrompt(e.target.value)}
        placeholder="System prompt — instructions for this agent's behavior..."
        rows={4}
        className={cn(inputClass, 'resize-none')}
      />
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="text-xs text-gray-500 hover:text-gray-300 px-2 py-1">Cancel</button>
        <button
          onClick={handleSave}
          disabled={!name.trim() || !systemPrompt.trim() || saving}
          className="text-xs bg-accent-blue text-white px-3 py-1 rounded disabled:opacity-50"
        >
          {saving ? 'Saving...' : profile ? 'Update' : 'Create'}
        </button>
      </div>
    </div>
  );
}
