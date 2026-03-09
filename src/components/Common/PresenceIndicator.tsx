import { useState } from 'react';
import { Pencil } from 'lucide-react';
import type { PresenceUser } from '../../types';

interface PresenceIndicatorProps {
  users: PresenceUser[];
  maxDisplay?: number;
}

export function PresenceIndicator({ users, maxDisplay = 5 }: PresenceIndicatorProps) {
  const [expanded, setExpanded] = useState(false);

  if (users.length === 0) return null;

  const displayed = users.slice(0, maxDisplay);
  const remaining = users.length - maxDisplay;

  return (
    <div className="relative">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
      >
        {/* Avatar stack */}
        <div className="flex items-center -space-x-2">
          {displayed.map((user) => (
            <div
              key={user.id}
              className="w-6 h-6 rounded-full border-2 border-[var(--bg-primary)] flex items-center justify-center text-white text-[9px] font-medium shrink-0 relative"
              style={{ backgroundColor: stringToColor(user.displayName) }}
              title={`${user.displayName} — ${viewLabel(user.view, user.entityId)}`}
            >
              {user.displayName[0]?.toUpperCase() || '?'}
              <div className="absolute w-1.5 h-1.5 bg-green-500 rounded-full -bottom-0 -right-0 border border-[var(--bg-primary)]" />
            </div>
          ))}
          {remaining > 0 && (
            <div className="w-6 h-6 rounded-full border-2 border-[var(--bg-primary)] bg-[var(--bg-tertiary)] flex items-center justify-center text-[var(--text-tertiary)] text-[9px] font-medium">
              +{remaining}
            </div>
          )}
        </div>

        {/* Activity summary text */}
        <span className="text-xs text-[var(--text-tertiary)] hidden sm:inline">
          {users.length} online
        </span>
      </button>

      {/* Expanded activity panel */}
      {expanded && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setExpanded(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 w-72 bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg shadow-xl overflow-hidden">
            <div className="px-3 py-2 border-b border-[var(--border)]">
              <span className="text-xs font-medium text-[var(--text-primary)]">
                {users.length} team member{users.length !== 1 ? 's' : ''} online
              </span>
            </div>
            <div className="max-h-64 overflow-y-auto divide-y divide-[var(--border)]">
              {users.map((user) => (
                <div key={user.id} className="flex items-center gap-2.5 px-3 py-2">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-medium shrink-0 relative"
                    style={{ backgroundColor: stringToColor(user.displayName) }}
                  >
                    {user.displayName[0]?.toUpperCase() || '?'}
                    <div className="absolute w-2 h-2 bg-green-500 rounded-full -bottom-0.5 -right-0.5 border border-[var(--bg-primary)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                      {user.displayName}
                    </div>
                    <div className="text-[10px] text-[var(--text-tertiary)] truncate flex items-center gap-1">
                      {user.entityId && isEditingView(user.view) && (
                        <Pencil size={9} className="text-yellow-500 shrink-0" />
                      )}
                      {viewLabel(user.view, user.entityId)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Views that imply active editing when an entityId is present */
function isEditingView(view: string): boolean {
  return view === 'editor' || view === 'whiteboard';
}

function viewLabel(view: string, entityId?: string): string {
  const labels: Record<string, string> = {
    notes: 'Viewing notes',
    editor: 'Editing a note',
    tasks: 'Managing tasks',
    timeline: 'On timeline',
    whiteboard: 'On whiteboard',
    chat: 'In AI chat',
    settings: 'In settings',
    graph: 'Viewing graph',
    iocs: 'Analyzing IOCs',
    caddyshack: 'On CaddyShack',
    dashboard: 'On dashboard',
  };
  const base = labels[view] || `Viewing ${view}`;
  if (entityId && isEditingView(view)) {
    return `Currently editing`;
  }
  return base;
}

function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = ['#3b82f6', '#ef4444', '#22c55e', '#f97316', '#8b5cf6', '#ec4899', '#06b6d4', '#eab308'];
  return colors[Math.abs(hash) % colors.length];
}
