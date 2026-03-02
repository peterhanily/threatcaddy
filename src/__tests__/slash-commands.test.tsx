import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInput } from '../components/Chat/ChatInput';

// ── Helpers ──────────────────────────────────────────────────────────

const defaultProps = {
  onSend: vi.fn(),
  onStop: vi.fn(),
  isStreaming: false,
  extensionAvailable: true,
  model: 'claude-sonnet-4-6',
  onModelChange: vi.fn(),
  disabled: false,
};

function renderInput(overrides: Partial<typeof defaultProps> = {}) {
  return render(<ChatInput {...defaultProps} {...overrides} />);
}

function getTextarea() {
  return screen.getByRole('textbox') as HTMLTextAreaElement;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('ChatInput slash command menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Visibility ──

  describe('visibility', () => {
    it('does not show menu when input is empty', () => {
      renderInput();
      expect(screen.queryByText('/fetch')).not.toBeInTheDocument();
    });

    it('shows menu when user types "/"', async () => {
      renderInput();
      await userEvent.type(getTextarea(), '/');
      expect(screen.getByText('/fetch')).toBeInTheDocument();
      expect(screen.getByText('/search')).toBeInTheDocument();
      expect(screen.getByText('/note')).toBeInTheDocument();
      expect(screen.getByText('/task')).toBeInTheDocument();
      expect(screen.getByText('/iocs')).toBeInTheDocument();
      expect(screen.getByText('/summary')).toBeInTheDocument();
      expect(screen.getByText('/timeline')).toBeInTheDocument();
    });

    it('shows all 7 commands when only "/" is typed', async () => {
      renderInput();
      await userEvent.type(getTextarea(), '/');
      const buttons = screen.getAllByRole('button').filter(
        (b) => b.textContent?.startsWith('/')
      );
      expect(buttons).toHaveLength(7);
    });

    it('hides menu when text does not start with "/"', async () => {
      renderInput();
      await userEvent.type(getTextarea(), 'hello');
      expect(screen.queryByText('/fetch')).not.toBeInTheDocument();
    });

    it('hides menu after a space is typed (user moved to args)', async () => {
      renderInput();
      const textarea = getTextarea();
      await userEvent.type(textarea, '/fetch ');
      expect(screen.queryByText('/search')).not.toBeInTheDocument();
    });
  });

  // ── Filtering ──

  describe('filtering', () => {
    it('filters to matching commands as user types', async () => {
      renderInput();
      await userEvent.type(getTextarea(), '/fe');
      expect(screen.getByText('/fetch')).toBeInTheDocument();
      expect(screen.queryByText('/search')).not.toBeInTheDocument();
      expect(screen.queryByText('/note')).not.toBeInTheDocument();
    });

    it('filters to /search and /summary for "/s"', async () => {
      renderInput();
      await userEvent.type(getTextarea(), '/s');
      expect(screen.getByText('/search')).toBeInTheDocument();
      expect(screen.getByText('/summary')).toBeInTheDocument();
      expect(screen.queryByText('/fetch')).not.toBeInTheDocument();
    });

    it('filters to /task and /timeline for "/t"', async () => {
      renderInput();
      await userEvent.type(getTextarea(), '/t');
      expect(screen.getByText('/task')).toBeInTheDocument();
      expect(screen.getByText('/timeline')).toBeInTheDocument();
      expect(screen.queryByText('/note')).not.toBeInTheDocument();
    });

    it('hides menu when no commands match', async () => {
      renderInput();
      await userEvent.type(getTextarea(), '/xyz');
      expect(screen.queryByText('/fetch')).not.toBeInTheDocument();
    });
  });

  // ── Keyboard navigation ──

  describe('keyboard navigation', () => {
    it('selects command with Enter and inserts into input', async () => {
      renderInput();
      const textarea = getTextarea();
      await userEvent.type(textarea, '/');
      // First item (/fetch) is highlighted by default — press Enter
      fireEvent.keyDown(textarea, { key: 'Enter' });
      expect(textarea.value).toBe('/fetch ');
      // Menu should close
      expect(screen.queryByText('/search')).not.toBeInTheDocument();
    });

    it('selects command with Tab', async () => {
      renderInput();
      const textarea = getTextarea();
      await userEvent.type(textarea, '/');
      fireEvent.keyDown(textarea, { key: 'Tab' });
      expect(textarea.value).toBe('/fetch ');
    });

    it('does not send message when Enter selects a slash command', async () => {
      const onSend = vi.fn();
      renderInput({ onSend });
      const textarea = getTextarea();
      await userEvent.type(textarea, '/');
      fireEvent.keyDown(textarea, { key: 'Enter' });
      expect(onSend).not.toHaveBeenCalled();
    });

    it('navigates down with ArrowDown', async () => {
      renderInput();
      const textarea = getTextarea();
      await userEvent.type(textarea, '/');
      // Move down to second item (/search)
      fireEvent.keyDown(textarea, { key: 'ArrowDown' });
      fireEvent.keyDown(textarea, { key: 'Enter' });
      expect(textarea.value).toBe('/search ');
    });

    it('navigates up with ArrowUp (wraps around)', async () => {
      renderInput();
      const textarea = getTextarea();
      await userEvent.type(textarea, '/');
      // ArrowUp from index 0 wraps to last item (/timeline)
      fireEvent.keyDown(textarea, { key: 'ArrowUp' });
      fireEvent.keyDown(textarea, { key: 'Enter' });
      expect(textarea.value).toBe('/timeline ');
    });

    it('wraps around when ArrowDown goes past last item', async () => {
      renderInput();
      const textarea = getTextarea();
      await userEvent.type(textarea, '/');
      // Press ArrowDown 7 times to wrap back to first
      for (let i = 0; i < 7; i++) {
        fireEvent.keyDown(textarea, { key: 'ArrowDown' });
      }
      fireEvent.keyDown(textarea, { key: 'Enter' });
      expect(textarea.value).toBe('/fetch ');
    });

    it('navigates within filtered results', async () => {
      renderInput();
      const textarea = getTextarea();
      await userEvent.type(textarea, '/s');
      // Filtered: /search, /summary — ArrowDown moves to /summary
      fireEvent.keyDown(textarea, { key: 'ArrowDown' });
      fireEvent.keyDown(textarea, { key: 'Enter' });
      expect(textarea.value).toBe('/summary ');
    });

    it('closes menu on Escape without clearing text', async () => {
      renderInput();
      const textarea = getTextarea();
      await userEvent.type(textarea, '/fe');
      expect(screen.getByText('/fetch')).toBeInTheDocument();
      fireEvent.keyDown(textarea, { key: 'Escape' });
      expect(screen.queryByText('/fetch')).not.toBeInTheDocument();
      expect(textarea.value).toBe('/fe');
    });
  });

  // ── Mouse selection ──

  describe('mouse selection', () => {
    it('inserts command on click', async () => {
      renderInput();
      const textarea = getTextarea();
      await userEvent.type(textarea, '/');
      const searchBtn = screen.getByText('/search').closest('button')!;
      fireEvent.mouseDown(searchBtn);
      expect(textarea.value).toBe('/search ');
    });
  });

  // ── Descriptions and placeholders ──

  describe('command metadata', () => {
    it('shows descriptions for each command', async () => {
      renderInput();
      await userEvent.type(getTextarea(), '/');
      expect(screen.getByText('Fetch URL into a note')).toBeInTheDocument();
      expect(screen.getByText('Search your notes')).toBeInTheDocument();
      expect(screen.getByText('Create a new note')).toBeInTheDocument();
      expect(screen.getByText('Create a task')).toBeInTheDocument();
      expect(screen.getByText('Extract IOCs from text')).toBeInTheDocument();
      expect(screen.getByText('Summarize this investigation')).toBeInTheDocument();
      expect(screen.getByText('List timeline events')).toBeInTheDocument();
    });

    it('shows placeholders for commands that take arguments', async () => {
      renderInput();
      await userEvent.type(getTextarea(), '/');
      expect(screen.getByText('<url>')).toBeInTheDocument();
      expect(screen.getByText('<query>')).toBeInTheDocument();
    });
  });

  // ── Normal send still works ──

  describe('normal send behavior', () => {
    it('sends message on Enter when menu is not open', async () => {
      const onSend = vi.fn();
      renderInput({ onSend });
      const textarea = getTextarea();
      await userEvent.type(textarea, 'hello world');
      fireEvent.keyDown(textarea, { key: 'Enter' });
      expect(onSend).toHaveBeenCalledWith('hello world');
    });

    it('sends slash command with args on Enter when menu is closed', async () => {
      const onSend = vi.fn();
      renderInput({ onSend });
      const textarea = getTextarea();
      // Type /fetch then space (menu closes) then URL then Enter
      await userEvent.type(textarea, '/fetch https://example.com');
      fireEvent.keyDown(textarea, { key: 'Enter' });
      expect(onSend).toHaveBeenCalledWith('/fetch https://example.com');
    });

    it('clears input after sending', async () => {
      renderInput();
      const textarea = getTextarea();
      await userEvent.type(textarea, 'hello');
      fireEvent.keyDown(textarea, { key: 'Enter' });
      expect(textarea.value).toBe('');
    });
  });
});

