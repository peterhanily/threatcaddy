import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsPanel } from '../components/Settings/SettingsPanel';
import { DEFAULT_SETTINGS } from '../types';
import type { Settings } from '../types';

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

const defaultProps = {
  settings: { ...DEFAULT_SETTINGS } as Settings,
  onUpdateSettings: vi.fn(),
  notes: [],
  onImportComplete: vi.fn(),
};

describe('SettingsPanel', () => {
  it('renders Settings heading', () => {
    render(<SettingsPanel {...defaultProps} />);
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('renders Preferences section', () => {
    render(<SettingsPanel {...defaultProps} />);
    expect(screen.getByText('Preferences')).toBeInTheDocument();
  });

  it('renders Anthropic API Key input', () => {
    render(<SettingsPanel {...defaultProps} />);
    expect(screen.getByText('Anthropic API Key')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('sk-ant-...')).toBeInTheDocument();
  });

  it('renders OpenAI API Key input', () => {
    render(<SettingsPanel {...defaultProps} />);
    expect(screen.getByText('OpenAI API Key')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('sk-...')).toBeInTheDocument();
  });

  it('renders Google Gemini API Key input', () => {
    render(<SettingsPanel {...defaultProps} />);
    expect(screen.getByText('Google Gemini API Key')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('AIza...')).toBeInTheDocument();
  });

  it('renders Mistral API Key input', () => {
    render(<SettingsPanel {...defaultProps} />);
    expect(screen.getByText('Mistral API Key')).toBeInTheDocument();
  });

  it('fires onChange for Anthropic API key', () => {
    const onUpdateSettings = vi.fn();
    render(<SettingsPanel {...defaultProps} onUpdateSettings={onUpdateSettings} />);
    const input = screen.getByPlaceholderText('sk-ant-...');
    fireEvent.change(input, { target: { value: 'sk-ant-test123' } });
    expect(onUpdateSettings).toHaveBeenCalledWith({ llmAnthropicApiKey: 'sk-ant-test123' });
  });

  it('fires onChange for OpenAI API key', () => {
    const onUpdateSettings = vi.fn();
    render(<SettingsPanel {...defaultProps} onUpdateSettings={onUpdateSettings} />);
    const input = screen.getByPlaceholderText('sk-...');
    fireEvent.change(input, { target: { value: 'sk-openai-test' } });
    expect(onUpdateSettings).toHaveBeenCalledWith({ llmOpenAIApiKey: 'sk-openai-test' });
  });

  it('renders Local LLM section', () => {
    render(<SettingsPanel {...defaultProps} />);
    expect(screen.getByText('Local LLM (Ollama / LM Studio / vLLM)')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('http://localhost:11434/v1')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('llama3, mistral-nemo, etc.')).toBeInTheDocument();
  });

  it('renders Default Model selector with optgroups', () => {
    render(<SettingsPanel {...defaultProps} />);
    expect(screen.getByText('Default Model')).toBeInTheDocument();
    const selects = screen.getAllByRole('combobox');
    // Find the default model selector (last one in the AI section)
    const modelSelect = selects[selects.length - 1];
    expect(modelSelect).toBeInTheDocument();
  });

  it('shows "API key saved" when Anthropic key is set', () => {
    const settings = { ...DEFAULT_SETTINGS, llmAnthropicApiKey: 'sk-test' } as Settings;
    render(<SettingsPanel {...defaultProps} settings={settings} />);
    expect(screen.getByText('API key saved')).toBeInTheDocument();
  });

  it('shows "API key saved" when Gemini key is set', () => {
    const settings = { ...DEFAULT_SETTINGS, llmGeminiApiKey: 'AIza-test' } as Settings;
    render(<SettingsPanel {...defaultProps} settings={settings} />);
    expect(screen.getByText('API key saved')).toBeInTheDocument();
  });

  it('hides "API key saved" when no keys are set', () => {
    render(<SettingsPanel {...defaultProps} />);
    expect(screen.queryByText('API key saved')).not.toBeInTheDocument();
  });

  it('renders child settings components', () => {
    render(<SettingsPanel {...defaultProps} />);
    expect(screen.getByTestId('export-import')).toBeInTheDocument();
    expect(screen.getByTestId('threat-intel-config')).toBeInTheDocument();
    expect(screen.getByTestId('cloud-backup')).toBeInTheDocument();
    expect(screen.getByTestId('keyboard-shortcuts')).toBeInTheDocument();
    expect(screen.getByTestId('encryption-settings')).toBeInTheDocument();
  });
});
