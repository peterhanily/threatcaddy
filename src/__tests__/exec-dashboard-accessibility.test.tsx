import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExecDashboard } from '../components/ExecMode/ExecDashboard';
import { db } from '../db';
import i18n from '../i18n';
import type { ChatThread, Note } from '../types';

vi.mock('../components/ExecMode/ShareDialog', () => ({ ShareDialog: () => null }));

const properties = {
  folders: [], allNotes: [], allTasks: [], allEvents: [], allWhiteboards: [], allIOCs: [], allTimelines: [], allTags: [], allChatThreads: [], activityEntries: [],
  theme: 'dark' as const, onToggleTheme: vi.fn(), onSwitchToAnalystMode: vi.fn(),
};

beforeEach(async () => {
  properties.onToggleTheme.mockReset(); properties.onSwitchToAnalystMode.mockReset();
  await db.agentActions.clear(); await db.agentDeployments.clear();
});
afterEach(async () => { await i18n.changeLanguage('en'); vi.restoreAllMocks(); });

describe('Exec dashboard accessible entry controls', () => {
  it('names the theme action for each current state and preserves analyst navigation', async () => {
    const view = render(<ExecDashboard {...properties} />);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(properties.onToggleTheme).toHaveBeenCalledOnce();
    view.rerender(<ExecDashboard {...properties} theme="light" />);
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Analyst Mode' }));
    expect(properties.onSwitchToAnalystMode).toHaveBeenCalledExactlyOnceWith();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Your workspace is ready' })).toBeVisible());
  });

  it('offers a useful empty-workspace action without creating data or removing metric navigation', async () => {
    const request = vi.spyOn(globalThis, 'fetch');
    render(<ExecDashboard {...properties} />);
    expect(screen.getByText(/Create an investigation or import your existing work/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Open Analyst Mode' }));
    expect(properties.onSwitchToAnalystMode).toHaveBeenCalledExactlyOnceWith();
    expect(await db.notes.count()).toBe(0);
    expect(await db.folders.count()).toBe(0);
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /0\s*Notes/ }));
    expect(screen.queryByText('Your workspace is ready')).not.toBeInTheDocument();
    expect(properties.onSwitchToAnalystMode).toHaveBeenCalledOnce();
  });

  it('does not label a workspace with unfiled saved work as empty', async () => {
    const note: Note = { id: 'local-note', title: 'Saved local work', content: '', tags: [], pinned: false, archived: false, trashed: false, createdAt: 1, updatedAt: 1 };
    render(<ExecDashboard {...properties} allNotes={[note]} />);
    expect(screen.queryByRole('heading', { name: 'Your workspace is ready' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /1\s*Notes/ })).toBeVisible());
  });

  it('uses the active locale for its navigation label rather than the English literal', async () => {
    for (const [namespace, values] of Object.entries(i18n.getDataByLanguage('en') ?? {})) i18n.addResourceBundle('fr', namespace, values, true, false);
    i18n.addResourceBundle('fr', 'exec', { 'dashboard.switchToAnalyst': 'Passer en mode analyste', 'dashboard.switchToLight': 'Passer au thème clair' }, true, true);
    // Reuse loaded English fallbacks for unrelated namespaces; no locale fetches.
    await i18n.changeLanguage('fr');
    render(<ExecDashboard {...properties} />);
    expect(screen.getByRole('button', { name: 'Passer en mode analyste' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Passer au thème clair' })).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Switch to Analyst Mode' })).not.toBeInTheDocument());
  });

  it('refreshes the open chat breadcrumb after a rename and a locale change', async () => {
    const chat: ChatThread = { id: 'fictional-chat', title: 'Original fictional chat', messages: [], model: 'synthetic-model', provider: 'anthropic', tags: [], trashed: false, archived: false, createdAt: 1, updatedAt: 1 };
    const view = render(<ExecDashboard {...properties} allChatThreads={[chat]} />);
    fireEvent.click(screen.getByRole('button', { name: /1\s*AI Chats/ }));
    fireEvent.click(screen.getByRole('button', { name: /Original fictional chat/ }));
    expect(screen.getByRole('button', { name: 'Overview' })).toBeVisible();
    view.rerender(<ExecDashboard {...properties} allChatThreads={[{ ...chat, title: 'Renamed fictional chat' }]} />);
    expect(screen.queryByText('Original fictional chat')).not.toBeInTheDocument();
    expect(screen.getAllByText('Renamed fictional chat').length).toBeGreaterThan(0);
    for (const [namespace, values] of Object.entries(i18n.getDataByLanguage('en') ?? {})) i18n.addResourceBundle('fr', namespace, values, true, false);
    i18n.addResourceBundle('fr', 'exec', { 'breadcrumb.overview': 'Vue de test', 'breadcrumb.aiChats': 'Conversations de test' }, true, true);
    await act(async () => { await i18n.changeLanguage('fr'); });
    expect(screen.queryByRole('button', { name: 'Overview' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vue de test' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Conversations de test' })).toBeVisible();
    expect(screen.getAllByText('Renamed fictional chat').length).toBeGreaterThan(0);
  });
});
