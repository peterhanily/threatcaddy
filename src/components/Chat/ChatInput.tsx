import { useState, useRef, useEffect, useMemo } from 'react';
import { Send, Square, Wifi, WifiOff, Globe, Search, FileText, CheckSquare, Shield, BarChart3, Clock, Network, ClipboardList, Zap, Link2 } from 'lucide-react';
import type { LLMProvider } from '../../types';
import { cn } from '../../lib/utils';

const SLASH_COMMANDS = [
  { command: '/fetch', description: 'Fetch URL into a note', placeholder: '<url>', icon: Globe },
  { command: '/search', description: 'Search your notes', placeholder: '<query>', icon: Search },
  { command: '/note', description: 'Create a new note', placeholder: '<title>', icon: FileText },
  { command: '/task', description: 'Create a task', placeholder: '<title>', icon: CheckSquare },
  { command: '/iocs', description: 'Extract IOCs from text', placeholder: '<text>', icon: Shield },
  { command: '/summary', description: 'Summarize this investigation', placeholder: '', icon: BarChart3 },
  { command: '/timeline', description: 'List timeline events', placeholder: '', icon: Clock },
  { command: '/report', description: 'Generate investigation report', placeholder: '', icon: ClipboardList },
  { command: '/triage', description: 'Auto-triage an alert or email', placeholder: '<paste alert>', icon: Zap },
  { command: '/graph', description: 'Analyze entity relationships', placeholder: '', icon: Network },
  { command: '/link', description: 'Find and link related entities', placeholder: '<description>', icon: Link2 },
];

interface ModelEntry { label: string; value: string; provider: LLMProvider; group: string }

const STATIC_MODELS: ModelEntry[] = [
  { label: 'Claude Opus 4', value: 'claude-opus-4-6', provider: 'anthropic', group: 'Anthropic' },
  { label: 'Claude Sonnet 4', value: 'claude-sonnet-4-6', provider: 'anthropic', group: 'Anthropic' },
  { label: 'Claude Haiku 3.5', value: 'claude-3-5-haiku-latest', provider: 'anthropic', group: 'Anthropic' },
  { label: 'GPT-5.2', value: 'gpt-5.2', provider: 'openai', group: 'OpenAI' },
  { label: 'GPT-5 Mini', value: 'gpt-5-mini', provider: 'openai', group: 'OpenAI' },
  { label: 'o3', value: 'o3', provider: 'openai', group: 'OpenAI' },
  { label: 'o4-mini', value: 'o4-mini', provider: 'openai', group: 'OpenAI' },
  { label: 'GPT-4.1', value: 'gpt-4.1', provider: 'openai', group: 'OpenAI' },
  { label: 'GPT-4.1 Mini', value: 'gpt-4.1-mini', provider: 'openai', group: 'OpenAI' },
  { label: 'GPT-4o', value: 'gpt-4o', provider: 'openai', group: 'OpenAI' },
  { label: 'Gemini 2.5 Pro', value: 'gemini-2.5-pro-preview-06-05', provider: 'gemini', group: 'Google' },
  { label: 'Gemini 2.5 Flash', value: 'gemini-2.5-flash-preview-05-20', provider: 'gemini', group: 'Google' },
  { label: 'Mistral Large', value: 'mistral-large-latest', provider: 'mistral', group: 'Mistral' },
  { label: 'Mistral Small', value: 'mistral-small-latest', provider: 'mistral', group: 'Mistral' },
  { label: 'Codestral', value: 'codestral-latest', provider: 'mistral', group: 'Mistral' },
];

interface ChatInputProps {
  onSend: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  extensionAvailable: boolean;
  model: string;
  onModelChange: (model: string, provider: LLMProvider) => void;
  disabled?: boolean;
  localModelName?: string;
  /** Set of providers that have an API key configured */
  configuredProviders?: Set<string>;
}

