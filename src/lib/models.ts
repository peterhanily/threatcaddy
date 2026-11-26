import type { LLMProvider } from '../types';

export interface ModelEntry {
  label: string;
  value: string;
  provider: LLMProvider;
  group: string;
}

export const MODELS: ModelEntry[] = [
  { label: 'Claude Fable 5.2', value: 'claude-fable-5-2', provider: 'anthropic', group: 'Anthropic' },
  { label: 'Claude Opus 5.5', value: 'claude-opus-5-5', provider: 'anthropic', group: 'Anthropic' },
  { label: 'Claude Sonnet 5.5', value: 'claude-sonnet-5-5', provider: 'anthropic', group: 'Anthropic' },
  { label: 'Claude Haiku 5.5', value: 'claude-haiku-5-5', provider: 'anthropic', group: 'Anthropic' },
  { label: 'Claude Opus 4.6', value: 'claude-opus-4-6', provider: 'anthropic', group: 'Anthropic' },
  { label: 'Claude Sonnet 4.6', value: 'claude-sonnet-4-6', provider: 'anthropic', group: 'Anthropic' },
  { label: 'Claude Haiku 4.5', value: 'claude-haiku-4-5', provider: 'anthropic', group: 'Anthropic' },
  { label: 'Claude Haiku 3.5', value: 'claude-3-5-haiku-latest', provider: 'anthropic', group: 'Anthropic' },
  { label: 'GPT-5.4', value: 'gpt-5.4', provider: 'openai', group: 'OpenAI' },
  { label: 'GPT-5.4 Pro', value: 'gpt-5.4-pro', provider: 'openai', group: 'OpenAI' },
  { label: 'GPT-5.2', value: 'gpt-5.2', provider: 'openai', group: 'OpenAI' },
  { label: 'GPT-5 Mini', value: 'gpt-5-mini', provider: 'openai', group: 'OpenAI' },
  { label: 'o3', value: 'o3', provider: 'openai', group: 'OpenAI' },
  { label: 'o4-mini', value: 'o4-mini', provider: 'openai', group: 'OpenAI' },
  { label: 'GPT-4.1', value: 'gpt-4.1', provider: 'openai', group: 'OpenAI' },
  { label: 'GPT-4.1 Mini', value: 'gpt-4.1-mini', provider: 'openai', group: 'OpenAI' },
  { label: 'GPT-4o', value: 'gpt-4o', provider: 'openai', group: 'OpenAI' },
  { label: 'Gemini 2.5 Pro', value: 'gemini-2.5-pro-preview-06-05', provider: 'gemini', group: 'Google' },
  { label: 'Gemini 2.5 Flash', value: 'gemini-2.5-flash-preview-05-20', provider: 'gemini', group: 'Google' },
  { label: 'Mistral Large', value: 'mistral-large-latest', provider: 'mistral', group: 'Mistral' },
  { label: 'Mistral Small', value: 'mistral-small-latest', provider: 'mistral', group: 'Mistral' },
  { label: 'Codestral', value: 'codestral-latest', provider: 'mistral', group: 'Mistral' },
];

/** Map model ID → provider for quick lookup (e.g. settings onChange) */
export const MODEL_PROVIDER_MAP: Record<string, LLMProvider> = Object.fromEntries(
  MODELS.map((m) => [m.value, m.provider]),
) as Record<string, LLMProvider>;

/** The model used when none is chosen. One place, so a change of default is one line.
 * It stays on Claude Sonnet 4.6 until the extension asks for a larger answer: the Claude 5 models
 * always think, thinking counts against the extension's fixed 8,192-token answer limit, and a
 * limit that small can cut an answer short. They are offered in the list for people who choose them. */
export const DEFAULT_MODEL = 'claude-sonnet-4-6';

/** Default model per provider (used when auto-switching) */
export const DEFAULT_MODEL_PER_PROVIDER: Record<string, string> = {
  anthropic: DEFAULT_MODEL,
  openai: 'gpt-4.1',
  gemini: 'gemini-2.5-flash-preview-05-20',
  mistral: 'mistral-large-latest',
};
