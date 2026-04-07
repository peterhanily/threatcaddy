import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { User, Bot } from 'lucide-react';
import type { ChatThread } from '../../types';
import { renderMarkdown } from '../../lib/markdown';
import { formatFullDate } from '../../lib/utils';
import { ExecDetailNav } from './ExecDetailNav';

interface ExecChatViewProps {
  chat: ChatThread;
  onBack: () => void;
  currentIndex?: number;
  totalCount?: number;
  onNavigate?: (direction: 'prev' | 'next') => void;
}

export function ExecChatView({ chat, currentIndex, totalCount, onNavigate }: ExecChatViewProps) {
  const { t } = useTranslation('exec');
  const messages = chat.messages ?? [];

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-bold text-text-primary">{chat.title || t('chat.untitledChat')}</h2>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-text-muted">
        <span>{chat.provider} / {chat.model}</span>
        <span>{t('chat.messagesCount', { count: messages.length })}</span>
        <span>{t('chat.created', { date: formatFullDate(chat.createdAt) })}</span>
        {chat.clsLevel && <span className="font-semibold text-accent-amber">{chat.clsLevel}</span>}
      </div>

      {chat.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chat.tags.map((tag) => (
            <span key={tag} className="text-[10px] bg-accent/10 text-accent px-2 py-0.5 rounded-full">#{tag}</span>
          ))}
        </div>
      )}

      {/* Messages */}
      <div className="flex flex-col gap-2">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} role={msg.role} content={msg.content} createdAt={msg.createdAt} />
        ))}
        {messages.length === 0 && (
          <p className="text-sm text-text-muted text-center py-8">{t('chat.noMessages')}</p>
        )}
      </div>

      {onNavigate && totalCount != null && currentIndex != null && (
        <ExecDetailNav currentIndex={currentIndex} totalCount={totalCount} onPrev={() => onNavigate('prev')} onNext={() => onNavigate('next')} />
      )}
    </div>
  );
}

function MessageBubble({ role, content, createdAt }: { role: 'user' | 'assistant'; content: string; createdAt: number }) {
  const html = useMemo(() => renderMarkdown(content), [content]);
  const isUser = role === 'user';

  return (
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${isUser ? 'bg-accent/20' : 'bg-purple-500/20'}`}>
        {isUser ? <User size={14} className="text-accent" /> : <Bot size={14} className="text-purple-400" />}
      </div>
      <div className={`flex-1 min-w-0 ${isUser ? 'text-right' : ''}`}>
        <div
          className={`inline-block text-left rounded-xl px-3 py-2 text-sm max-w-full ${isUser ? 'bg-accent/10 text-text-primary' : 'bg-bg-raised text-text-primary'} markdown-preview`}
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <p className="text-[9px] text-text-muted mt-0.5">{formatFullDate(createdAt)}</p>
      </div>
    </div>
  );
}
