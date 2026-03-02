import { describe, it, expect } from 'vitest';
import { generateInvestigationReport } from '../lib/report';
import type { Folder, Note, Task, TimelineEvent, StandaloneIOC } from '../types';
import type { ReportData } from '../lib/report';

// ── Helpers ─────────────────────────────────────────────────────────

function makeFolder(overrides?: Partial<Folder>): Folder {
  return {
    id: 'folder-1',
    name: 'Test Investigation',
    order: 0,
    createdAt: 1709251200000,
    updatedAt: 1709251200000,
    ...overrides,
  };
}

function makeNote(overrides?: Partial<Note>): Note {
  return {
    id: 'note-1',
    title: 'Test Note',
    content: 'Some content here.',
    tags: [],
    pinned: false,
    trashed: false,
    archived: false,
    createdAt: 1709251200000,
    updatedAt: 1709251200000,
    ...overrides,
  };
}

function makeTask(overrides?: Partial<Task>): Task {
  return {
    id: 'task-1',
    title: 'Test Task',
    status: 'todo',
    priority: 'medium',
    completed: false,
    tags: [],
    order: 0,
    trashed: false,
    archived: false,
    createdAt: 1709251200000,
    updatedAt: 1709251200000,
    ...overrides,
  };
}

function makeEvent(overrides?: Partial<TimelineEvent>): TimelineEvent {
  return {
    id: 'event-1',
    timestamp: 1709251200000,
    title: 'Test Event',
    eventType: 'initial-access',
    source: 'SIEM',
    confidence: 'high',
    linkedIOCIds: [],
    linkedNoteIds: [],
    linkedTaskIds: [],
    mitreAttackIds: [],
    assets: [],
    tags: [],
    starred: false,
    timelineId: 'tl-1',
    trashed: false,
    archived: false,
    createdAt: 1709251200000,
    updatedAt: 1709251200000,
    ...overrides,
  };
}

function makeStandaloneIOC(overrides?: Partial<StandaloneIOC>): StandaloneIOC {
  return {
    id: 'ioc-1',
    type: 'ipv4',
    value: '10.0.0.1',
    confidence: 'high',
    tags: [],
    trashed: false,
    archived: false,
    createdAt: 1709251200000,
    updatedAt: 1709251200000,
    ...overrides,
  };
}

