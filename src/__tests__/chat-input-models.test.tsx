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
    const sendButton = screen.getByTitle('Send message (Enter)');
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

  it('allows the authenticated server route without local credentials and preserves a custom server model', () => {
    const onModelChange = vi.fn(); const onSend = vi.fn();
    render(<ChatInput {...defaultProps} extensionAvailable={false} serverRoute provider="openai"
      configuredProviders={new Set()} model="synthetic-server-model" onModelChange={onModelChange} onSend={onSend} />);
    expect(screen.getByRole('combobox', { name: 'AI model' })).toHaveValue('synthetic-server-model');
    expect(screen.getByText('Team server route')).toBeInTheDocument();
    expect(screen.queryByText('No connection')).not.toBeInTheDocument();
    const input = screen.getByRole('textbox'); expect(input).toBeEnabled();
    fireEvent.change(input, { target: { value: 'Synthetic server question' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('Synthetic server question', expect.any(Function));
    expect(onModelChange).not.toHaveBeenCalled();
  });

  it('retains the draft but disables submission when the server route is lost', () => {
    const onSend = vi.fn(); const props = { ...defaultProps, extensionAvailable: false, onSend };
    const view = render(<ChatInput {...props} serverRoute />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Retained question' } });
    view.rerender(<ChatInput {...props} serverRoute={false} />);
    expect(input).toBeDisabled(); expect(input).toHaveValue('Retained question');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('does not treat a configured local model as a route for a selected remote provider', () => {
    const props = { ...defaultProps, extensionAvailable: false, localModelName: 'synthetic-local' };
    const view = render(<ChatInput {...props} provider="anthropic" />);
    expect(screen.getByRole('textbox')).toBeDisabled();
    view.rerender(<ChatInput {...props} provider="local" model="synthetic-local" />);
    expect(screen.getByRole('textbox')).toBeEnabled();
    expect(screen.getByText('Local LLM')).toBeInTheDocument();
  });

  it('does not silently switch an existing server thread to another configured provider after sign-out', () => {
    const onModelChange = vi.fn();
    const props = { ...defaultProps, onModelChange, extensionAvailable: false, provider: 'anthropic' as const,
      model: 'fictional-server-custom-model', configuredProviders: new Set(['local']), localModelName: 'fictional-local-model' };
    const view = render(<ChatInput {...props} serverRoute />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep this provider and draft' } });
    view.rerender(<ChatInput {...props} serverRoute={false} />);
    expect(onModelChange).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox')).toHaveValue('fictional-server-custom-model');
    expect(screen.getByRole('textbox')).toHaveValue('Keep this provider and draft');
    expect(screen.getByRole('textbox')).toBeDisabled();
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
    expect(onSend).toHaveBeenCalledWith('Hello world', expect.any(Function));
  });
});
