import { FileText, CheckSquare, Clock, Shield, Database, FolderOpen, MessageSquare, BarChart3, Pencil } from 'lucide-react';

export interface ActivityEntry {
  id: string;
  userId: string;
  category: string;
  action: string;
  detail: string;
  itemId?: string;
  itemTitle?: string;
  folderId?: string;
  timestamp: string;
  userDisplayName: string;
  userAvatarUrl?: string | null;
}

interface ActivityCardProps {
  entry: ActivityEntry;
  onUserClick?: (userId: string) => void;
}

const CATEGORY_CONFIG: Record<string, { icon: typeof FileText; color: string; label: string }> = {
  note:          { icon: FileText,    color: '#3b82f6', label: 'Note' },
  task:          { icon: CheckSquare, color: '#22c55e', label: 'Task' },
  timeline:      { icon: Clock,       color: '#f97316', label: 'Timeline' },
  ioc:           { icon: Shield,      color: '#ef4444', label: 'IOC' },
  investigation: { icon: FolderOpen,  color: '#eab308', label: 'Investigation' },
  data:          { icon: Database,    color: '#6366f1', label: 'Data' },
  chat:          { icon: MessageSquare, color: '#8b5cf6', label: 'Chat' },
  graph:         { icon: BarChart3,   color: '#06b6d4', label: 'Graph' },
  whiteboard:    { icon: Pencil,      color: '#ec4899', label: 'Whiteboard' },
};

function getCategory(category: string) {
  return CATEGORY_CONFIG[category] || { icon: Clock, color: '#6b7280', label: category };
}

export function ActivityCard({ entry, onUserClick }: ActivityCardProps) {
  const cat = getCategory(entry.category);
  const CatIcon = cat.icon;
  const timeAgo = formatTimeAgo(entry.timestamp);

  // Build human-readable action description
  const actionText = buildActionText(entry);

  return (
    <div className="px-4 py-2.5 hover:bg-[var(--bg-tertiary)]/30 transition-colors">
      <div className="flex gap-2.5">
        {/* User avatar */}
        <button
          onClick={() => onUserClick?.(entry.userId)}
          className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-medium shrink-0 hover:ring-2 hover:ring-blue-400/50 transition-all"
          style={{ backgroundColor: stringToColor(entry.userDisplayName) }}
        >
          {entry.userDisplayName?.[0]?.toUpperCase() || '?'}
        </button>

        <div className="flex-1 min-w-0">
          {/* Action line */}
          <div className="text-[13px] text-[var(--text-secondary)] leading-snug">
            <button
              onClick={() => onUserClick?.(entry.userId)}
              className="font-semibold text-[var(--text-primary)] hover:underline"
            >
              {entry.userDisplayName}
            </button>
            {' '}{actionText}
          </div>

          {/* Meta row: category badge + time */}
          <div className="flex items-center gap-2 mt-1">
            <span
              className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: `${cat.color}15`, color: cat.color }}
            >
              <CatIcon size={10} />
              {cat.label}
            </span>
            <span className="text-[11px] text-[var(--text-tertiary)]">{timeAgo}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function buildActionText(entry: ActivityEntry): string {
  const action = entry.action.toLowerCase();
  const title = entry.itemTitle;

  if (title) {
    return `${action} "${title}"`;
  }
  if (entry.detail && entry.detail !== entry.action) {
    return `${action} — ${entry.detail}`;
  }
  return action;
}

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = ['#3b82f6', '#ef4444', '#22c55e', '#f97316', '#8b5cf6', '#ec4899', '#06b6d4', '#eab308'];
  return colors[Math.abs(hash) % colors.length];
}