function makeReportData(overrides?: Partial<ReportData>): ReportData {
  return {
    folder: makeFolder(),
    notes: [],
    tasks: [],
    events: [],
    standaloneIOCs: [],
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('generateInvestigationReport', () => {
  it('generates valid HTML with DOCTYPE', () => {
    const html = generateInvestigationReport(makeReportData());
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
    expect(html).toContain('<head>');
    expect(html).toContain('<body>');
  });

  it('contains the folder name in the title (escaped)', () => {
    const html = generateInvestigationReport(makeReportData({
      folder: makeFolder({ name: 'APT29 Campaign' }),
    }));
    expect(html).toContain('<title>APT29 Campaign — Investigation Report</title>');
  });

  it('escapes HTML special characters in folder name', () => {
    const html = generateInvestigationReport(makeReportData({
      folder: makeFolder({ name: '<script>alert("xss")</script>' }),
    }));
    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert');
  });

  it('includes summary table with correct entity counts', () => {
    const data = makeReportData({
      notes: [makeNote({ id: 'n1' }), makeNote({ id: 'n2' }), makeNote({ id: 'n3' })],
      tasks: [makeTask({ id: 't1' }), makeTask({ id: 't2' })],
      events: [makeEvent({ id: 'e1' })],
      standaloneIOCs: [makeStandaloneIOC({ id: 'ioc1' }), makeStandaloneIOC({ id: 'ioc2', value: '10.0.0.2' })],
    });
    const html = generateInvestigationReport(data);

    // Check entity counts in the summary table rows
    expect(html).toContain('<td>Notes</td><td>3</td>');
    expect(html).toContain('<td>Tasks</td><td>2</td>');
    expect(html).toContain('<td>Timeline Events</td><td>1</td>');
    expect(html).toContain('<td>Standalone IOCs</td><td>2</td>');
  });

  it('includes timeline events section when events exist', () => {
    const data = makeReportData({
      events: [makeEvent({ title: 'Phishing email received' })],
    });
    const html = generateInvestigationReport(data);
    expect(html).toContain('<h2>Timeline Events</h2>');
    expect(html).toContain('Phishing email received');
  });

  it('excludes timeline events section when no events', () => {
    const data = makeReportData({ events: [] });
    const html = generateInvestigationReport(data);
    expect(html).not.toContain('<h2>Timeline Events</h2>');
  });

  it('includes IOC summary section with standalone IOCs', () => {
    const data = makeReportData({
      standaloneIOCs: [
        makeStandaloneIOC({ type: 'ipv4', value: '192.168.1.1', confidence: 'high', attribution: 'APT29' }),
      ],
    });
    const html = generateInvestigationReport(data);
    expect(html).toContain('<h2>IOC Summary</h2>');
    expect(html).toContain('192.168.1.1');
    expect(html).toContain('ipv4');
  });

  it('deduplicates IOCs (same type+value should appear once)', () => {
    const data = makeReportData({
      standaloneIOCs: [
        makeStandaloneIOC({ id: 'ioc1', type: 'ipv4', value: '10.0.0.1' }),
        makeStandaloneIOC({ id: 'ioc2', type: 'ipv4', value: '10.0.0.1' }),
      ],
      notes: [
        makeNote({
          id: 'n1',
          iocAnalysis: {
            extractedAt: 1709251200000,
            iocs: [{
              id: 'e-ioc1', type: 'ipv4', value: '10.0.0.1',
              confidence: 'medium', firstSeen: 1709251200000, dismissed: false,
            }],
          },
        }),
      ],
    });
    const html = generateInvestigationReport(data);

    // The total deduplicated count should be 1
    expect(html).toContain('<td>Total IOCs (deduplicated)</td><td>1</td>');
  });

  it('excludes dismissed IOCs from entity analyses', () => {
    const data = makeReportData({
      standaloneIOCs: [],
      notes: [
        makeNote({
          id: 'n1',
          iocAnalysis: {
            extractedAt: 1709251200000,
            iocs: [
              {
                id: 'e-ioc1', type: 'ipv4', value: '10.0.0.1',
                confidence: 'high', firstSeen: 1709251200000, dismissed: false,
              },
              {
                id: 'e-ioc2', type: 'domain', value: 'evil.com',
                confidence: 'low', firstSeen: 1709251200000, dismissed: true,
              },
            ],
          },
        }),
      ],
    });
    const html = generateInvestigationReport(data);

    // Only the non-dismissed IOC should be counted
    expect(html).toContain('<td>Total IOCs (deduplicated)</td><td>1</td>');
    expect(html).toContain('10.0.0.1');
    // evil.com should not appear in the IOC table since it was dismissed
    // and there is no standalone IOC for it
    expect(html).not.toContain('evil.com');
  });

  it('includes tasks section when tasks exist', () => {
    const data = makeReportData({
      tasks: [makeTask({ title: 'Contain compromised host', status: 'in-progress', priority: 'high' })],
    });
    const html = generateInvestigationReport(data);
    expect(html).toContain('<h2>Tasks</h2>');
    expect(html).toContain('Contain compromised host');
    expect(html).toContain('in-progress');
    expect(html).toContain('high');
  });

  it('includes notes section when notes exist', () => {
    const data = makeReportData({
      notes: [makeNote({ title: 'Initial Triage', content: 'Phishing email analysis results.' })],
    });
    const html = generateInvestigationReport(data);
    expect(html).toContain('<h2>Notes</h2>');
    expect(html).toContain('Initial Triage');
    expect(html).toContain('Phishing email analysis results.');
  });

  it('handles empty data (no notes, tasks, events, IOCs)', () => {
    const data = makeReportData({
      notes: [],
      tasks: [],
      events: [],
      standaloneIOCs: [],
    });
    const html = generateInvestigationReport(data);

    // Should still produce valid HTML
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<title>Test Investigation — Investigation Report</title>');

    // Summary table should show zero counts
    expect(html).toContain('<td>Notes</td><td>0</td>');
    expect(html).toContain('<td>Tasks</td><td>0</td>');
    expect(html).toContain('<td>Timeline Events</td><td>0</td>');
    expect(html).toContain('<td>Standalone IOCs</td><td>0</td>');
    expect(html).toContain('<td>Total IOCs (deduplicated)</td><td>0</td>');

    // Optional sections should be absent
    expect(html).not.toContain('<h2>Timeline Events</h2>');
    expect(html).not.toContain('<h2>IOC Summary</h2>');
    expect(html).not.toContain('<h2>Tasks</h2>');
    expect(html).not.toContain('<h2>Notes</h2>');
  });
});
