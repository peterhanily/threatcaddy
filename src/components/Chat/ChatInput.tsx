import { useState, useRef, useEffect, useMemo } from 'react';
import { Send, Square, Wifi, WifiOff, Globe, Search, FileText, CheckSquare, Shield, BarChart3, Clock, Network, ClipboardList, Zap, Link2, AlertTriangle, Terminal, RefreshCw, StopCircle, Wrench, ImagePlus } from 'lucide-react';
import type { LLMProvider } from '../../types';
import { MODELS as STATIC_MODELS } from '../../lib/models';
import { cn } from '../../lib/utils';
import { searchMentions, MENTION_CATEGORIES, type MentionSuggestion } from '../../lib/chat-mentions';

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
  { command: '/loop', description: 'Schedule a recurring prompt', placeholder: '<interval> <prompt>', icon: RefreshCw },
  { command: '/stoploop', description: 'Stop background loops', placeholder: '', icon: StopCircle },
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
  onOpenSettings?: () => void;
  folderId?: string;
  customCommands?: { command: string; description: string }[];
  onImageAttach?: (files: File[]) => void;
  attachedImages?: { name: string }[];
  onClearImages?: () => void;
}

export function ChatInput({ onSend, onStop, isStreaming, extensionAvailable, model, onModelChange, disabled, localModelName, configuredProviders, onOpenSettings, folderId, customCommands, onImageAttach, attachedImages, onClearImages }: ChatInputProps) {
  // Can send if extension is available OR a local LLM is configured (direct fetch, no extension needed)
  const canSend = extensionAvailable || !!localModelName;
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
      textareaRef.current.style.height = Math.max(72, Math.min(textareaRef.current.scrollHeight, 500)) + 'px';
    }
  }, [text]);

  // Merge built-in + custom slash commands
  const allCommands = useMemo(() => {
    const custom = (customCommands || []).map(c => ({
      command: c.command.startsWith('/') ? c.command : `/${c.command}`,
      description: c.description,
      placeholder: '<input>' as string,
      icon: Wrench,
    }));
    return [...SLASH_COMMANDS, ...custom];
  }, [customCommands]);

  // Show/hide slash menu based on text content
  const filteredCommands = useMemo(() => {
    if (!text.startsWith('/') || text.includes(' ')) return [];
    const filter = text.toLowerCase();
    return allCommands.filter((c) => c.command.startsWith(filter));
  }, [text, allCommands]);

  useEffect(() => {
    const shouldOpen = filteredCommands.length > 0;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- derived from filteredCommands memo
    setSlashOpen(shouldOpen);
    if (shouldOpen) setSlashIndex(0);
  }, [filteredCommands]);

  // ── @-mention autocomplete ──────────────────────────────────────────
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionResults, setMentionResults] = useState<MentionSuggestion[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionPhase, setMentionPhase] = useState<'category' | 'search'>('category');
  const mentionMenuRef = useRef<HTMLDivElement>(null);

  // Detect @-mention trigger
  useEffect(() => {
    // Find the last @ in the text
    const lastAt = text.lastIndexOf('@');
    if (lastAt === -1 || slashOpen) {
      if (mentionOpen) setMentionOpen(false);
      return;
    }

    const afterAt = text.slice(lastAt + 1);

    // Check if we're in a typed mention (e.g. @note:query)
    const typedMatch = afterAt.match(/^(note|ioc|investigation):(.*)$/i);
    if (typedMatch) {
      const type = typedMatch[1].toLowerCase() as 'note' | 'ioc' | 'investigation';
      const query = typedMatch[2];
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMentionPhase('search');
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMentionOpen(true);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMentionIndex(0);
      searchMentions(type, query, folderId).then(setMentionResults);
      return;
    }

    // Just '@' or '@<partial category>' — show categories
    if (afterAt === '' || MENTION_CATEGORIES.some(c => c.type.startsWith(afterAt.toLowerCase()))) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMentionPhase('category');
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMentionOpen(true);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMentionIndex(0);
      return;
    }

    if (mentionOpen) setMentionOpen(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, slashOpen, folderId]);

  const selectMentionCategory = (type: 'note' | 'ioc' | 'investigation') => {
    const lastAt = text.lastIndexOf('@');
    const before = text.slice(0, lastAt);
    setText(before + `@${type}:`);
    setMentionPhase('search');
    setMentionIndex(0);
    textareaRef.current?.focus();
  };

  const selectMentionItem = (item: MentionSuggestion) => {
    const lastAt = text.lastIndexOf('@');
    const before = text.slice(0, lastAt);
    setText(before + `@${item.type}:${item.id} `);
    setMentionOpen(false);
    textareaRef.current?.focus();
  };

  // Close on click outside
  useEffect(() => {
    if (!slashOpen && !mentionOpen) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      const isOutside = textareaRef.current && !textareaRef.current.contains(target);
      if (slashOpen && menuRef.current && !menuRef.current.contains(target) && isOutside) {
        setSlashOpen(false);
      }
      if (mentionOpen && mentionMenuRef.current && !mentionMenuRef.current.contains(target) && isOutside) {
        setMentionOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [slashOpen, mentionOpen]);

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

  // ── Image paste/drop handling ─────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePaste = (e: React.ClipboardEvent) => {
    if (!onImageAttach) return;
    const files = Array.from(e.clipboardData.files).filter(f => f.type.startsWith('image/'));
    if (files.length > 0) {
      e.preventDefault();
      onImageAttach(files);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    if (!onImageAttach) return;
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length > 0) onImageAttach(files);
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
    // @-mention keyboard navigation
    if (mentionOpen) {
      const items = mentionPhase === 'category' ? MENTION_CATEGORIES : mentionResults;
      if (items.length > 0) {
        if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(i => (i + 1) % items.length); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(i => (i - 1 + items.length) % items.length); return; }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          if (mentionPhase === 'category') {
            selectMentionCategory(MENTION_CATEGORIES[mentionIndex].type);
          } else {
            selectMentionItem(mentionResults[mentionIndex]);
          }
          return;
        }
      }
      if (e.key === 'Escape') { e.preventDefault(); setMentionOpen(false); return; }
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
          canSend ? 'text-accent-green' : 'text-text-muted'
        )}>
          {canSend ? <Wifi size={10} /> : <WifiOff size={10} />}
          {extensionAvailable ? 'Extension' : localModelName ? 'Local LLM' : 'No connection'}
        </div>
      </div>

      {/* Connection required banner */}
      {!canSend && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <div className="text-xs space-y-1">
            <p className="font-medium">Browser extension required</p>
            <p className="text-amber-400/80">The ThreatCaddy browser extension is required for CaddyAI to make API calls. Install it from the{' '}
              <a href="https://chromewebstore.google.com/detail/threatcaddy-%E2%80%94-quick-captu/lakelgngpkkaeinfdlnmifookbeeffbh" target="_blank" rel="noopener noreferrer" className="underline hover:text-amber-300">Chrome Web Store</a>.
            </p>
            {onOpenSettings && (
              <button onClick={onOpenSettings} className="text-accent hover:text-accent-hover underline">
                Configure API keys in Settings
              </button>
            )}
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="relative flex items-end gap-2">
        {/* Slash command menu */}
        {slashOpen && filteredCommands.length > 0 && (
          <div
            ref={menuRef}
            role="listbox"
            className="absolute bottom-full left-0 right-0 mb-1 bg-bg-raised border border-border-medium rounded-lg shadow-lg z-20 overflow-hidden"
          >
            {filteredCommands.map((cmd, i) => {
              const Icon = cmd.icon;
              return (
                <button
                  key={cmd.command}
                  role="option"
                  aria-selected={i === slashIndex}
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
        {/* @-mention menu */}
        {mentionOpen && (
          <div
            ref={mentionMenuRef}
            role="listbox"
            className="absolute bottom-full left-0 right-0 mb-1 bg-bg-raised border border-border-medium rounded-lg shadow-lg z-20 overflow-hidden max-h-64 overflow-y-auto"
          >
            {mentionPhase === 'category' ? (
              MENTION_CATEGORIES.map((cat, i) => (
                <button
                  key={cat.type}
                  role="option"
                  aria-selected={i === mentionIndex}
                  onMouseDown={(e) => { e.preventDefault(); selectMentionCategory(cat.type); }}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors',
                    i === mentionIndex ? 'bg-purple/20' : 'hover:bg-bg-hover'
                  )}
                >
                  <span className="text-xs font-mono text-purple">{cat.prefix}</span>
                  <span className="text-xs text-text-secondary">{cat.label}</span>
                </button>
              ))
            ) : mentionResults.length > 0 ? (
              mentionResults.map((item, i) => (
                <button
                  key={item.id}
                  role="option"
                  aria-selected={i === mentionIndex}
                  onMouseDown={(e) => { e.preventDefault(); selectMentionItem(item); }}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors',
                    i === mentionIndex ? 'bg-purple/20' : 'hover:bg-bg-hover'
                  )}
                >
                  <span className="text-xs font-medium text-text-primary truncate">{item.label}</span>
                  {item.preview && (
                    <span className="text-[10px] text-text-muted truncate flex-1">{item.preview}</span>
                  )}
                </button>
              ))
            ) : (
              <div className="px-3 py-2 text-xs text-text-muted">No matches found</div>
            )}
          </div>
        )}
        <button
          onClick={() => { setText('/'); textareaRef.current?.focus(); }}
          disabled={!canSend || disabled}
          className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Type / for commands"
          aria-label="Insert slash command"
        >
          <Terminal size={14} />
        </button>
        <div className="flex-1 flex flex-col gap-1">
          {/* Image attachment preview */}
          {attachedImages && attachedImages.length > 0 && (
            <div className="flex items-center gap-1 px-1">
              {attachedImages.map((img, i) => (
                <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple/10 border border-purple/20 text-[10px] text-purple">
                  <ImagePlus size={10} />
                  {img.name || `Image ${i + 1}`}
                </span>
              ))}
              <button onClick={onClearImages} className="text-[10px] text-text-muted hover:text-red-400 ml-1">clear</button>
            </div>
          )}
          {/* Thinking indicator */}
          {isStreaming && (
            <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] text-purple">
              <div className="flex gap-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-purple animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-purple animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-purple animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
              <span>Thinking...</span>
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            placeholder={canSend ? 'Ask CaddyAI anything... (/ for commands, @ to mention, paste images)' : 'Configure a local LLM or install the extension'}
            disabled={!canSend || disabled}
            rows={3}
            className="w-full bg-bg-deep border border-border-medium rounded-xl px-4 py-3 text-sm text-text-primary placeholder-text-muted resize-y focus:outline-none focus:ring-2 focus:ring-purple/30 focus:border-purple disabled:opacity-50 transition-all min-h-[72px] max-h-[50vh]"
          />
        </div>
        {/* Image attach button */}
        {onImageAttach && (
          <>
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { if (e.target.files) onImageAttach(Array.from(e.target.files)); e.target.value = ''; }} />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={!canSend || disabled}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Attach image"
            >
              <ImagePlus size={14} />
            </button>
          </>
        )}
        {isStreaming ? (
          <button
            onClick={onStop}
            className="shrink-0 w-10 h-10 flex items-center justify-center rounded-xl bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-all"
            title="Stop generating"
          >
            <Square size={16} />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!text.trim() || !canSend || disabled}
            className="shrink-0 w-10 h-10 flex items-center justify-center rounded-xl bg-purple text-white hover:bg-purple/90 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            title="Send message (Enter)"
          >
            <Send size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
