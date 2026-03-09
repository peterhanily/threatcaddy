import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InvestigationsHub } from '../components/Investigations/InvestigationsHub';
import { InvestigationCard } from '../components/Investigations/InvestigationCard';
import { CreateInvestigationModal } from '../components/Investigations/CreateInvestigationModal';
import type { Folder, InvestigationSummary } from '../types';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../contexts/ToastContext', () => ({
  useToast: () => ({ addToast: vi.fn(), toasts: [], removeToast: vi.fn() }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ connected: false, user: null, serverUrl: null }),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeFolder(overrides: Partial<Folder> = {}): Folder {
  return {
    id: 'local-1',
    name: 'Op Falcon',
    order: 0,
    createdAt: Date.now(),
    status: 'active',
    ...overrides,
  };
}

function makeRemoteSummary(overrides: Partial<InvestigationSummary> = {}): InvestigationSummary {
  return {
    folderId: 'remote-1',
    role: 'editor',
    joinedAt: '2024-01-01T00:00:00Z',
    folder: {
      name: 'Shared Investigation',
      status: 'active',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
    },
    entityCounts: { notes: 3, tasks: 2, iocs: 1, events: 0, whiteboards: 0, chats: 0 },
    memberCount: 3,
    ...overrides,
  };
}

const defaultHubProps = {
  localFolders: [] as Folder[],
  remoteInvestigations: [] as InvestigationSummary[],
  syncedFolderIds: new Set<string>(),
  serverConnected: true,
  localLoading: false,
  remoteLoading: false,
  onOpenInvestigation: vi.fn(),
  onSyncLocally: vi.fn(),
  onUnsync: vi.fn(),
  onCreateInvestigation: vi.fn(),
  onEditInvestigation: vi.fn(),
  onArchiveInvestigation: vi.fn(),
  onDeleteInvestigation: vi.fn(),
};

// ── InvestigationsHub ─────────────────────────────────────────────────────────

