import type { Folder, Note, Task, TimelineEvent, StandaloneIOC } from '../types';
import { currentLocale } from './utils';

export interface ReportData {
  folder: Folder;
  notes: Note[];
  tasks: Task[];
  events: TimelineEvent[];
  standaloneIOCs: StandaloneIOC[];
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(currentLocale(), {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatDateShort(ts: number): string {
  return new Date(ts).toLocaleDateString(currentLocale(), {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

interface DeduplicatedIOC {
  type: string;
  value: string;
  confidence?: string;
  attribution?: string;
  analystNotes?: string;
}

function collectIOCs(data: ReportData): DeduplicatedIOC[] {
  const seen = new Map<string, DeduplicatedIOC>();

  // From standalone IOCs
  for (const ioc of data.standaloneIOCs) {
    const key = `${ioc.type}:${ioc.value.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.set(key, {
        type: ioc.type,
        value: ioc.value,
        confidence: ioc.confidence,
        attribution: ioc.attribution,
        analystNotes: ioc.analystNotes,
      });
    }
  }

  // From entity IOC analyses
  const entities = [...data.notes, ...data.tasks, ...data.events];
  for (const entity of entities) {
    if (!entity.iocAnalysis?.iocs) continue;
    for (const ioc of entity.iocAnalysis.iocs) {
      if (ioc.dismissed) continue;
      const key = `${ioc.type}:${ioc.value.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.set(key, {
          type: ioc.type,
          value: ioc.value,
        });
      }
    }
  }

  return Array.from(seen.values());
}

/**
 * Opens the browser print dialog with the given HTML content.
 * The user can then choose "Save as PDF" from the print dialog.
 */
export function printReport(html: string): void {
  const printWindow = window.open('', '_blank', 'noopener,noreferrer');
  if (!printWindow) return;
  printWindow.document.write(html);
  printWindow.document.close();
  // Wait for content to render before triggering print
  printWindow.addEventListener('load', () => {
    printWindow.print();
  });
  // Fallback in case load already fired
  setTimeout(() => {
    printWindow.print();
  }, 500);
}

export function generateInvestigationReport(data: ReportData): string {
  const { folder, notes, tasks, events, standaloneIOCs } = data;
  const iocs = collectIOCs(data);
  const now = new Date().toISOString();

  const statusLabel = folder.status || 'active';
  const clsLabel = folder.clsLevel || 'None';
  const papLabel = folder.papLevel || 'None';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(folder.name)} — Investigation Report</title>
<style>
  :root { --bg: #0a0a0f; --fg: #e5e7eb; --muted: #6b7280; --border: #1f2937; --accent: #6366f1; --surface: #111827; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--fg); line-height: 1.6; padding: 2rem; max-width: 1000px; margin: 0 auto; }
  h1 { font-size: 1.75rem; margin-bottom: 0.25rem; color: var(--accent); }
  h2 { font-size: 1.25rem; margin: 2rem 0 0.75rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--border); }
  h3 { font-size: 1rem; margin: 1.5rem 0 0.5rem; color: var(--muted); }
  table { width: 100%; border-collapse: collapse; margin-bottom: 1.5rem; font-size: 0.875rem; }
  th, td { text-align: left; padding: 0.5rem 0.75rem; border: 1px solid var(--border); }
  th { background: var(--surface); font-weight: 600; color: var(--muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
  td { vertical-align: top; }
  .meta { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 0.75rem; margin-bottom: 1.5rem; }
  .meta-item { background: var(--surface); padding: 0.75rem; border-radius: 0.5rem; border: 1px solid var(--border); }
  .meta-label { font-size: 0.7rem; text-transform: uppercase; color: var(--muted); letter-spacing: 0.05em; }
  .meta-value { font-size: 0.9rem; margin-top: 0.25rem; }
  .status { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 0.25rem; font-size: 0.75rem; font-weight: 600; }
  .status-active { background: #065f4620; color: #34d399; }
  .status-closed { background: #37415120; color: #9ca3af; }
  .status-archived { background: #92400e20; color: #fbbf24; }
  .priority-high, .priority-urgent { color: #ef4444; }
  .priority-medium { color: #f59e0b; }
  .priority-low { color: #6b7280; }
  .priority-none { color: #4b5563; }
  .description { background: var(--surface); padding: 1rem; border-radius: 0.5rem; border: 1px solid var(--border); margin-bottom: 1.5rem; white-space: pre-wrap; }
  .note-item { background: var(--surface); padding: 0.75rem; border-radius: 0.5rem; border: 1px solid var(--border); margin-bottom: 0.5rem; }
  .note-title { font-weight: 600; font-size: 0.9rem; }
  .note-snippet { font-size: 0.8rem; color: var(--muted); margin-top: 0.25rem; }
  .footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--border); text-align: center; font-size: 0.75rem; color: var(--muted); }
  .empty { color: var(--muted); font-style: italic; font-size: 0.875rem; }

  @media print {
    body { background: white; color: #111; padding: 1rem; }
    :root { --bg: white; --fg: #111; --muted: #666; --border: #ddd; --surface: #f9fafb; --accent: #4f46e5; }
    h1 { color: #111; }
    table { page-break-inside: auto; }
    tr { page-break-inside: avoid; }
    .no-print { display: none; }
  }
</style>
</head>
<body>

<h1>${escapeHtml(folder.name)}</h1>
<p style="color: var(--muted); margin-bottom: 1.5rem;">Investigation Report — Generated ${escapeHtml(now)}</p>

<div class="meta">
  <div class="meta-item">
    <div class="meta-label">Status</div>
    <div class="meta-value"><span class="status status-${escapeHtml(statusLabel)}">${escapeHtml(statusLabel.charAt(0).toUpperCase() + statusLabel.slice(1))}</span></div>
  </div>
  <div class="meta-item">
    <div class="meta-label">Classification</div>
    <div class="meta-value">${escapeHtml(clsLabel)}</div>
  </div>
  <div class="meta-item">
    <div class="meta-label">PAP Level</div>
    <div class="meta-value">${escapeHtml(papLabel)}</div>
  </div>
  <div class="meta-item">
    <div class="meta-label">Created</div>
    <div class="meta-value">${escapeHtml(formatDateShort(folder.createdAt))}</div>
  </div>
</div>

${folder.description ? `<div class="description">${escapeHtml(folder.description)}</div>` : ''}

<h2>Summary</h2>
<table>
  <tr><th>Entity</th><th>Count</th></tr>
  <tr><td>Notes</td><td>${notes.length}</td></tr>
  <tr><td>Tasks</td><td>${tasks.length}</td></tr>
  <tr><td>Timeline Events</td><td>${events.length}</td></tr>
  <tr><td>Standalone IOCs</td><td>${standaloneIOCs.length}</td></tr>
  <tr><td>Total IOCs (deduplicated)</td><td>${iocs.length}</td></tr>
</table>

${events.length > 0 ? `
<h2>Timeline Events</h2>
<table>
  <tr><th>Timestamp</th><th>Title</th><th>Type</th><th>Source</th><th>Confidence</th><th>MITRE ATT&amp;CK</th></tr>
  ${events
    .sort((a, b) => a.timestamp - b.timestamp)
    .map(ev => `<tr>
      <td>${escapeHtml(formatDate(ev.timestamp))}</td>
      <td>${escapeHtml(ev.title)}</td>
      <td>${escapeHtml(ev.eventType)}</td>
      <td>${escapeHtml(ev.source || '')}</td>
      <td>${escapeHtml(ev.confidence || '')}</td>
      <td>${escapeHtml(ev.mitreAttackIds?.join(', ') || '')}</td>
    </tr>`).join('\n  ')}
</table>
` : ''}

${iocs.length > 0 ? `
<h2>IOC Summary</h2>
<table>
  <tr><th>Type</th><th>Value</th><th>Confidence</th><th>Attribution</th><th>Notes</th></tr>
  ${iocs
    .sort((a, b) => a.type.localeCompare(b.type) || a.value.localeCompare(b.value))
    .map(ioc => `<tr>
      <td>${escapeHtml(ioc.type)}</td>
      <td style="font-family: monospace; font-size: 0.8rem;">${escapeHtml(ioc.value)}</td>
      <td>${escapeHtml(ioc.confidence || '')}</td>
      <td>${escapeHtml(ioc.attribution || '')}</td>
      <td>${escapeHtml(ioc.analystNotes || '')}</td>
    </tr>`).join('\n  ')}
</table>
` : ''}

${tasks.length > 0 ? `
<h2>Tasks</h2>
<table>
  <tr><th>Title</th><th>Status</th><th>Priority</th><th>Due Date</th></tr>
  ${tasks.map(task => `<tr>
      <td>${escapeHtml(task.title)}</td>
      <td>${escapeHtml(task.status)}</td>
      <td class="priority-${escapeHtml(task.priority)}">${escapeHtml(task.priority)}</td>
      <td>${task.dueDate ? escapeHtml(task.dueDate) : ''}</td>
    </tr>`).join('\n  ')}
</table>
` : ''}

${notes.length > 0 ? `
<h2>Notes</h2>
${notes.map(note => {
  const snippet = note.content.split('\n').filter(l => l.trim()).slice(0, 1).join('').slice(0, 200);
  return `<div class="note-item">
  <div class="note-title">${escapeHtml(note.title)}</div>
  ${snippet ? `<div class="note-snippet">${escapeHtml(snippet)}</div>` : ''}
</div>`;
}).join('\n')}
` : ''}

<div class="footer">
  Generated by ThreatCaddy on ${escapeHtml(now)}<br>
  ${escapeHtml(folder.name)} — ${notes.length} notes, ${tasks.length} tasks, ${events.length} events, ${iocs.length} IOCs
</div>

</body>
</html>`;
}
