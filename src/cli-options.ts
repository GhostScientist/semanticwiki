import { DEFAULT_ANTHROPIC_MODEL, DEFAULT_OPENAI_MODEL } from './llm/defaults.js';

export type WikiProvider = 'anthropic' | 'openai' | 'local' | 'ollama' | 'claude-code';

export interface ProviderOptions {
  provider?: string;
  model?: string;
  fullLocal?: boolean;
  directApi?: boolean;
  useOllama?: boolean;
  contextual?: boolean;
  contextualLocal?: boolean;
}

/** Resolve aliases once, before credentials, indexing or downloads. Never fall back. */
export function resolveProviderOptions(options: ProviderOptions, env = process.env) {
  const alias = options.useOllama ? 'ollama' : options.fullLocal ? 'local' : options.directApi ? 'anthropic' : undefined;
  if (options.directApi && (options.fullLocal || options.useOllama)) {
    throw new Error('--direct-api cannot be combined with local provider flags.');
  }
  if (options.provider && alias && options.provider !== alias) {
    throw new Error(`--provider ${options.provider} conflicts with the ${alias} compatibility flag.`);
  }
  const provider = options.provider || alias || env.SEMANTICWIKI_PROVIDER || 'anthropic';
  if (!['anthropic', 'openai', 'local', 'ollama', 'claude-code'].includes(provider)) {
    throw new Error(`Unknown provider "${provider}". Choose anthropic, openai, local, ollama, or claude-code.`);
  }
  const fullLocal = provider === 'local' || provider === 'ollama';
  if (fullLocal && options.contextual && !options.contextualLocal) {
    throw new Error('Cloud contextual retrieval is incompatible with a local provider. Use --contextual-local.');
  }
  return {
    provider: provider as WikiProvider,
    model: options.model || env.SEMANTICWIKI_MODEL || (provider === 'openai' ? DEFAULT_OPENAI_MODEL : fullLocal ? undefined : DEFAULT_ANTHROPIC_MODEL),
    fullLocal,
    useOllama: provider === 'ollama',
    directApi: provider === 'anthropic' || provider === 'openai',
  };
}

export function requireProviderCredential(provider: WikiProvider, config: { apiKey?: string; openaiApiKey?: string }): void {
  const variable = provider === 'openai' ? 'OPENAI_API_KEY' : provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : undefined;
  const key = provider === 'openai' ? config.openaiApiKey : config.apiKey;
  if (variable && !key?.trim()) {
    throw new Error(`${provider} requires ${variable}. Set your own key in the environment or .env, or choose --provider local. Run semanticwiki doctor for setup details.`);
  }
}
