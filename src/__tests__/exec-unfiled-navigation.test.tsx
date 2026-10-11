import type { ComponentProps } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExecDashboard } from '../components/ExecMode/ExecDashboard';
import { ExecDetailNav } from '../components/ExecMode/ExecDetailNav';
import { db } from '../db';

type DetailBoundary = { onBack: () => void; currentIndex?: number; totalCount?: number; onNavigate?: (direction: 'prev' | 'next') => void };
// Expose the parent's Back callback independently of the detail renderer. The
// global/folder lists, breadcrumbs, scope decisions and footer remain real.
function Detail({ title, onBack, currentIndex, totalCount, onNavigate }: DetailBoundary & { title: string }) {
  return <><h2>{title}</h2><button onClick={onBack}>Return from detail</button>
    {currentIndex !== undefined && totalCount !== undefined && onNavigate && <ExecDetailNav currentIndex={currentIndex} totalCount={totalCount}
      onPrev={() => onNavigate('prev')} onNext={() => onNavigate('next')} />}</>;
}
vi.mock('../components/ExecMode/ExecNoteView', () => ({ ExecNoteView: (props: DetailBoundary & { note: { title: string } }) => <Detail {...props} title={props.note.title} /> }));
vi.mock('../components/ExecMode/ExecTaskView', () => ({ ExecTaskView: (props: DetailBoundary & { task: { title: string } }) => <Detail {...props} title={props.task.title} /> }));
vi.mock('../components/ExecMode/ExecEventView', () => ({ ExecEventView: (props: DetailBoundary & { event: { title: string } }) => <Detail {...props} title={props.event.title} /> }));
vi.mock('../components/ExecMode/ExecIOCView', () => ({ ExecIOCView: (props: DetailBoundary & { ioc: { value: string } }) => <Detail {...props} title={props.ioc.value} /> }));
vi.mock('../components/ExecMode/ExecEntityNav', () => ({ ExecEntityNav: () => <div data-testid="investigation-tabs" /> }));
vi.mock('../components/ExecMode/ShareDialog', () => ({ ShareDialog: () => null }));

function properties(folderId?: string): ComponentProps<typeof ExecDashboard> {
  const now = Date.now();
  const common = { folderId, tags: [], archived: false, trashed: false, createdAt: now, updatedAt: now };
  return { folders: folderId ? [{ id: folderId, name: 'Fictional case', order: 0, createdAt: now }] : [],
    allNotes: [{ ...common, id: 'note', title: 'Fictional note', content: '', pinned: false }],
    allTasks: [{ ...common, id: 'task', title: 'Fictional task', completed: false, priority: 'none', status: 'todo', order: 0 }],
    allEvents: [{ ...common, id: 'event', title: 'Fictional event', timestamp: now, source: '', confidence: 'medium', eventType: 'other',
      timelineId: 'fictional-timeline', linkedIOCIds: [], linkedNoteIds: [], linkedTaskIds: [], mitreAttackIds: [], assets: [], starred: false }],
    allIOCs: [{ ...common, id: 'ioc', value: 'fictional.example.invalid', type: 'domain', confidence: 'medium' }],
    allWhiteboards: [], allTimelines: [], allTags: [], allChatThreads: [], activityEntries: [],
    theme: 'dark', onToggleTheme: vi.fn(), onSwitchToAnalystMode: vi.fn() };
}

const cases = [
  { kind: 'note', metric: /^1\s*Notes$/, title: 'Fictional note', global: 'All Notes', list: 'Notes' },
  { kind: 'task', metric: /^1\s*Open Tasks$/, title: 'Fictional task', global: 'Open Tasks', list: 'Tasks' },
  { kind: 'event', metric: /^1\s*Events This Week$/, title: 'Fictional event', global: 'Events This Week', list: 'Events' },
  { kind: 'ioc', metric: /^1\s*IOCs Tracked$/, title: 'fictional.example.invalid', global: 'All IOCs', list: 'IOCs' },
];

beforeEach(async () => { await db.agentActions.clear(); await db.agentDeployments.clear(); });

describe('Exec detail list ownership', () => {
  it.each(cases)('returns unfiled $kind details to their actual global list', async scenario => {
    render(<ExecDashboard {...properties()} />);
    fireEvent.click(screen.getByRole('button', { name: scenario.metric }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(scenario.title.replaceAll('.', '\\.')) }));
    await waitFor(() => expect(screen.getByRole('heading', { name: scenario.title })).toBeVisible());
    expect(screen.queryByText('0 of 0')).not.toBeInTheDocument();
    expect(screen.queryByTestId('investigation-tabs')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Investigation' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Overview' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: scenario.global }));
    const item = screen.getByRole('button', { name: new RegExp(scenario.title.replaceAll('.', '\\.')) });
    expect(item).toBeVisible();
    fireEvent.click(item);
    fireEvent.click(screen.getByRole('button', { name: 'Return from detail' }));
    expect(screen.getByRole('button', { name: new RegExp(scenario.title.replaceAll('.', '\\.')) })).toBeVisible();
    expect(screen.getByText(scenario.global, { exact: true })).toBeVisible();
    expect(screen.queryByTestId('investigation-tabs')).not.toBeInTheDocument();
  });

  it.each(cases)('preserves the filed $kind investigation and navigation position', async scenario => {
    render(<ExecDashboard {...properties('fictional-case')} />);
    fireEvent.click(screen.getByRole('button', { name: scenario.metric }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(scenario.title.replaceAll('.', '\\.')) }));
    await waitFor(() => expect(screen.getByRole('heading', { name: scenario.title })).toBeVisible());
    expect(screen.getByText('1 of 1')).toBeVisible();
    expect(screen.getByTestId('investigation-tabs')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Fictional case' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: scenario.list }));
    expect(screen.getByRole('heading', { name: scenario.list })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(scenario.title.replaceAll('.', '\\.')) }));
    fireEvent.click(screen.getByRole('button', { name: 'Return from detail' }));
    expect(screen.getByRole('heading', { name: scenario.list })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Fictional case' })).toBeVisible();
    expect(screen.getByTestId('investigation-tabs')).toBeVisible();
  });
});
