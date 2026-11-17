/**
 * C4-5: in a right-to-left language, command and token syntax keeps its left-to-right order.
 * Without it, '@note:' shows as ':note@' and a sent '/fetch https://…' shows its slash after the URL.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChatInput } from '../components/Chat/ChatInput';
import { ChatMessageBubble } from '../components/Chat/ChatMessage';
import { MENTION_CATEGORIES } from '../lib/chat-mentions';

const renderInput = () => render(<ChatInput onSend={vi.fn()} onStop={vi.fn()} isStreaming={false} extensionAvailable model="claude-sonnet-4-6"
  onModelChange={vi.fn()} />);

describe('the composer', () => {
  it('shows the @-mention prefixes left to right', async () => {
    renderInput();
    await userEvent.type(screen.getByRole('textbox'), '@');
    for (const { prefix } of MENTION_CATEGORIES) expect(screen.getByText(prefix)).toHaveAttribute('dir', 'ltr');
  });

  it('shows slash commands and their arguments left to right', async () => {
    renderInput();
    await userEvent.type(screen.getByRole('textbox'), '/');
    expect(screen.getByText('/fetch')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText('<url>')).toHaveAttribute('dir', 'ltr');
  });

  // Browsers lay out an empty dir="auto" field left to right, which would scramble a right-to-left placeholder.
  it('lays out what is typed by its own direction, and an empty composer by the page\'s', async () => {
    renderInput();
    const composer = screen.getByRole('textbox');
    expect(composer).not.toHaveAttribute('dir');
    await userEvent.type(composer, '/fetch https://example.com');
    expect(composer).toHaveAttribute('dir', 'auto');
  });
});

describe('a sent message', () => {
  it('lays out the analyst\'s text by its own direction', () => {
    const text = '/fetch https://nvd.nist.gov/vuln/detail/CVE-2024-3094';
    render(<ChatMessageBubble role="user" content={text} />);
    expect(screen.getByText(text)).toHaveAttribute('dir', 'auto');
  });

  // jsdom applies no stylesheet; the browser probe checks that '/stoploop' renders in this order in Arabic.
  it('isolates code in an assistant message left to right, so \'/stoploop\' keeps its slash in front', () => {
    const { container } = render(<ChatMessageBubble role="assistant" content="Use `/stoploop` to stop." />);
    expect(container.querySelector('code')?.textContent).toBe('/stoploop');
    expect(container.querySelector('.markdown-preview')?.className).toMatch(/\[&_code\]:\[direction:ltr\].*\[&_code\]:\[unicode-bidi:isolate\]/);
  });

  it('shows a tool call\'s name and JSON left to right', () => {
    render(<ChatMessageBubble role="assistant" content="Done" toolCalls={[{ id: 'tc', name: 'search_notes', input: { query: 'x' },
      result: JSON.stringify({ count: 1 }), isError: false }]} />);
    const name = screen.getByText('search_notes');
    expect(name).toHaveAttribute('dir', 'ltr');
    fireEvent.click(screen.getByRole('button', { name: /search_notes/ }));
    const blocks = document.querySelectorAll('pre');
    expect(blocks).toHaveLength(2);
    for (const block of blocks) expect(block).toHaveAttribute('dir', 'ltr');
  });
});
