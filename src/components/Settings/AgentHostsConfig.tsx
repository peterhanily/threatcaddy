import { useState, useCallback } from 'react';
import { Plus, Trash2, RefreshCw, CheckCircle2, AlertTriangle, ChevronDown, ChevronRight, Loader2, Server } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { nanoid } from 'nanoid';
import type { Settings, AgentHost, AgentHostSkill } from '../../types';
import { fetchHostSkills } from '../../lib/agent-hosts';

interface AgentHostsConfigProps {
  settings: Settings;
  onUpdateSettings: (patch: Partial<Settings>) => void;
}

export function AgentHostsConfig({ settings, onUpdateSettings }: AgentHostsConfigProps) {
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation('common');
  const hosts = settings.agentHosts || [];
  const [adding, setAdding] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; msg: string } | null>(null);

  // Form state for new host
  const [formName, setFormName] = useState('');
  const [formDisplayName, setFormDisplayName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formApiKey, setFormApiKey] = useState('');

  const updateHosts = useCallback((newHosts: AgentHost[]) => {
    onUpdateSettings({ agentHosts: newHosts });
  }, [onUpdateSettings]);

  const addHost = useCallback(() => {
    const slug = formName.toLowerCase().replace(/[^a-z0-9-]/g, '').substring(0, 20);
    if (!slug || !formUrl) return;
    const newHost: AgentHost = {
      id: nanoid(),
      name: slug,
      displayName: formDisplayName || slug,
      url: formUrl.replace(/\/+$/, ''),
      apiKey: formApiKey || undefined,
      enabled: true,
      skills: [],
    };
    updateHosts([...hosts, newHost]);
    setAdding(false);
    setFormName('');
    setFormDisplayName('');
    setFormUrl('');
    setFormApiKey('');
  }, [formName, formDisplayName, formUrl, formApiKey, hosts, updateHosts]);

  const removeHost = useCallback((id: string) => {
    const host = hosts.find(h => h.id === id);
    if (!host) return;
    if (!confirm(t('agents.hostDeleteConfirm', { name: host.displayName }))) return;
    updateHosts(hosts.filter(h => h.id !== id));
    if (expandedId === id) setExpandedId(null);
  }, [hosts, expandedId, updateHosts, t]);

  const toggleEnabled = useCallback((id: string) => {
    updateHosts(hosts.map(h => h.id === id ? { ...h, enabled: !h.enabled } : h));
  }, [hosts, updateHosts]);

  const testAndFetchSkills = useCallback(async (host: AgentHost) => {
    setTestingId(host.id);
    setTestResult(null);
    try {
      const skills = await fetchHostSkills(host);
      // Update cached skills in settings
      updateHosts(hosts.map(h => h.id === host.id ? { ...h, skills, skillsFetchedAt: Date.now() } : h));
      setTestResult({ id: host.id, ok: true, msg: t('agents.connected', { count: skills.length, plural: skills.length === 1 ? '' : 's' }) });
    } catch (err) {
      setTestResult({ id: host.id, ok: false, msg: (err as Error).message });
    } finally {
      setTestingId(null);
    }
  }, [hosts, updateHosts]);

  const refreshAll = useCallback(async () => {
    for (const host of hosts.filter(h => h.enabled)) {
      await testAndFetchSkills(host).catch(() => {});
    }
  }, [hosts, testAndFetchSkills]);

  const inputClass = 'w-full bg-surface-raised border border-border-default rounded px-2.5 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-blue';

  return (
    <div className="border-t border-border-default pt-6 mt-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-text-secondary flex items-center gap-2">
          <Server size={16} />
          {t('agents.hosts')}
        </h3>
        <div className="flex gap-1.5">
          {hosts.length > 0 && (
            <button
              onClick={refreshAll}
              className="text-[10px] px-2 py-0.5 rounded bg-surface-raised text-text-muted hover:text-text-primary transition-colors"
            >
              <RefreshCw size={10} className="inline mr-1" />
              {t('agents.refreshAll')}
            </button>
          )}
          <button
            onClick={() => setAdding(!adding)}
            className="text-[10px] px-2 py-0.5 rounded bg-accent-blue/20 text-accent-blue hover:bg-accent-blue/30 transition-colors"
          >
            <Plus size={10} className="inline mr-1" />
            {t('agents.addHost')}
          </button>
        </div>
      </div>

      <p className="text-xs text-text-muted mb-3">
        {t('agents.hostsDesc')}
      </p>

      {/* Add Host Form */}
      {adding && (
        <div className="border border-border-default rounded-lg p-3 mb-3 space-y-2 bg-surface-raised">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-text-muted block mb-0.5">{t('agents.nameSlug')}</label>
              <input
                className={inputClass}
                placeholder="soc1"
                value={formName}
                onChange={e => setFormName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').substring(0, 20))}
                maxLength={20}
              />
            </div>
            <div>
              <label className="text-[10px] text-text-muted block mb-0.5">{t('agents.displayName')}</label>
              <input
                className={inputClass}
                placeholder="SOC Workstation"
                value={formDisplayName}
                onChange={e => setFormDisplayName(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-text-muted block mb-0.5">{t('agents.url')}</label>
            <input
              className={inputClass}
              placeholder="http://192.168.1.50:8080"
              value={formUrl}
              onChange={e => setFormUrl(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[10px] text-text-muted block mb-0.5">{t('agents.apiKeyOptional')}</label>
            <input
              className={inputClass}
              type="password"
              placeholder={t('agents.bearerTokenPlaceholder')}
              value={formApiKey}
              onChange={e => setFormApiKey(e.target.value)}
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={addHost}
              disabled={!formName || !formUrl}
              className="text-xs px-3 py-1 rounded bg-accent-blue text-white hover:bg-accent-blue/80 disabled:opacity-40 transition-colors"
            >
              {t('agents.addHost')}
            </button>
            <button
              onClick={() => setAdding(false)}
              className="text-xs px-3 py-1 rounded bg-surface-raised text-text-muted hover:text-text-primary transition-colors"
            >
              {tc('cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Host List */}
      {hosts.length === 0 && !adding && (
        <div className="text-xs text-text-muted text-center py-4 border border-dashed border-border-default rounded-lg">
          {t('agents.hostsEmpty')}
        </div>
      )}

      <div className="space-y-2">
        {hosts.map(host => (
          <div key={host.id} className="border border-border-default rounded-lg overflow-hidden">
            {/* Host Header */}
            <div className="flex items-center gap-2 px-3 py-2">
              <button
                onClick={() => setExpandedId(expandedId === host.id ? null : host.id)}
                className="text-text-muted hover:text-text-primary"
              >
                {expandedId === host.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary truncate">{host.displayName}</span>
                  <span className="text-[10px] text-text-muted font-mono">{host.name}</span>
                  {host.skills.length > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-blue/20 text-accent-blue">
                      {t('agents.skillsCount', { count: host.skills.length })}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-text-muted truncate">{host.url}</div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => testAndFetchSkills(host)}
                  disabled={testingId === host.id}
                  className="text-[10px] px-2 py-0.5 rounded bg-surface-raised text-text-muted hover:text-text-primary disabled:opacity-40 transition-colors"
                >
                  {testingId === host.id ? <Loader2 size={10} className="inline mr-1 animate-spin" /> : <RefreshCw size={10} className="inline mr-1" />}
                  {t('agents.fetchSkills')}
                </button>
                <button
                  onClick={() => toggleEnabled(host.id)}
                  className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${host.enabled ? 'bg-accent-blue' : 'bg-gray-600'}`}
                  role="switch"
                  aria-checked={host.enabled}
                  aria-label={t(host.enabled ? 'agents.disableHost' : 'agents.enableHost', { name: host.displayName })}
                >
                  <span className={`inline-block h-2.5 w-2.5 rounded-full bg-white transition-transform ${host.enabled ? 'translate-x-[14px]' : 'translate-x-[3px]'}`} />
                </button>
                <button
                  onClick={() => removeHost(host.id)}
                  className="text-text-muted hover:text-red-400 transition-colors"
                  aria-label={t('agents.deleteHost', { name: host.displayName })}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>

            {/* Test Result */}
            {testResult?.id === host.id && (
              <div className={`px-3 py-1.5 text-[10px] flex items-center gap-1.5 ${testResult.ok ? 'bg-green-900/20 text-green-400' : 'bg-red-900/20 text-red-400'}`}>
                {testResult.ok ? <CheckCircle2 size={10} /> : <AlertTriangle size={10} />}
                {testResult.msg}
              </div>
            )}

            {/* Expanded Skills */}
            {expandedId === host.id && (
              <div className="border-t border-border-default px-3 py-2 bg-surface-base">
                {host.skills.length === 0 ? (
                  <p className="text-[10px] text-text-muted">{t('agents.noSkillsCached')}</p>
                ) : (
                  <div className="space-y-1.5">
                    <div className="text-[10px] text-text-muted mb-1">
                      {t('agents.skillsLastFetched', { count: host.skills.length, plural: host.skills.length === 1 ? '' : 's', date: host.skillsFetchedAt ? new Date(host.skillsFetchedAt).toLocaleString() : tc('unknown') })}
                    </div>
                    {host.skills.map(skill => (
                      <SkillRow key={skill.name} skill={skill} hostName={host.name} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SkillRow({ skill, hostName }: { skill: AgentHostSkill; hostName: string }) {
  const toolName = `host:${hostName}:${skill.name}`;
  const paramNames = Object.keys(skill.parameters?.properties || {});
  const actionClass = skill.actionClass || 'fetch';
  const classColor = actionClass === 'read' ? 'text-green-400' : actionClass === 'modify' ? 'text-amber-400' : 'text-blue-400';

  return (
    <div className="flex items-start gap-2 py-1 border-b border-border-default last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-mono text-text-primary">{skill.name}</span>
          <span className={`text-[9px] px-1 py-0.5 rounded ${classColor} bg-surface-raised`}>{actionClass}</span>
        </div>
        <p className="text-[10px] text-text-muted mt-0.5">{skill.description}</p>
        {paramNames.length > 0 && (
          <p className="text-[9px] text-text-muted mt-0.5 font-mono">
            params: {paramNames.join(', ')}
          </p>
        )}
      </div>
      <div className="text-[9px] text-text-muted font-mono shrink-0 mt-0.5">{toolName}</div>
    </div>
  );
}
