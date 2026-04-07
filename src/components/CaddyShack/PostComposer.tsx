import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, Paperclip, AtSign, X, FileText, Film, Music } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { createPost, uploadFile, searchUsers } from '../../lib/server-api';
import type { TeamUser, PostAttachment, Settings } from '../../types';
import { ClsSelect } from '../Common/ClsSelect';
import { SLASH_COMMANDS, getCaretCoordinates } from '../Notes/slashCommands';
import type { SlashCommand } from '../Notes/slashCommands';
import { SlashCommandMenu } from '../Notes/SlashCommandMenu';

const ACCEPTED_FILE_TYPES = 'image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.json,.xml,.yaml,.yml,.log';

function getAttachmentType(mimeType: string): PostAttachment['type'] {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'document';
}

interface PostComposerProps {
  folderId?: string | null;
  parentId?: string | null;
  replyToId?: string | null;
  placeholder?: string;
  initialContent?: string;
  onPostCreated?: () => void;
  settings?: Settings;
}

export function PostComposer({ folderId, parentId, replyToId, placeholder, initialContent, onPostCreated, settings }: PostComposerProps) {
  const { t } = useTranslation('caddyshack');
  const { user, serverUrl } = useAuth();
  const { addToast } = useToast();
  const [content, setContent] = useState(initialContent || '');
  const [attachments, setAttachments] = useState<PostAttachment[]>([]);
  const [mentions, setMentions] = useState<string[]>([]);
  const [clsLevel, setClsLevel] = useState<string | undefined>(undefined);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const [mentionResults, setMentionResults] = useState<TeamUser[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Slash command state
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashTriggerPos, setSlashTriggerPos] = useState(-1);
  const [slashFilter, setSlashFilter] = useState('');
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [slashMenuPosition, setSlashMenuPosition] = useState({ top: 0, left: 0 });
  const slashMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialContent !== undefined) {
      setContent(initialContent);
    }
  }, [initialContent]);

  if (!user || !serverUrl) return null;

  // Filtered slash commands
  const filteredCommands = slashFilter
    ? SLASH_COMMANDS.filter(c =>
        c.label.toLowerCase().includes(slashFilter.toLowerCase()) ||
        c.keywords.some(k => k.toLowerCase().includes(slashFilter.toLowerCase()))
      )
    : SLASH_COMMANDS;

  // Detect slash trigger in text
  const detectSlash = (text: string, cursorPos: number) => {
    let i = cursorPos - 1;
    while (i >= 0 && text[i] !== '/' && text[i] !== '\n' && text[i] !== ' ') {
      i--;
    }

    if (i >= 0 && text[i] === '/' && (i === 0 || text[i - 1] === ' ' || text[i - 1] === '\n')) {
      const filter = text.substring(i + 1, cursorPos);
      setSlashFilter(filter);
      setSlashTriggerPos(i);
      setSlashActiveIndex(0);

      if (textareaRef.current) {
        const coords = getCaretCoordinates(textareaRef.current, i);
        setSlashMenuPosition(coords);
      }
      setSlashMenuOpen(true);
      return;
    }
    setSlashMenuOpen(false);
  };

  // Select a slash command
  const selectSlashCommand = (cmd: SlashCommand) => {
    if (!textareaRef.current) return;
    const textarea = textareaRef.current;
    const cursorPos = textarea.selectionStart;
    const before = content.substring(0, slashTriggerPos);
    const after = content.substring(cursorPos);

    let insertText = cmd.insert;
    if (insertText === '__DATE__') {
      insertText = new Date().toISOString().split('T')[0];
    } else if (insertText === '__DATETIME__') {
      insertText = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
    }

    const newContent = before + insertText + after;
    setContent(newContent);
    setSlashMenuOpen(false);

    requestAnimationFrame(() => {
      const newPos = slashTriggerPos + insertText.length + (cmd.cursorOffset || 0);
      textarea.setSelectionRange(newPos, newPos);
      textarea.focus();
    });
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setContent(val);
    detectSlash(val, e.target.selectionStart);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Slash command navigation
    if (slashMenuOpen && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashActiveIndex(i => (i + 1) % filteredCommands.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashActiveIndex(i => (i - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (filteredCommands[slashActiveIndex]) {
          selectSlashCommand(filteredCommands[slashActiveIndex]);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashMenuOpen(false);
        return;
      }
    }

    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = async () => {
    if (!content.trim() || submitting) return;
    setSubmitting(true);
    try {
      await createPost({
        content,
        attachments: attachments.length > 0 ? attachments : undefined,
        mentions: mentions.length > 0 ? mentions : undefined,
        folderId: folderId || null,
        parentId: parentId || null,
        replyToId: replyToId || null,
        clsLevel: clsLevel || null,
      });
      setContent('');
      setAttachments([]);
      setMentions([]);
      setClsLevel(undefined);
      addToast('success', parentId ? 'Reply posted' : 'Post created');
      onPostCreated?.();
    } catch (err) {
      console.error('Failed to create post:', err);
      addToast('error', 'Failed to create post');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    for (const file of Array.from(files)) {
      try {
        const result = await uploadFile(file, folderId || undefined);
        const att: PostAttachment = {
          id: result.id,
          url: result.url,
          type: getAttachmentType(result.mimeType),
          mimeType: result.mimeType,
          filename: result.filename,
          size: result.size,
          thumbnailUrl: result.thumbnailUrl || undefined,
        };
        setAttachments((prev) => [...prev, att]);
      } catch (err) {
        console.error('Failed to upload file:', err);
        addToast('error', `Failed to upload file: ${file.name}`);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleMentionSearch = async (query: string) => {
    setMentionSearch(query);
    if (query.length < 2) {
      setMentionResults([]);
      return;
    }
    try {
      const users = await searchUsers(query);
      setMentionResults(users);
    } catch (e) { console.warn('Mention search failed:', e); }
  };

  const insertMention = (mentionUser: TeamUser) => {
    setContent((prev) => prev + `@${mentionUser.displayName} `);
    setMentions((prev) => [...prev, mentionUser.id]);
    setShowMentions(false);
    setMentionSearch('');
    textareaRef.current?.focus();
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const AttachmentIcon = ({ type }: { type: PostAttachment['type'] }) => {
    switch (type) {
      case 'video': return <Film size={14} className="text-purple-400" />;
      case 'audio': return <Music size={14} className="text-green-400" />;
      case 'document': return <FileText size={14} className="text-blue-400" />;
      default: return null;
    }
  };

  return (
    <div className="border border-[var(--border)] rounded-xl bg-[var(--bg-secondary)] focus-within:border-blue-500/40 transition-colors">
      <div className="flex gap-3 p-3 pb-2">
        <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-medium shrink-0">
          {user.displayName[0]?.toUpperCase() || '?'}
        </div>
        <div className="flex-1 min-w-0 relative">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleContentChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder || t('composer.placeholder')}
            className="w-full bg-transparent border-0 resize-none text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none min-h-[48px]"
            rows={2}
          />

          {/* Slash command menu */}
          {slashMenuOpen && filteredCommands.length > 0 && (
            <SlashCommandMenu
              commands={filteredCommands}
              activeIndex={slashActiveIndex}
              position={slashMenuPosition}
              onSelect={selectSlashCommand}
              menuRef={slashMenuRef}
            />
          )}

          {/* Attachment previews */}
          {attachments.length > 0 && (
            <div className="flex gap-2 flex-wrap mt-2">
              {attachments.map((att, i) => (
                <div key={i} className="relative group">
                  {att.type === 'image' ? (
                    <img src={att.thumbnailUrl || att.url} alt={att.alt || ''} className="h-16 rounded-lg border border-[var(--border)] object-cover" />
                  ) : (
                    <div className="h-16 w-20 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] flex flex-col items-center justify-center gap-1 px-1">
                      <AttachmentIcon type={att.type} />
                      <span className="text-[9px] text-[var(--text-tertiary)] truncate w-full text-center">{att.filename}</span>
                    </div>
                  )}
                  <button
                    onClick={() => removeAttachment(i)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center opacity-40 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
                  >
                    <X size={10} className="text-white" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Mention dropdown */}
          {showMentions && (
            <div className="mt-2">
              <input
                type="text"
                value={mentionSearch}
                onChange={(e) => handleMentionSearch(e.target.value)}
                placeholder="Search users..."
                className="w-full bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                autoFocus
              />
              {mentionResults.length > 0 && (
                <div className="mt-1 border border-[var(--border)] rounded-lg bg-[var(--bg-primary)] max-h-32 overflow-y-auto">
                  {mentionResults.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => insertMention(u)}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--bg-secondary)] flex items-center gap-2 transition-colors"
                    >
                      <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs">
                        {u.displayName[0]?.toUpperCase()}
                      </div>
                      <span className="text-[var(--text-primary)]">{u.displayName}</span>
                      <span className="text-[var(--text-tertiary)] text-xs ml-auto">{u.email}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Actions bar — no divider line */}
      <div className="flex items-center gap-1 px-3 pb-2.5 ml-12">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="p-1.5 rounded-full hover:bg-blue-500/10 text-blue-400 transition-colors"
          title="Attach file"
        >
          <Paperclip size={18} />
        </button>
        <button
          onClick={() => setShowMentions(!showMentions)}
          className="p-1.5 rounded-full hover:bg-blue-500/10 text-blue-400 transition-colors"
          title="Mention user"
        >
          <AtSign size={18} />
        </button>
        <ClsSelect
          value={clsLevel}
          onChange={setClsLevel}
          clsLevels={settings?.tiClsLevels}
        />
        <div className="flex-1" />
        <span className="text-[11px] text-[var(--text-tertiary)] mr-2 select-none">
          Type <kbd className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)] text-[10px] font-mono">/</kbd> for commands
        </span>
        <button
          onClick={handleSubmit}
          disabled={!content.trim() || submitting}
          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-full text-sm font-semibold disabled:opacity-50 disabled:hover:bg-blue-600 transition-colors flex items-center gap-1.5"
        >
          <Send size={14} /> {t('composer.post')}
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_FILE_TYPES}
        multiple
        className="hidden"
        onChange={handleFileUpload}
      />
    </div>
  );
}
