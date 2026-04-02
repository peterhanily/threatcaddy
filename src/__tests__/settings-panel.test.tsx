import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsPanel } from '../components/Settings/SettingsPanel';
import { DEFAULT_SETTINGS } from '../types';
import type { Settings } from '../types';

// Mock contexts
vi.mock('../contexts/ToastContext', () => ({
  useToast: () => ({ addToast: vi.fn(), toasts: [], removeToast: vi.fn() }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ connected: false, user: null, serverUrl: null }),
}));

// Mock child components that have complex dependencies
vi.mock('../components/Settings/ExportImport', () => ({
  ExportImport: () => <div data-testid="export-import">ExportImport</div>,
}));
vi.mock('../components/Settings/ThreatIntelConfig', () => ({
  ThreatIntelConfig: () => <div data-testid="threat-intel-config">ThreatIntelConfig</div>,
}));
vi.mock('../components/Settings/CloudBackup', () => ({
  CloudBackup: () => <div data-testid="cloud-backup">CloudBackup</div>,
}));
vi.mock('../components/Settings/KeyboardShortcuts', () => ({
  KeyboardShortcuts: () => <div data-testid="keyboard-shortcuts">KeyboardShortcuts</div>,
}));
vi.mock('../components/Encryption/EncryptionSettings', () => ({
  EncryptionSettings: () => <div data-testid="encryption-settings">EncryptionSettings</div>,
}));
vi.mock('../components/Integrations/IntegrationPanel', () => ({
  IntegrationPanel: () => <div data-testid="integration-panel">IntegrationPanel</div>,
}));
vi.mock('../components/Settings/ServerBackup', () => ({
  ServerBackup: () => <div data-testid="server-backup">ServerBackup</div>,
}));

const defaultProps = {
  settings: { ...DEFAULT_SETTINGS } as Settings,
  onUpdateSettings: vi.fn(),
  notes: [],
  onImportComplete: vi.fn(),
};

function clickTab(label: string) {
  fireEvent.click(screen.getByRole('tab', { name: label }));
}

describe('SettingsPanel', () => {
  it('renders Settings heading', () => {
    render(<SettingsPanel {...defaultProps} />);
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('renders Display Preferences section on General tab', () => {
    render(<SettingsPanel {...defaultProps} />);
    expect(screen.getByText('Display Preferences')).toBeInTheDocument();
  });

  it('renders Anthropic API Key input on AI tab', () => {
    render(<SettingsPanel {...defaultProps} />);
    clickTab('AI');
    expect(screen.getByText('Anthropic API Key')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('sk-ant-...')).toBeInTheDocument();
  });

  it('renders OpenAI API Key input on AI tab', () => {
    render(<SettingsPanel {...defaultProps} />);
    clickTab('AI');
    expect(screen.getByText('OpenAI API Key')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('sk-...')).toBeInTheDocument();
  });

  it('renders Google Gemini API Key input on AI tab', () => {
    render(<SettingsPanel {...defaultProps} />);
    clickTab('AI');
    expect(screen.getByText('Google Gemini API Key')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('AIza...')).toBeInTheDocument();
  });

  it('renders Mistral API Key input on AI tab', () => {
    render(<SettingsPanel {...defaultProps} />);
    clickTab('AI');
    expect(screen.getByText('Mistral API Key')).toBeInTheDocument();
  });

  it('fires onChange for Anthropic API key', () => {
    const onUpdateSettings = vi.fn();
    render(<SettingsPanel {...defaultProps} onUpdateSettings={onUpdateSettings} />);
    clickTab('AI');
    const input = screen.getByPlaceholderText('sk-ant-...');
    fireEvent.change(input, { target: { value: 'sk-ant-test123' } });
    expect(onUpdateSettings).toHaveBeenCalledWith({ llmAnthropicApiKey: 'sk-ant-test123' });
  });

  it('fires onChange for OpenAI API key', () => {
    const onUpdateSettings = vi.fn();
    render(<SettingsPanel {...defaultProps} onUpdateSettings={onUpdateSettings} />);
    clickTab('AI');
    const input = screen.getByPlaceholderText('sk-...');
    fireEvent.change(input, { target: { value: 'sk-openai-test' } });
    expect(onUpdateSettings).toHaveBeenCalledWith({ llmOpenAIApiKey: 'sk-openai-test' });
  });

  it('renders Local LLM section on AI tab', () => {
    render(<SettingsPanel {...defaultProps} />);
    clickTab('AI');
    expect(screen.getByText('Local LLM (Ollama / LM Studio / vLLM)')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('http://localhost:11434/v1')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('llama3.1, qwen2.5, mistral-nemo, etc.')).toBeInTheDocument();
  });

  it('renders Default Model selector on AI tab', () => {
    render(<SettingsPanel {...defaultProps} />);
    clickTab('AI');
    expect(screen.getByText('Default Model')).toBeInTheDocument();
  });

  it('shows "API key saved" when Anthropic key is set', () => {
    const settings = { ...DEFAULT_SETTINGS, llmAnthropicApiKey: 'sk-test' } as Settings;
    render(<SettingsPanel {...defaultProps} settings={settings} />);
    clickTab('AI');
    expect(screen.getByText('API key saved')).toBeInTheDocument();
  });

  it('shows "API key saved" when Gemini key is set', () => {
    const settings = { ...DEFAULT_SETTINGS, llmGeminiApiKey: 'AIza-test' } as Settings;
    render(<SettingsPanel {...defaultProps} settings={settings} />);
    clickTab('AI');
    expect(screen.getByText('API key saved')).toBeInTheDocument();
  });

  it('hides "API key saved" when no keys are set on AI tab', () => {
    render(<SettingsPanel {...defaultProps} />);
    clickTab('AI');
    expect(screen.queryByText('API key saved')).not.toBeInTheDocument();
  });

  it('renders Data tab components', () => {
    render(<SettingsPanel {...defaultProps} />);
    clickTab('Data');
    expect(screen.getByTestId('export-import')).toBeInTheDocument();
    expect(screen.getByTestId('encryption-settings')).toBeInTheDocument();
    expect(screen.getByTestId('cloud-backup')).toBeInTheDocument();
  });

  it('renders Threat Intel tab components', () => {
    render(<SettingsPanel {...defaultProps} />);
    clickTab('Intel');
    expect(screen.getByTestId('threat-intel-config')).toBeInTheDocument();
  });

  it('renders Integrations tab components', () => {
    render(<SettingsPanel {...defaultProps} />);
    clickTab('Integrations');
    expect(screen.getByTestId('integration-panel')).toBeInTheDocument();
  });

  it('renders Shortcuts tab components', () => {
    render(<SettingsPanel {...defaultProps} />);
    clickTab('Shortcuts');
    expect(screen.getByTestId('keyboard-shortcuts')).toBeInTheDocument();
  });
});
