import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from '../components/Common/ConfirmDialog';
import { TagPills } from '../components/Common/TagPills';
import { ErrorBoundary } from '../components/Common/ErrorBoundary';
import { IOCBadge } from '../components/Analysis/IOCBadge';
import { ClsBadge } from '../components/Common/ClsBadge';
import { ActiveFilterBar } from '../components/Common/ActiveFilterBar';
import { CreateDropdown } from '../components/Common/CreateDropdown';
import type { IOCType } from '../types';

// Mock contexts (same pattern as existing tests)
vi.mock('../contexts/ToastContext', () => ({
  useToast: () => ({ addToast: vi.fn(), toasts: [], removeToast: vi.fn() }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ connected: false, user: null, serverUrl: null }),
}));

// ---------- ConfirmDialog (expanded coverage) ----------

describe('ConfirmDialog', () => {
  it('renders nothing when open is false', () => {
    const { container } = render(
      <ConfirmDialog
        open={false}
        onClose={() => {}}
        onConfirm={() => {}}
        title="Delete?"
        message="Gone forever"
      />
    );
    expect(container.innerHTML).toBe('');
  });

  it('uses default confirmLabel "Confirm" when not specified', () => {
    render(
      <ConfirmDialog
        open={true}
        onClose={() => {}}
        onConfirm={() => {}}
        title="Test"
        message="Confirm?"
      />
    );
    expect(screen.getByText('Confirm')).toBeInTheDocument();
  });

  it('uses custom confirmLabel when provided', () => {
    render(
      <ConfirmDialog
        open={true}
        onClose={() => {}}
        onConfirm={() => {}}
        title="Test"
        message="Proceed?"
        confirmLabel="Yes, do it"
      />
    );
    expect(screen.getByText('Yes, do it')).toBeInTheDocument();
    expect(screen.queryByText('Confirm')).not.toBeInTheDocument();
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        onClose={onClose}
        onConfirm={() => {}}
        title="Test"
        message="Cancel me"
      />
    );
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls both onConfirm and onClose when confirm button is clicked', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        onClose={onClose}
        onConfirm={onConfirm}
        title="Test"
        message="Do it"
        confirmLabel="Go"
      />
    );
    fireEvent.click(screen.getByText('Go'));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('applies danger styling when danger prop is true', () => {
    render(
      <ConfirmDialog
        open={true}
        onClose={() => {}}
        onConfirm={() => {}}
        title="Danger"
        message="Destructive"
        confirmLabel="Delete"
        danger
      />
    );
    const confirmBtn = screen.getByText('Delete');
    expect(confirmBtn.className).toContain('bg-red-600');
  });

  it('applies non-danger styling when danger prop is false', () => {
    render(
      <ConfirmDialog
        open={true}
        onClose={() => {}}
        onConfirm={() => {}}
        title="Safe"
        message="Safe action"
        confirmLabel="OK"
      />
    );
    const confirmBtn = screen.getByText('OK');
    expect(confirmBtn.className).toContain('bg-accent');
    expect(confirmBtn.className).not.toContain('bg-red-600');
  });

  it('displays the title and message', () => {
    render(
      <ConfirmDialog
        open={true}
        onClose={() => {}}
        onConfirm={() => {}}
        title="Important Title"
        message="This is the message body"
      />
    );
    expect(screen.getByText('Important Title')).toBeInTheDocument();
    expect(screen.getByText('This is the message body')).toBeInTheDocument();
  });

  it('renders two buttons (Cancel and confirm)', () => {
    render(
      <ConfirmDialog
        open={true}
        onClose={() => {}}
        onConfirm={() => {}}
        title="Test"
        message="Two buttons"
        confirmLabel="Accept"
      />
    );
    // Cancel and Accept buttons (plus the modal close X button)
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByText('Accept')).toBeInTheDocument();
  });
});

// ---------- TagPills ----------

