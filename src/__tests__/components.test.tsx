import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal } from '../components/Common/Modal';
import { ConfirmDialog } from '../components/Common/ConfirmDialog';
import { ThemeToggle } from '../components/Common/ThemeToggle';
import { NoteCard } from '../components/Notes/NoteCard';
import { Header } from '../components/Layout/Header';
import type { Note } from '../types';

describe('Modal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <Modal open={false} onClose={() => {}} title="Test">
        <p>Content</p>
      </Modal>
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders title and content when open', () => {
    render(
      <Modal open={true} onClose={() => {}} title="My Modal">
        <p>Modal content</p>
      </Modal>
    );
    expect(screen.getByText('My Modal')).toBeInTheDocument();
    expect(screen.getByText('Modal content')).toBeInTheDocument();
  });

  it('calls onClose when X button is clicked', () => {
    let closed = false;
    render(
      <Modal open={true} onClose={() => { closed = true; }} title="Test">
        <p>Content</p>
      </Modal>
    );
    const closeBtn = screen.getByRole('button');
    fireEvent.click(closeBtn);
    expect(closed).toBe(true);
  });
});

describe('ConfirmDialog', () => {
  it('shows message and action buttons', () => {
    render(
      <ConfirmDialog
        open={true}
        onClose={() => {}}
        onConfirm={() => {}}
        title="Delete?"
        message="Are you sure?"
        confirmLabel="Yes, delete"
        danger
      />
    );
    expect(screen.getByText('Delete?')).toBeInTheDocument();
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
    expect(screen.getByText('Yes, delete')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('calls onConfirm and onClose when confirmed', () => {
    let confirmed = false;
    let closed = false;
    render(
      <ConfirmDialog
        open={true}
        onClose={() => { closed = true; }}
        onConfirm={() => { confirmed = true; }}
        title="Are you sure?"
        message="Proceed?"
        confirmLabel="Yes"
      />
    );
    fireEvent.click(screen.getByText('Yes'));
    expect(confirmed).toBe(true);
    expect(closed).toBe(true);
  });
});

describe('ThemeToggle', () => {
  it('shows sun icon in dark mode', () => {
    const { container } = render(<ThemeToggle theme="dark" onToggle={() => {}} />);
    expect(container.querySelector('button')).toBeInTheDocument();
  });

  it('calls onToggle when clicked', () => {
    let toggled = false;
    render(<ThemeToggle theme="dark" onToggle={() => { toggled = true; }} />);
    fireEvent.click(screen.getByRole('button'));
    expect(toggled).toBe(true);
  });
});

describe('NoteCard', () => {
  const note: Note = {
    id: '1',
    title: 'Test Note',
    content: '# Hello World\n\nSome **bold** text',
    tags: ['work', 'important'],
    pinned: true,
    archived: false,
    trashed: false,
    createdAt: Date.now() - 3600000,
    updatedAt: Date.now(),
  };

  it('renders note title', () => {
    render(<NoteCard note={note} active={false} onClick={() => {}} />);
    expect(screen.getByText('Test Note')).toBeInTheDocument();
  });

  it('shows tags', () => {
    render(<NoteCard note={note} active={false} onClick={() => {}} />);
    expect(screen.getByText('work')).toBeInTheDocument();
    expect(screen.getByText('important')).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    let clicked = false;
    render(<NoteCard note={note} active={false} onClick={() => { clicked = true; }} />);
    fireEvent.click(screen.getByText('Test Note'));
    expect(clicked).toBe(true);
  });

  it('shows "Untitled" for empty title', () => {
    const untitled = { ...note, title: '' };
    render(<NoteCard note={untitled} active={false} onClick={() => {}} />);
    expect(screen.getByText('Untitled')).toBeInTheDocument();
  });

  it('shows folder name badge when folderName is set', () => {
    render(<NoteCard note={note} active={false} onClick={() => {}} folderName="Work" folderColor="#3b82f6" />);
    expect(screen.getByText('Work')).toBeInTheDocument();
  });

  it('does not show folder badge when folderName is not set', () => {
    render(<NoteCard note={note} active={false} onClick={() => {}} />);
    expect(screen.queryByText('Work')).not.toBeInTheDocument();
  });

  it('applies folder color left border when not active', () => {
    const { container } = render(<NoteCard note={note} active={false} onClick={() => {}} folderColor="#ef4444" folderName="Clips" />);
    const card = container.querySelector('div[role="button"]') as HTMLElement;
    expect(card).toBeTruthy();
    // jsdom normalizes hex to rgb
    expect(card.style.borderLeftColor).toBe('rgb(239, 68, 68)');
    expect(parseInt(card.style.borderLeftWidth)).toBe(3);
  });

  it('does not apply folder color left border when active', () => {
    const { container } = render(<NoteCard note={note} active={true} onClick={() => {}} folderColor="#ef4444" folderName="Clips" />);
    const card = container.querySelector('div[role="button"]') as HTMLElement;
    expect(card).toBeTruthy();
    expect(card.style.borderLeftColor).toBe('');
  });

  it('shows IOC count badge when note has active IOCs', () => {
    const noteWithIOCs: Note = {
      ...note,
      iocAnalysis: {
        extractedAt: Date.now(),
        iocs: [
          { id: 'i1', type: 'ipv4', value: '1.2.3.4', confidence: 'high', firstSeen: Date.now(), dismissed: false },
          { id: 'i2', type: 'domain', value: 'evil.com', confidence: 'high', firstSeen: Date.now(), dismissed: false },
          { id: 'i3', type: 'md5', value: 'abc', confidence: 'low', firstSeen: Date.now(), dismissed: true },
        ],
      },
    };
    render(<NoteCard note={noteWithIOCs} active={false} onClick={() => {}} />);
    expect(screen.getByText('2')).toBeInTheDocument(); // 2 non-dismissed
  });
});

describe('Header', () => {
  const defaultProps = {
    onOpenSearch: () => {},
    theme: 'dark' as const,
    onToggleTheme: () => {},
    onNewNote: () => {},
    onNewTask: () => {},
    onToggleSidebar: () => {},
    onMobileMenuToggle: () => {},
    sidebarCollapsed: false,
    onQuickSave: () => {},
    onQuickLoad: () => {},
  };

  it('highlights Note button when activeView is notes', () => {
    render(<Header {...defaultProps} activeView="notes" />);
    const noteBtn = screen.getByTitle('New Note (Ctrl+N)');
    expect(noteBtn.className).toContain('bg-accent');
  });

  it('does not highlight Note button when activeView is tasks', () => {
    render(<Header {...defaultProps} activeView="tasks" />);
    const noteBtn = screen.getByTitle('New Note (Ctrl+N)');
    expect(noteBtn.className).toContain('bg-gray-700');
    expect(noteBtn.className).not.toContain('bg-accent');
  });

  it('highlights Task button when activeView is tasks', () => {
    render(<Header {...defaultProps} activeView="tasks" />);
    const taskBtn = screen.getByTitle('New Task (Ctrl+Shift+T)');
    expect(taskBtn.className).toContain('bg-accent');
  });

  it('does not highlight Task button when activeView is notes', () => {
    render(<Header {...defaultProps} activeView="notes" />);
    const taskBtn = screen.getByTitle('New Task (Ctrl+Shift+T)');
    expect(taskBtn.className).toContain('bg-gray-700');
    expect(taskBtn.className).not.toContain('bg-accent');
  });
});
