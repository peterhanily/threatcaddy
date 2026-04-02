import { useState, useEffect } from 'react';
import { Bot, ChevronRight, AlertTriangle } from 'lucide-react';
import { db } from '../../db';
import type { Note } from '../../types';
import { formatDate } from '../../lib/utils';

const SUPERVISOR_FOLDER_NAME = 'CaddyAgent Supervisor';

/**
 * Compact supervisor summary card for the Investigations Hub.
 * Shows the latest supervisor finding note and shared IOC alerts.
 */
export function SupervisorSummary({ onOpenSupervisor }: { onOpenSupervisor?: (folderId: string) => void }) {
  const [latestNote, setLatestNote] = useState<Note | null>(null);
  const [supervisorFolderId, setSupervisorFolderId] = useState<string | null>(null);
  const [sharedIocCount, setSharedIocCount] = useState(0);

  useEffect(() => {
    (async () => {
      const folder = await db.folders
        .where('name')
        .equals(SUPERVISOR_FOLDER_NAME)
        .first();

      if (!folder) return;
      setSupervisorFolderId(folder.id);

      // Get latest 3 notes (limit at query level)
      const recent = await db.notes
        .where('[folderId+updatedAt]')
        .between([folder.id, -Infinity], [folder.id, Infinity])
        .reverse()
        .limit(3)
        .toArray();

      if (recent.length > 0) {
        setLatestNote(recent[0]);
        // Count mentions of "shared IOC" using indexOf (no regex)
        let count = 0;
        for (const n of recent) {
          const lower = n.content.toLowerCase();
          let idx = 0;
          while ((idx = lower.indexOf('shared ioc', idx)) !== -1) {
            count++;
            idx += 10;
          }
        }
        setSharedIocCount(count);
      }
    })();
  }, []);

  if (!latestNote) return null;

  // Extract a brief summary from the note content (first 150 chars of plain text)
  const plainText = latestNote.content
    .replace(/#{1,6}\s/g, '')
    .replace(/\*\*/g, '')
    .replace(/\n+/g, ' ')
    .trim();
  const summary = plainText.length > 150 ? plainText.substring(0, 150) + '...' : plainText;

  return (
    <div className="mb-6">
      <button
        onClick={() => supervisorFolderId && onOpenSupervisor?.(supervisorFolderId)}
        className="w-full text-left rounded-lg border border-accent-blue/20 bg-accent-blue/5 hover:bg-accent-blue/10 transition-colors p-3 group"
      >
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <Bot size={14} className="text-accent-blue" />
            <span className="text-xs font-semibold text-text-primary">Supervisor Briefing</span>
            {sharedIocCount > 0 && (
              <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-accent-amber/10 text-accent-amber">
                <AlertTriangle size={10} />
                {sharedIocCount} shared IOC pattern{sharedIocCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-text-muted">{formatDate(latestNote.createdAt)}</span>
            <ChevronRight size={12} className="text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>
        <p className="text-xs text-text-secondary line-clamp-2">{summary}</p>
      </button>
    </div>
  );
}