describe('TagPills', () => {
  it('renders nothing when tags array is empty', () => {
    const { container } = render(<TagPills tags={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders a single tag without overflow button', () => {
    render(<TagPills tags={['alpha']} />);
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.queryByText('+0')).not.toBeInTheDocument();
  });

  it('renders first tag and overflow button for multiple tags', () => {
    render(<TagPills tags={['first', 'second', 'third']} />);
    expect(screen.getByText('first')).toBeInTheDocument();
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('shows all tags in popover when overflow button is clicked', () => {
    render(<TagPills tags={['tag1', 'tag2', 'tag3']} />);

    // Popover should not be visible initially
    expect(screen.queryByText('tag2')).not.toBeInTheDocument();
    expect(screen.queryByText('tag3')).not.toBeInTheDocument();

    // Click overflow button
    fireEvent.click(screen.getByText('+2'));

    // All tags should now be visible in the popover
    expect(screen.getByText('tag2')).toBeInTheDocument();
    expect(screen.getByText('tag3')).toBeInTheDocument();
    // tag1 appears twice: once in the main row and once in the popover
    expect(screen.getAllByText('tag1')).toHaveLength(2);
  });

  it('closes popover when overflow button is clicked again', () => {
    render(<TagPills tags={['a', 'b']} />);

    // Open popover
    fireEvent.click(screen.getByText('+1'));
    expect(screen.getByText('b')).toBeInTheDocument();

    // Close popover by clicking the button again
    fireEvent.click(screen.getByText('+1'));
    // 'b' should no longer be visible (it was only in the popover)
    expect(screen.queryByText('b')).not.toBeInTheDocument();
  });

  it('closes popover on outside click', () => {
    render(
      <div>
        <div data-testid="outside">Outside</div>
        <TagPills tags={['x', 'y']} />
      </div>
    );

    // Open popover
    fireEvent.click(screen.getByText('+1'));
    expect(screen.getByText('y')).toBeInTheDocument();

    // Click outside
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByText('y')).not.toBeInTheDocument();
  });

  it('displays overflow count correctly for many tags', () => {
    const tags = ['a', 'b', 'c', 'd', 'e'];
    render(<TagPills tags={tags} />);
    expect(screen.getByText('+4')).toBeInTheDocument();
  });

  it('stops event propagation when overflow button is clicked', () => {
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <TagPills tags={['one', 'two']} />
      </div>
    );
    fireEvent.click(screen.getByText('+1'));
    expect(parentClick).not.toHaveBeenCalled();
  });
});

// ---------- ErrorBoundary ----------

describe('ErrorBoundary', () => {
  // Suppress React error boundary console errors during tests
  const originalConsoleError = console.error;
  beforeEach(() => {
    console.error = vi.fn();
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
    if (shouldThrow) throw new Error('Test explosion');
    return <div>Working fine</div>;
  }

  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>All good</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('All good')).toBeInTheDocument();
  });

  it('shows error UI when a child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Test explosion')).toBeInTheDocument();
  });

  it('shows Reload and Copy error details buttons on error', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.getByText('Reload')).toBeInTheDocument();
    expect(screen.getByText('Copy error details')).toBeInTheDocument();
  });

  it('recovers when Reload is clicked', () => {
    // We use a wrapper to control whether the child throws
    function TestWrapper() {
      const [shouldThrow, setShouldThrow] = React.useState(true);
      return (
        <div>
          <button onClick={() => setShouldThrow(false)}>Fix Error</button>
          <ErrorBoundary>
            <ThrowingChild shouldThrow={shouldThrow} />
          </ErrorBoundary>
        </div>
      );
    }

    render(<TestWrapper />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    // Fix the error state first
    fireEvent.click(screen.getByText('Fix Error'));

    // Then click Reload to reset the error boundary
    fireEvent.click(screen.getByText('Reload'));
    expect(screen.getByText('Working fine')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });

  it('renders with region prop for logging', () => {
    render(
      <ErrorBoundary region="sidebar">
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    // The region is used internally for console logging, not displayed in UI
  });

  it('handles copy error details button click', async () => {
    // Mock clipboard API
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>
    );

    fireEvent.click(screen.getByText('Copy error details'));

    // Wait for async clipboard operation
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalled();
    });

    // Verify the copied text contains the error message
    const copiedText = writeText.mock.calls[0][0];
    expect(copiedText).toContain('Test explosion');
  });

  it('shows fallback error message when error has no message', () => {
    function ThrowEmpty(): React.ReactNode {
      throw new Error();
    }

    render(
      <ErrorBoundary>
        <ThrowEmpty />
      </ErrorBoundary>
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    // The fallback message should be displayed
    expect(screen.getByText('An unexpected error occurred.')).toBeInTheDocument();
  });
});

