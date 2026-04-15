/**
 * Model pricing lookup for agent cost telemetry.
 *
 * Prices are per 1M tokens and are best-effort approximations — used only
 * for relative cost comparison in the agent dashboard, not for billing.
 * Unknown models resolve to zero so cost never blocks cycles.
 */

export interface ModelPrice {
  /** USD per 1M input tokens. */
  inputPerM: number;
  /** USD per 1M output tokens. */
  outputPerM: number;
}

const PRICES: Record<string, ModelPrice> = {
  // Anthropic
  'claude-opus-4-6':          { inputPerM: 15,   outputPerM: 75 },
  'claude-sonnet-4-6':        { inputPerM: 3,    outputPerM: 15 },
  'claude-haiku-4-5-20251001':{ inputPerM: 1,    outputPerM: 5  },
  'claude-3-5-haiku-latest':  { inputPerM: 0.8,  outputPerM: 4  },

  // OpenAI
  'gpt-5.4':       { inputPerM: 10, outputPerM: 30 },
  'gpt-5.4-pro':   { inputPerM: 20, outputPerM: 60 },
  'gpt-5.2':       { inputPerM: 5,  outputPerM: 15 },
  'gpt-5-mini':    { inputPerM: 0.5, outputPerM: 2 },
  'o3':            { inputPerM: 10, outputPerM: 40 },
  'o4-mini':       { inputPerM: 1.1, outputPerM: 4.4 },
  'gpt-4.1':       { inputPerM: 2,  outputPerM: 8  },
  'gpt-4.1-mini':  { inputPerM: 0.4, outputPerM: 1.6 },
  'gpt-4o':        { inputPerM: 2.5, outputPerM: 10 },

  // Google
  'gemini-2.5-pro-preview-06-05':   { inputPerM: 1.25, outputPerM: 10 },
  'gemini-2.5-flash-preview-05-20': { inputPerM: 0.3,  outputPerM: 2.5 },

  // Mistral
  'mistral-large-latest': { inputPerM: 2,   outputPerM: 6 },
  'mistral-small-latest': { inputPerM: 0.2, outputPerM: 0.6 },
  'codestral-latest':     { inputPerM: 0.3, outputPerM: 0.9 },
};

/** Compute cost in USD for a given model and token counts. Unknown models return 0. */
export function calculateCost(model: string | undefined, inputTokens: number, outputTokens: number): number {
  if (!model) return 0;
  const price = PRICES[model];
  if (!price) return 0;
  return (inputTokens / 1_000_000) * price.inputPerM + (outputTokens / 1_000_000) * price.outputPerM;
}

/** Format a USD cost with sensible precision for the UI. */
export function formatUSD(cost: number): string {
  if (cost === 0) return '$0';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}
