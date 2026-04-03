import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatInput } from '../components/Chat/ChatInput';

const defaultProps = {
  onSend: vi.fn(),
  onStop: vi.fn(),
  isStreaming: false,
  extensionAvailable: true,
  model: 'claude-sonnet-4-6',
  onModelChange: vi.fn(),
};

describe('ChatInput', () => {
  it('renders the model selector', () => {
    render(<ChatInput {...defaultProps} />);
    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
  });

  it('uses optgroup grouping for models', () => {
    const { container } = render(<ChatInput {...defaultProps} />);
    const groups = container.querySelectorAll('optgroup');
    expect(groups.length).toBeGreaterThanOrEqual(4); // Anthropic, OpenAI, Google, Mistral
  });

  it('has all 10 static models', () => {
    const { container } = render(<ChatInput {...defaultProps} />);
    const options = container.querySelectorAll('option');
    expect(options.length).toBeGreaterThanOrEqual(10);
  });

  it('calls onModelChange with anthropic provider for Claude models', () => {
    const onModelChange = vi.fn();
    render(<ChatInput {...defaultProps} onModelChange={onModelChange} />);
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'claude-opus-4-6' } });
    expect(onModelChange).toHaveBeenCalledWith('claude-opus-4-6', 'anthropic');
  });

  it('calls onModelChange with openai provider for GPT models', () => {
    const onModelChange = vi.fn();
    render(<ChatInput {...defaultProps} onModelChange={onModelChange} />);
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'gpt-4o' } });
    expect(onModelChange).toHaveBeenCalledWith('gpt-4o', 'openai');
  });

  it('calls onModelChange with gemini provider for Gemini models', () => {
    const onModelChange = vi.fn();
    render(<ChatInput {...defaultProps} onModelChange={onModelChange} />);
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'gemini-2.5-pro-preview-06-05' } });
    expect(onModelChange).toHaveBeenCalledWith('gemini-2.5-pro-preview-06-05', 'gemini');
  });

  it('calls onModelChange with mistral provider for Mistral models', () => {
    const onModelChange = vi.fn();
    render(<ChatInput {...defaultProps} onModelChange={onModelChange} />);
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'mistral-large-latest' } });
    expect(onModelChange).toHaveBeenCalledWith('mistral-large-latest', 'mistral');
  });

  it('shows local model when localModelName is set', () => {
    render(<ChatInput {...defaultProps} localModelName="llama3" />);
    const options = screen.getAllByRole('option');
    const localOption = options.find(o => o.textContent?.includes('Local: llama3'));
    expect(localOption).toBeDefined();
  });

  it('hides local model when localModelName is not set', () => {
    render(<ChatInput {...defaultProps} />);
    const options = screen.getAllByRole('option');
    const localOption = options.find(o => o.textContent?.includes('Local:'));
    expect(localOption).toBeUndefined();
  });

  it('shows Stop button when streaming', () => {
    render(<ChatInput {...defaultProps} isStreaming={true} />);
    const stopButton = screen.getByTitle('Stop generating');
    expect(stopButton).toBeInTheDocument();
  });

  it('shows Send button when not streaming', () => {
    render(<ChatInput {...defaultProps} isStreaming={false} />);
    const sendButton = screen.getByTitle('Send message');
    expect(sendButton).toBeInTheDocument();
  });

  it('disables textarea when extension is unavailable', () => {
    render(<ChatInput {...defaultProps} extensionAvailable={false} />);
    const textarea = screen.getByRole('textbox');
    expect(textarea).toBeDisabled();
  });

  it('disables textarea when disabled prop is true', () => {
    render(<ChatInput {...defaultProps} disabled={true} />);
    const textarea = screen.getByRole('textbox');
    expect(textarea).toBeDisabled();
  });

  it('shows extension connected indicator', () => {
    render(<ChatInput {...defaultProps} extensionAvailable={true} />);
    expect(screen.getByText('Extension')).toBeInTheDocument();
  });

  it('shows no extension indicator', () => {
    render(<ChatInput {...defaultProps} extensionAvailable={false} />);
    expect(screen.getByText('No connection')).toBeInTheDocument();
  });

  it('calls onSend with trimmed text on Enter', () => {
    const onSend = vi.fn();
    render(<ChatInput {...defaultProps} onSend={onSend} />);
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '  Hello world  ' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(onSend).toHaveBeenCalledWith('Hello world');
  });
});