// ---------- IOCBadge ----------

describe('IOCBadge', () => {
  it('renders the IOC type label', () => {
    render(<IOCBadge type="ipv4" />);
    expect(screen.getByText('IPv4')).toBeInTheDocument();
  });

  it('renders correct label for each IOC type', () => {
    const typeLabels: Record<string, string> = {
      ipv4: 'IPv4',
      ipv6: 'IPv6',
      domain: 'Domain',
      url: 'URL',
      email: 'Email',
      md5: 'MD5',
      sha1: 'SHA-1',
      sha256: 'SHA-256',
      cve: 'CVE',
      'mitre-attack': 'MITRE ATT&CK',
      'yara-rule': 'YARA Rule',
      'sigma-rule': 'SIGMA Rule',
      'file-path': 'File Path',
    };

    for (const [type, label] of Object.entries(typeLabels)) {
      const { unmount } = render(<IOCBadge type={type as IOCType} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it('shows count when count is greater than 0', () => {
    render(<IOCBadge type="domain" count={5} />);
    expect(screen.getByText('Domain')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('does not show count when count is 0', () => {
    const { container } = render(<IOCBadge type="md5" count={0} />);
    expect(screen.getByText('MD5')).toBeInTheDocument();
    // Should not have a count span
    const spans = container.querySelectorAll('span');
    const countSpan = Array.from(spans).find(s => s.textContent === '0');
    expect(countSpan).toBeUndefined();
  });

  it('does not show count when count is undefined', () => {
    const { container } = render(<IOCBadge type="sha256" />);
    expect(screen.getByText('SHA-256')).toBeInTheDocument();
    const spans = container.querySelectorAll('span');
    // Should only have the label span
    expect(spans.length).toBe(1);
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<IOCBadge type="email" onClick={onClick} />);
    fireEvent.click(screen.getByText('Email'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders as a button element', () => {
    render(<IOCBadge type="cve" />);
    const button = screen.getByRole('button');
    expect(button).toBeInTheDocument();
  });

  it('has appropriate aria-label', () => {
    render(<IOCBadge type="ipv4" count={3} active />);
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-label')).toBe('IPv4 IOC filter, 3 found, active');
  });

  it('has aria-label without count info when count is undefined', () => {
    render(<IOCBadge type="domain" />);
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-label')).toBe('Domain IOC filter');
  });

  it('has aria-label with active state', () => {
    render(<IOCBadge type="url" active />);
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-label')).toBe('URL IOC filter, active');
  });

  it('applies different background opacity for active vs inactive', () => {
    const { rerender } = render(<IOCBadge type="ipv4" active={false} />);
    const inactiveBtn = screen.getByRole('button');
    const inactiveBg = inactiveBtn.style.backgroundColor;

    rerender(<IOCBadge type="ipv4" active={true} />);
    const activeBtn = screen.getByRole('button');
    const activeBg = activeBtn.style.backgroundColor;

    // Active state should have a different (more opaque) background
    expect(activeBg).not.toBe(inactiveBg);
  });
});

// ---------- ClsBadge ----------

describe('ClsBadge', () => {
  it('renders nothing when level is empty string', () => {
    const { container } = render(<ClsBadge level="" />);
    expect(container.innerHTML).toBe('');
  });

  it('renders the level text', () => {
    render(<ClsBadge level="TLP:RED" />);
    expect(screen.getByText('TLP:RED')).toBeInTheDocument();
  });

  it('renders all TLP levels correctly', () => {
    const levels = ['TLP:CLEAR', 'TLP:GREEN', 'TLP:AMBER', 'TLP:AMBER+STRICT', 'TLP:RED'];
    for (const level of levels) {
      const { unmount } = render(<ClsBadge level={level} />);
      expect(screen.getByText(level)).toBeInTheDocument();
      unmount();
    }
  });

  it('renders PAP levels correctly', () => {
    const levels = ['PAP:WHITE', 'PAP:GREEN', 'PAP:AMBER', 'PAP:RED'];
    for (const level of levels) {
      const { unmount } = render(<ClsBadge level={level} />);
      expect(screen.getByText(level)).toBeInTheDocument();
      unmount();
    }
  });

  it('applies smaller text for default xs size', () => {
    const { container } = render(<ClsBadge level="TLP:GREEN" />);
    const badge = container.querySelector('span');
    expect(badge?.className).toContain('text-[10px]');
  });

  it('applies larger text for sm size', () => {
    const { container } = render(<ClsBadge level="TLP:GREEN" size="sm" />);
    const badge = container.querySelector('span');
    expect(badge?.className).toContain('text-xs');
  });

  it('handles custom/unknown classification levels gracefully', () => {
    render(<ClsBadge level="CUSTOM:LEVEL" />);
    expect(screen.getByText('CUSTOM:LEVEL')).toBeInTheDocument();
  });

  it('renders as a span element', () => {
    const { container } = render(<ClsBadge level="TLP:RED" />);
    const el = container.firstElementChild;
    expect(el?.tagName).toBe('SPAN');
  });
});

// ---------- ActiveFilterBar ----------

describe('ActiveFilterBar', () => {
  it('renders nothing when neither folderName nor tagName is provided', () => {
    const { container } = render(
      <ActiveFilterBar onClear={() => {}} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders folder name when folderName is provided', () => {
    render(
      <ActiveFilterBar
        folderName="Investigation Alpha"
        folderColor="#3b82f6"
        onClear={() => {}}
      />
    );
    expect(screen.getByText('Investigation Alpha')).toBeInTheDocument();
  });

  it('renders tag name with # prefix when tagName is provided', () => {
    render(
      <ActiveFilterBar
        tagName="malware"
        tagColor="#ef4444"
        onClear={() => {}}
      />
    );
    expect(screen.getByText('#malware')).toBeInTheDocument();
  });

  it('renders both folder and tag when both are provided', () => {
    render(
      <ActiveFilterBar
        folderName="Case 42"
        folderColor="#3b82f6"
        tagName="urgent"
        tagColor="#ef4444"
        onClear={() => {}}
      />
    );
    expect(screen.getByText('Case 42')).toBeInTheDocument();
    expect(screen.getByText('#urgent')).toBeInTheDocument();
  });

  it('calls onClear when "Show All" button is clicked', () => {
    const onClear = vi.fn();
    render(
      <ActiveFilterBar
        folderName="Test"
        onClear={onClear}
      />
    );
    fireEvent.click(screen.getByText('Show All'));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('renders "Show All" button with correct aria-label', () => {
    render(
      <ActiveFilterBar
        folderName="Test"
        onClear={() => {}}
      />
    );
    const btn = screen.getByRole('button', { name: 'Show all' });
    expect(btn).toBeInTheDocument();
  });

  it('shows status badge when folderStatus is provided', () => {
    render(
      <ActiveFilterBar
        folderName="Case"
        folderStatus="active"
        onClear={() => {}}
      />
    );
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('shows closed status badge', () => {
    render(
      <ActiveFilterBar
        folderName="Old Case"
        folderStatus="closed"
        onClear={() => {}}
      />
    );
    expect(screen.getByText('Closed')).toBeInTheDocument();
  });

  it('shows archived status badge', () => {
    render(
      <ActiveFilterBar
        folderName="Archive"
        folderStatus="archived"
        onClear={() => {}}
      />
    );
    expect(screen.getByText('Archived')).toBeInTheDocument();
  });

  it('renders folder name as clickable button when onEditFolder is provided', () => {
    const onEditFolder = vi.fn();
    render(
      <ActiveFilterBar
        folderName="Clickable Folder"
        onClear={() => {}}
        onEditFolder={onEditFolder}
      />
    );
    const folderButton = screen.getByText('Clickable Folder');
    expect(folderButton.tagName).toBe('BUTTON');
    fireEvent.click(folderButton);
    expect(onEditFolder).toHaveBeenCalledOnce();
  });

  it('renders folder name as span when onEditFolder is not provided', () => {
    render(
      <ActiveFilterBar
        folderName="Static Folder"
        onClear={() => {}}
      />
    );
    const folderName = screen.getByText('Static Folder');
    expect(folderName.tagName).toBe('SPAN');
  });

  it('applies left border with folder color', () => {
    const { container } = render(
      <ActiveFilterBar
        folderName="Colored"
        folderColor="#ef4444"
        onClear={() => {}}
      />
    );
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.style.borderLeftColor).toBe('rgb(239, 68, 68)');
  });
});

// ---------- CreateDropdown ----------

describe('CreateDropdown', () => {
  const defaultProps = {
    onQuickNote: vi.fn(),
    onNewNote: vi.fn(),
    onNewTask: vi.fn(),
    onNewTimelineEvent: vi.fn(),
    onNewWhiteboard: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the "Create new..." trigger button', () => {
    render(<CreateDropdown {...defaultProps} />);
    expect(screen.getByTitle('Create new...')).toBeInTheDocument();
  });

  it('does not show dropdown items initially', () => {
    render(<CreateDropdown {...defaultProps} />);
    expect(screen.queryByText('Quick Note')).not.toBeInTheDocument();
    expect(screen.queryByText('Task')).not.toBeInTheDocument();
  });

  it('shows dropdown items when trigger is clicked', () => {
    render(<CreateDropdown {...defaultProps} />);
    fireEvent.click(screen.getByTitle('Create new...'));

    expect(screen.getByText('Quick Note')).toBeInTheDocument();
    expect(screen.getByText('Note Templates')).toBeInTheDocument();
    expect(screen.getByText('Task')).toBeInTheDocument();
    expect(screen.getByText('Timeline Event')).toBeInTheDocument();
    expect(screen.getByText('Whiteboard')).toBeInTheDocument();
  });

  it('calls onQuickNote and closes dropdown when Quick Note is clicked', () => {
    render(<CreateDropdown {...defaultProps} />);
    fireEvent.click(screen.getByTitle('Create new...'));
    fireEvent.click(screen.getByText('Quick Note'));

    expect(defaultProps.onQuickNote).toHaveBeenCalledOnce();
    // Dropdown should close
    expect(screen.queryByText('Task')).not.toBeInTheDocument();
  });

  it('calls onNewNote when Note Templates is clicked', () => {
    render(<CreateDropdown {...defaultProps} />);
    fireEvent.click(screen.getByTitle('Create new...'));
    fireEvent.click(screen.getByText('Note Templates'));

    expect(defaultProps.onNewNote).toHaveBeenCalledOnce();
  });

  it('calls onNewTask when Task is clicked', () => {
    render(<CreateDropdown {...defaultProps} />);
    fireEvent.click(screen.getByTitle('Create new...'));
    fireEvent.click(screen.getByText('Task'));

    expect(defaultProps.onNewTask).toHaveBeenCalledOnce();
  });

  it('calls onNewTimelineEvent when Timeline Event is clicked', () => {
    render(<CreateDropdown {...defaultProps} />);
    fireEvent.click(screen.getByTitle('Create new...'));
    fireEvent.click(screen.getByText('Timeline Event'));

    expect(defaultProps.onNewTimelineEvent).toHaveBeenCalledOnce();
  });

  it('calls onNewWhiteboard when Whiteboard is clicked', () => {
    render(<CreateDropdown {...defaultProps} />);
    fireEvent.click(screen.getByTitle('Create new...'));
    fireEvent.click(screen.getByText('Whiteboard'));

    expect(defaultProps.onNewWhiteboard).toHaveBeenCalledOnce();
  });

  it('shows IOC option when onNewIOC is provided', () => {
    const onNewIOC = vi.fn();
    render(<CreateDropdown {...defaultProps} onNewIOC={onNewIOC} />);
    fireEvent.click(screen.getByTitle('Create new...'));

    expect(screen.getByText('IOC')).toBeInTheDocument();
    fireEvent.click(screen.getByText('IOC'));
    expect(onNewIOC).toHaveBeenCalledOnce();
  });

  it('does not show IOC option when onNewIOC is not provided', () => {
    render(<CreateDropdown {...defaultProps} />);
    fireEvent.click(screen.getByTitle('Create new...'));

    expect(screen.queryByText('IOC')).not.toBeInTheDocument();
  });

  it('shows Import Data option when onImportData is provided', () => {
    const onImportData = vi.fn();
    render(<CreateDropdown {...defaultProps} onImportData={onImportData} />);
    fireEvent.click(screen.getByTitle('Create new...'));

    expect(screen.getByText('Import Data')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Import Data'));
    expect(onImportData).toHaveBeenCalledOnce();
  });

  it('toggles dropdown open and closed', () => {
    render(<CreateDropdown {...defaultProps} />);

    // Open
    fireEvent.click(screen.getByTitle('Create new...'));
    expect(screen.getByText('Quick Note')).toBeInTheDocument();

    // Close
    fireEvent.click(screen.getByTitle('Create new...'));
    expect(screen.queryByText('Quick Note')).not.toBeInTheDocument();
  });

  it('closes dropdown on outside click', () => {
    render(
      <div>
        <div data-testid="outside">Outside</div>
        <CreateDropdown {...defaultProps} />
      </div>
    );

    // Open dropdown
    fireEvent.click(screen.getByTitle('Create new...'));
    expect(screen.getByText('Quick Note')).toBeInTheDocument();

    // Click outside
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByText('Quick Note')).not.toBeInTheDocument();
  });

  it('has data-tour attribute on trigger button', () => {
    render(<CreateDropdown {...defaultProps} />);
    const trigger = screen.getByTitle('Create new...');
    expect(trigger.getAttribute('data-tour')).toBe('new-note');
  });
});

// ---------- SearchOverlay (lightweight tests for non-worker parts) ----------

// SearchOverlay has deep dependencies (web workers, useSavedSearches hook, etc.)
// so we mock the heavy parts and test the structure/interactions we can.

vi.mock('../workers/search.worker?worker', () => ({
  default: class MockWorker {
    onmessage: ((e: MessageEvent) => void) | null = null;
    postMessage() {}
    terminate() {}
  },
}));

vi.mock('../hooks/useSavedSearches', () => ({
  useSavedSearches: () => ({
    searches: [],
    saveSearch: vi.fn(),
    deleteSearch: vi.fn(),
    renameSearch: vi.fn(),
    clearAll: vi.fn(),
  }),
}));

// Import after mocks are defined
import { SearchOverlay } from '../components/Search/SearchOverlay';

describe('SearchOverlay', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    notes: [],
    tasks: [],
    clipsFolderId: undefined,
    onNavigateToNote: vi.fn(),
    onNavigateToTask: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when open is false', () => {
    const { container } = render(
      <SearchOverlay {...defaultProps} open={false} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders the search input when open', () => {
    render(<SearchOverlay {...defaultProps} />);
    const input = screen.getByPlaceholderText('Search notes, tasks, timeline, whiteboards, IOCs, chats...');
    expect(input).toBeInTheDocument();
  });

  it('renders mode toggle buttons', () => {
    render(<SearchOverlay {...defaultProps} />);
    expect(screen.getByText('Simple')).toBeInTheDocument();
    expect(screen.getByText('Regex')).toBeInTheDocument();
    expect(screen.getByText('Advanced')).toBeInTheDocument();
  });

  it('changes placeholder text when mode changes to regex', () => {
    render(<SearchOverlay {...defaultProps} />);
    fireEvent.click(screen.getByText('Regex'));
    expect(screen.getByPlaceholderText('Enter regex pattern...')).toBeInTheDocument();
  });

  it('changes placeholder text when mode changes to advanced', () => {
    render(<SearchOverlay {...defaultProps} />);
    fireEvent.click(screen.getByText('Advanced'));
    expect(screen.getByPlaceholderText('title:contains("foo") AND tags:contains("bar")...')).toBeInTheDocument();
  });

  it('shows type filter chips', () => {
    render(<SearchOverlay {...defaultProps} />);
    expect(screen.getByText('Notes')).toBeInTheDocument();
    expect(screen.getByText('Clips')).toBeInTheDocument();
    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.getByText('Timeline Events')).toBeInTheDocument();
    expect(screen.getByText('Whiteboards')).toBeInTheDocument();
    expect(screen.getByText('IOCs')).toBeInTheDocument();
    expect(screen.getByText('Chat Threads')).toBeInTheDocument();
  });

  it('shows Date filter toggle', () => {
    render(<SearchOverlay {...defaultProps} />);
    expect(screen.getByText('Date')).toBeInTheDocument();
  });

  it('shows date filter inputs when Date button is clicked', () => {
    render(<SearchOverlay {...defaultProps} />);
    fireEvent.click(screen.getByText('Date'));

    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.getByText('Updated')).toBeInTheDocument();
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<SearchOverlay {...defaultProps} onClose={onClose} />);

    // The backdrop is the element with bg-black/60
    const backdrop = document.querySelector('.bg-black\\/60');
    if (backdrop) {
      fireEvent.click(backdrop);
      expect(onClose).toHaveBeenCalledOnce();
    }
  });

  it('calls onClose when Escape key is pressed', () => {
    const onClose = vi.fn();
    render(<SearchOverlay {...defaultProps} onClose={onClose} />);

    // The overlay listens for keyDown on the wrapping div
    const overlay = document.querySelector('.fixed.inset-0');
    if (overlay) {
      fireEvent.keyDown(overlay, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledOnce();
    }
  });

  it('updates query when typing in search input', () => {
    render(<SearchOverlay {...defaultProps} />);
    const input = screen.getByPlaceholderText('Search notes, tasks, timeline, whiteboards, IOCs, chats...');
    fireEvent.change(input, { target: { value: 'test query' } });
    expect(input).toHaveValue('test query');
  });

  it('shows clear button when query is non-empty', () => {
    render(<SearchOverlay {...defaultProps} />);
    const input = screen.getByPlaceholderText('Search notes, tasks, timeline, whiteboards, IOCs, chats...');
    fireEvent.change(input, { target: { value: 'something' } });

    // There should be a Clear button and an X button in the input
    expect(screen.getByText('Clear')).toBeInTheDocument();
  });

  it('clears query when Clear button is clicked', () => {
    render(<SearchOverlay {...defaultProps} />);
    const input = screen.getByPlaceholderText('Search notes, tasks, timeline, whiteboards, IOCs, chats...');
    fireEvent.change(input, { target: { value: 'hello' } });
    expect(input).toHaveValue('hello');

    fireEvent.click(screen.getByText('Clear'));
    expect(input).toHaveValue('');
  });

  it('has a Save Search button', () => {
    render(<SearchOverlay {...defaultProps} />);
    expect(screen.getByText('Save Search')).toBeInTheDocument();
  });

  it('disables Save Search button when query is empty', () => {
    render(<SearchOverlay {...defaultProps} />);
    const saveBtn = screen.getByText('Save Search').closest('button');
    expect(saveBtn).toBeDisabled();
  });

  it('renders investigation scope picker showing "All" by default', () => {
    render(<SearchOverlay {...defaultProps} />);
    expect(screen.getByText('All')).toBeInTheDocument();
  });

  it('shows folder dropdown when investigation scope button is clicked', () => {
    render(
      <SearchOverlay
        {...defaultProps}
        folders={[
          { id: 'f1', name: 'Case Alpha', order: 0, createdAt: Date.now() },
          { id: 'f2', name: 'Case Beta', order: 1, createdAt: Date.now() },
        ]}
      />
    );

    // Click the scope button (shows "All")
    const allBtn = screen.getByText('All');
    fireEvent.click(allBtn);

    // Should show the folder dropdown with options
    expect(screen.getByText('All Investigations')).toBeInTheDocument();
    expect(screen.getByText('Case Alpha')).toBeInTheDocument();
    expect(screen.getByText('Case Beta')).toBeInTheDocument();
  });
});