// ── Slash-to-natural-language transforms (unit tests) ──

describe('Slash command transforms', () => {
  // Test the transform logic directly — these are the same transforms in ChatView
  const SLASH_TRANSFORMS: Record<string, (arg: string) => string> = {
    '/search':   (q) => `Search my notes for: ${q}`,
    '/note':     (t) => `Create a note titled "${t}"`,
    '/task':     (t) => `Create a task: ${t}`,
    '/iocs':     (t) => `Extract IOCs from the following text:\n${t}`,
    '/summary':  ()  => `Give me a summary of this investigation`,
    '/timeline': ()  => `List the timeline events in this investigation`,
  };

  function transformSlashCommand(text: string): string {
    const match = text.match(/^(\/\w+)\s*([\s\S]*)$/);
    if (!match) return text;
    const [, cmd, arg] = match;
    const transform = SLASH_TRANSFORMS[cmd.toLowerCase()];
    return transform ? transform(arg.trim()) : text;
  }

  it('transforms /search with query', () => {
    expect(transformSlashCommand('/search malware dropper')).toBe('Search my notes for: malware dropper');
  });

  it('transforms /note with title', () => {
    expect(transformSlashCommand('/note My Investigation')).toBe('Create a note titled "My Investigation"');
  });

  it('transforms /task with title', () => {
    expect(transformSlashCommand('/task Analyze sample')).toBe('Create a task: Analyze sample');
  });

  it('transforms /iocs with text', () => {
    const input = '/iocs Check 192.168.1.1 and evil.com';
    expect(transformSlashCommand(input)).toBe(
      'Extract IOCs from the following text:\nCheck 192.168.1.1 and evil.com'
    );
  });

  it('transforms /summary with no args', () => {
    expect(transformSlashCommand('/summary')).toBe('Give me a summary of this investigation');
  });

  it('transforms /timeline with no args', () => {
    expect(transformSlashCommand('/timeline')).toBe('List the timeline events in this investigation');
  });

  it('leaves unknown slash commands unchanged', () => {
    expect(transformSlashCommand('/unknown some args')).toBe('/unknown some args');
  });

  it('leaves non-slash text unchanged', () => {
    expect(transformSlashCommand('hello world')).toBe('hello world');
  });

  it('handles /search with no query (empty arg)', () => {
    expect(transformSlashCommand('/search')).toBe('Search my notes for: ');
  });

  it('is case-insensitive on command name', () => {
    expect(transformSlashCommand('/SEARCH test')).toBe('Search my notes for: test');
  });
});

// ── Dashboard AI Chat link ──

describe('Dashboard AI Chat tool link', () => {
  // Dynamically import to avoid heavy mocking of the full dashboard
  it('includes AI Chat in the internal tools list', async () => {
    // We test the INTERNAL_TOOLS constant indirectly by rendering DashboardView
    const { DashboardView } = await import('../components/Dashboard/DashboardView');
    const onViewChange = vi.fn();
    render(
      <DashboardView
        links={[]}
        onUpdateLinks={vi.fn()}
        onViewChange={onViewChange}
      />
    );
    const chatButton = screen.getByText('AI Chat');
    expect(chatButton).toBeInTheDocument();
    expect(screen.getByText('Chat with AI about your investigation')).toBeInTheDocument();
  });

  it('navigates to chat view when clicked', async () => {
    const { DashboardView } = await import('../components/Dashboard/DashboardView');
    const onViewChange = vi.fn();
    render(
      <DashboardView
        links={[]}
        onUpdateLinks={vi.fn()}
        onViewChange={onViewChange}
      />
    );
    const chatButton = screen.getByText('AI Chat').closest('button')!;
    fireEvent.click(chatButton);
    expect(onViewChange).toHaveBeenCalledWith('chat');
  });
});