export function ChatInput({ onSend, onStop, isStreaming, extensionAvailable, model, onModelChange, disabled, localModelName, configuredProviders }: ChatInputProps) {
  const MODELS = useMemo(() => {
    let models = [...STATIC_MODELS];
    if (localModelName) {
      models.push({ label: `Local: ${localModelName}`, value: localModelName, provider: 'local' as LLMProvider, group: 'Local' });
    }
    // Only show models for providers that have an API key configured
    if (configuredProviders) {
      models = models.filter(m => configuredProviders.has(m.provider));
    }
    return models;
  }, [localModelName, configuredProviders]);

  // Auto-switch to a valid model when the current one isn't in the filtered list
  useEffect(() => {
    if (MODELS.length > 0 && !MODELS.some(m => m.value === model)) {
      onModelChange(MODELS[0].value, MODELS[0].provider);
    }
  }, [MODELS, model, onModelChange]);

  const [text, setText] = useState('');
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [text]);

  // Show/hide slash menu based on text content
  const filteredCommands = useMemo(() => {
    if (!text.startsWith('/') || text.includes(' ')) return [];
    const filter = text.toLowerCase();
    return SLASH_COMMANDS.filter((c) => c.command.startsWith(filter));
  }, [text]);

  useEffect(() => {
    const shouldOpen = filteredCommands.length > 0;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- derived from filteredCommands memo
    setSlashOpen(shouldOpen);
    if (shouldOpen) setSlashIndex(0);
  }, [filteredCommands]);

  // Close on click outside
  useEffect(() => {
    if (!slashOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) &&
          textareaRef.current && !textareaRef.current.contains(e.target as Node)) {
        setSlashOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [slashOpen]);

  const selectSlashCommand = (command: string) => {
    setText(command + ' ');
    setSlashOpen(false);
    textareaRef.current?.focus();
  };

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming || disabled) return;
    onSend(trimmed);
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (slashOpen && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIndex((i) => (i + 1) % filteredCommands.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIndex((i) => (i - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectSlashCommand(filteredCommands[slashIndex].command);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashOpen(false);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-border-subtle p-3 space-y-2">
      {/* Model selector + extension status */}
      <div className="flex items-center gap-2 text-xs">
        {MODELS.length === 0 ? (
          <span className="text-text-muted text-[10px] italic">No API keys configured — add one in Settings → AI/LLM</span>
        ) : (
          <select
            value={model}
            onChange={(e) => {
              const m = MODELS.find((m) => m.value === e.target.value);
              if (m) onModelChange(m.value, m.provider);
            }}
            className="bg-bg-deep border border-border-medium rounded px-2 py-1 text-text-secondary focus:outline-none focus:border-purple text-xs"
          >
            {Array.from(new Set(MODELS.map(m => m.group))).map(group => (
              <optgroup key={group} label={group}>
                {MODELS.filter(m => m.group === group).map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        )}
        <div className="flex-1" />
        <div className={cn(
          'flex items-center gap-1 text-[10px]',
          extensionAvailable ? 'text-accent-green' : 'text-text-muted'
        )}>
          {extensionAvailable ? <Wifi size={10} /> : <WifiOff size={10} />}
          {extensionAvailable ? 'Extension' : 'No extension'}
        </div>
      </div>

      {/* Input area */}
      <div className="relative flex items-end gap-2">
        {/* Slash command menu */}
        {slashOpen && filteredCommands.length > 0 && (
          <div
            ref={menuRef}
            className="absolute bottom-full left-0 right-0 mb-1 bg-bg-raised border border-border-medium rounded-lg shadow-lg z-20 overflow-hidden"
          >
            {filteredCommands.map((cmd, i) => {
              const Icon = cmd.icon;
              return (
                <button
                  key={cmd.command}
                  onMouseDown={(e) => { e.preventDefault(); selectSlashCommand(cmd.command); }}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors',
                    i === slashIndex ? 'bg-purple/20' : 'hover:bg-bg-hover'
                  )}
                >
                  <Icon size={14} className="shrink-0 text-text-muted" />
                  <span className="text-xs font-mono text-text-primary">{cmd.command}</span>
                  <span className="text-xs text-text-secondary">{cmd.description}</span>
                  {cmd.placeholder && (
                    <span className="text-xs text-text-muted ml-auto">{cmd.placeholder}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={extensionAvailable ? 'Send a message...' : 'Extension required for AI chat'}
          disabled={!extensionAvailable || disabled}
          rows={1}
          className="flex-1 bg-bg-deep border border-border-medium rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-muted resize-none focus:outline-none focus:border-purple disabled:opacity-50"
        />
        {isStreaming ? (
          <button
            onClick={onStop}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
            title="Stop generating"
          >
            <Square size={14} />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!text.trim() || !extensionAvailable || disabled}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-purple/20 text-purple hover:bg-purple/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Send message"
          >
            <Send size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