describe('InvestigationsHub', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders "My Investigations" section with local folder cards', () => {
    render(
      <InvestigationsHub
        {...defaultHubProps}
        localFolders={[makeFolder()]}
      />
    );
    expect(screen.getByText('My Investigations')).toBeInTheDocument();
    expect(screen.getByText('Op Falcon')).toBeInTheDocument();
  });

  it('renders "Shared With Me" section with remote investigation cards', () => {
    render(
      <InvestigationsHub
        {...defaultHubProps}
        remoteInvestigations={[makeRemoteSummary()]}
      />
    );
    expect(screen.getByText('Shared With Me')).toBeInTheDocument();
    expect(screen.getByText('Shared Investigation')).toBeInTheDocument();
  });

  it('shows skeleton cards when loading', () => {
    const { container } = render(
      <InvestigationsHub
        {...defaultHubProps}
        localLoading={true}
        remoteLoading={true}
      />
    );
    // Skeleton cards use animate-pulse class
    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThanOrEqual(3);
  });

  it('shows disconnected banner when serverConnected is false', () => {
    render(
      <InvestigationsHub
        {...defaultHubProps}
        serverConnected={false}
      />
    );
    expect(screen.getByText(/Server disconnected/)).toBeInTheDocument();
  });

  it('shows empty state when no investigations', () => {
    render(<InvestigationsHub {...defaultHubProps} />);
    expect(screen.getByText('No local investigations')).toBeInTheDocument();
    expect(screen.getByText('No shared investigations — ask a team member to invite you')).toBeInTheDocument();
  });

  it('calls onCreateInvestigation when "New Investigation" button clicked', () => {
    const onCreate = vi.fn();
    render(
      <InvestigationsHub
        {...defaultHubProps}
        onCreateInvestigation={onCreate}
      />
    );
    fireEvent.click(screen.getByText('New Investigation'));
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it('correctly partitions folders into local/synced/shared sections', () => {
    const localOnly = makeFolder({ id: 'local-1', name: 'Pure Local' });
    const syncedFolder = makeFolder({ id: 'synced-1', name: 'Synced Folder' });
    const remoteOnly = makeRemoteSummary({ folderId: 'remote-only', folder: { name: 'Remote Only', status: 'active', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-02T00:00:00Z' } });
    const remoteForSynced = makeRemoteSummary({ folderId: 'synced-1', folder: { name: 'Synced Remote', status: 'active', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-02T00:00:00Z' } });

    render(
      <InvestigationsHub
        {...defaultHubProps}
        localFolders={[localOnly, syncedFolder]}
        remoteInvestigations={[remoteOnly, remoteForSynced]}
        syncedFolderIds={new Set(['synced-1'])}
      />
    );

    // Pure Local should be in My Investigations
    expect(screen.getByText('Pure Local')).toBeInTheDocument();
    // Synced Folder should be in Synced Investigations
    expect(screen.getByText('Synced Folder')).toBeInTheDocument();
    // Remote Only should be in Shared With Me
    expect(screen.getByText('Remote Only')).toBeInTheDocument();
  });

  it('renders the "Create Investigation" button in empty state', () => {
    const onCreate = vi.fn();
    render(
      <InvestigationsHub
        {...defaultHubProps}
        onCreateInvestigation={onCreate}
      />
    );
    // There should be a "Create Investigation" button inside the empty state
    const createButtons = screen.getAllByText('Create Investigation');
    expect(createButtons.length).toBeGreaterThanOrEqual(1);
  });
});

// ── InvestigationCard ─────────────────────────────────────────────────────────

describe('InvestigationCard', () => {
  const defaultCardProps = {
    folderId: 'card-1',
    name: 'Op Thunder',
    status: 'active' as const,
    entityCounts: { notes: 5, tasks: 3, iocs: 2, events: 1, whiteboards: 0, chats: 0 },
    dataMode: 'local' as const,
    onOpen: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders name and status badge', () => {
    render(<InvestigationCard {...defaultCardProps} />);
    expect(screen.getByText('Op Thunder')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('renders entity counts', () => {
    render(<InvestigationCard {...defaultCardProps} />);
    expect(screen.getByText('5')).toBeInTheDocument(); // notes
    expect(screen.getByText('3')).toBeInTheDocument(); // tasks
    expect(screen.getByText('2')).toBeInTheDocument(); // iocs
  });

  it('shows data mode badge (Local/Synced/Remote)', () => {
    const { rerender } = render(<InvestigationCard {...defaultCardProps} dataMode="local" />);
    expect(screen.getByText('Local')).toBeInTheDocument();

    rerender(<InvestigationCard {...defaultCardProps} dataMode="remote" />);
    expect(screen.getByText('Remote')).toBeInTheDocument();
  });

  it('calls onOpen when clicked', () => {
    const onOpen = vi.fn();
    render(<InvestigationCard {...defaultCardProps} onOpen={onOpen} />);
    // The card is a button — click it
    fireEvent.click(screen.getByText('Op Thunder'));
    expect(onOpen).toHaveBeenCalledWith('card-1');
  });

  it('shows context menu on three-dot button click', () => {
    const onSettings = vi.fn();
    render(
      <InvestigationCard
        {...defaultCardProps}
        onSettings={onSettings}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    // Find the three-dot menu button (MoreVertical icon with role="button")
    const menuButton = screen.getByTitle('Actions');
    fireEvent.click(menuButton);
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Archive')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('context menu calls onSettings, onArchive, onDelete', () => {
    const onSettings = vi.fn();
    const onArchive = vi.fn();
    const onDelete = vi.fn();
    render(
      <InvestigationCard
        {...defaultCardProps}
        onSettings={onSettings}
        onArchive={onArchive}
        onDelete={onDelete}
      />
    );
    // Open menu
    fireEvent.click(screen.getByTitle('Actions'));

    fireEvent.click(screen.getByText('Settings'));
    expect(onSettings).toHaveBeenCalledWith('card-1');

    // Re-open menu (it closes after click)
    fireEvent.click(screen.getByTitle('Actions'));
    fireEvent.click(screen.getByText('Archive'));
    expect(onArchive).toHaveBeenCalledWith('card-1');

    fireEvent.click(screen.getByTitle('Actions'));
    fireEvent.click(screen.getByText('Delete'));
    expect(onDelete).toHaveBeenCalledWith('card-1');
  });

  it('Sync button calls onSync for remote cards', () => {
    const onSync = vi.fn();
    render(
      <InvestigationCard
        {...defaultCardProps}
        dataMode="remote"
        onSync={onSync}
      />
    );
    const syncBtn = screen.getByText('Sync');
    fireEvent.click(syncBtn);
    expect(onSync).toHaveBeenCalledWith('card-1');
  });

  it('Unsync button calls onUnsync for synced cards', () => {
    const onUnsync = vi.fn();
    render(
      <InvestigationCard
        {...defaultCardProps}
        dataMode="synced"
        onUnsync={onUnsync}
      />
    );
    const unsyncBtn = screen.getByText('Unsync');
    fireEvent.click(unsyncBtn);
    expect(onUnsync).toHaveBeenCalledWith('card-1');
  });

  it('shows member count when provided', () => {
    render(
      <InvestigationCard
        {...defaultCardProps}
        dataMode="remote"
        memberCount={5}
      />
    );
    expect(screen.getByText('5 members')).toBeInTheDocument();
  });

  it('shows role badge when provided', () => {
    render(
      <InvestigationCard
        {...defaultCardProps}
        dataMode="remote"
        role="viewer"
      />
    );
    expect(screen.getByText('Viewer')).toBeInTheDocument();
  });

  it('shows CLS level when provided', () => {
    render(
      <InvestigationCard
        {...defaultCardProps}
        clsLevel="TLP:AMBER"
      />
    );
    expect(screen.getByText('TLP:AMBER')).toBeInTheDocument();
  });
});

// ── CreateInvestigationModal ──────────────────────────────────────────────────

describe('CreateInvestigationModal', () => {
  const defaultModalProps = {
    open: true,
    onClose: vi.fn(),
    onCreate: vi.fn(),
    onOpenNameGenerator: vi.fn(),
    onOpenPlaybookPicker: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders three tabs', () => {
    render(<CreateInvestigationModal {...defaultModalProps} />);
    expect(screen.getByText('Quick Create')).toBeInTheDocument();
    expect(screen.getByText('Name Generator')).toBeInTheDocument();
    expect(screen.getByText('From Playbook')).toBeInTheDocument();
  });

  it('Quick Create tab: creates investigation on Enter', async () => {
    const onCreate = vi.fn();
    render(<CreateInvestigationModal {...defaultModalProps} onCreate={onCreate} />);
    const input = screen.getByPlaceholderText('e.g. Operation Midnight Storm');
    await userEvent.type(input, 'Op Test{Enter}');
    expect(onCreate).toHaveBeenCalledWith('Op Test');
  });

  it('Quick Create tab: disables button when name is empty', () => {
    render(<CreateInvestigationModal {...defaultModalProps} />);
    const createBtn = screen.getByText('Create Investigation');
    expect(createBtn).toBeDisabled();
  });

  it('Quick Create tab: enables button when name has content', async () => {
    render(<CreateInvestigationModal {...defaultModalProps} />);
    const input = screen.getByPlaceholderText('e.g. Operation Midnight Storm');
    await userEvent.type(input, 'Something');
    const createBtn = screen.getByText('Create Investigation');
    expect(createBtn).not.toBeDisabled();
  });

  it('Name Generator tab: calls onOpenNameGenerator when button clicked', async () => {
    const onOpenNameGen = vi.fn();
    const onClose = vi.fn();
    render(
      <CreateInvestigationModal
        {...defaultModalProps}
        onClose={onClose}
        onOpenNameGenerator={onOpenNameGen}
      />
    );
    // Switch to Name Generator tab
    fireEvent.click(screen.getByText('Name Generator'));
    fireEvent.click(screen.getByText('Open Name Generator'));
    expect(onClose).toHaveBeenCalled();
    expect(onOpenNameGen).toHaveBeenCalled();
  });

  it('Playbook tab: calls onOpenPlaybookPicker when button clicked', async () => {
    const onOpenPlaybook = vi.fn();
    const onClose = vi.fn();
    render(
      <CreateInvestigationModal
        {...defaultModalProps}
        onClose={onClose}
        onOpenPlaybookPicker={onOpenPlaybook}
      />
    );
    // Switch to Playbook tab
    fireEvent.click(screen.getByText('From Playbook'));
    fireEvent.click(screen.getByText('Browse Playbooks'));
    expect(onClose).toHaveBeenCalled();
    expect(onOpenPlaybook).toHaveBeenCalled();
  });

  it('renders nothing when open is false', () => {
    const { container } = render(
      <CreateInvestigationModal {...defaultModalProps} open={false} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('Quick Create: clicking Create Investigation button with valid name calls onCreate', async () => {
    const onCreate = vi.fn();
    render(<CreateInvestigationModal {...defaultModalProps} onCreate={onCreate} />);
    const input = screen.getByPlaceholderText('e.g. Operation Midnight Storm');
    await userEvent.type(input, 'My Investigation');
    fireEvent.click(screen.getByText('Create Investigation'));
    expect(onCreate).toHaveBeenCalledWith('My Investigation');
  });
});
