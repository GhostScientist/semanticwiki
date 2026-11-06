import { describe, it, expect } from 'vitest';
import { resolveProviderOptions, requireProviderCredential } from '../src/cli-options.js';

describe('provider selection', () => {
  it('uses a deterministic direct API default without prompting or falling back', () => {
    expect(resolveProviderOptions({}, {})).toMatchObject({ provider: 'anthropic', directApi: true, fullLocal: false });
    expect(resolveProviderOptions({ provider: 'openai' }, {})).toMatchObject({ provider: 'openai', directApi: true });
    expect(() => requireProviderCredential('openai', { apiKey: 'anthropic-only' })).toThrow('OPENAI_API_KEY');
  });
  it('retains compatibility aliases and respects explicit choice over environment', () => {
    expect(resolveProviderOptions({ fullLocal: true }, { SEMANTICWIKI_PROVIDER: 'openai' }).provider).toBe('local');
    expect(resolveProviderOptions({ fullLocal: true, useOllama: true }, {}).provider).toBe('ollama');
    expect(resolveProviderOptions({ directApi: true }, {}).provider).toBe('anthropic');
    expect(resolveProviderOptions({ provider: 'claude-code' }, {}).directApi).toBe(false);
  });
  it('rejects unknown, contradictory and accidentally cloud-backed local settings', () => {
    expect(() => resolveProviderOptions({ provider: 'invalid' }, {})).toThrow('Unknown provider');
    expect(() => resolveProviderOptions({ provider: 'openai', fullLocal: true }, {})).toThrow('conflicts');
    expect(() => resolveProviderOptions({ directApi: true, useOllama: true }, {})).toThrow('cannot');
    expect(() => resolveProviderOptions({ provider: 'local', contextual: true }, {})).toThrow('incompatible');
    expect(resolveProviderOptions({ provider: 'local', contextual: true, contextualLocal: true }, {}).fullLocal).toBe(true);
  });
  it('requires only the selected provider credential', () => {
    for (const provider of ['local', 'ollama', 'claude-code'] as const) expect(() => requireProviderCredential(provider, {})).not.toThrow();
    expect(() => requireProviderCredential('anthropic', { openaiApiKey: 'other' })).toThrow('ANTHROPIC_API_KEY');
    expect(() => requireProviderCredential('openai', { openaiApiKey: ' ' })).toThrow('OPENAI_API_KEY');
    expect(() => requireProviderCredential('openai', { openaiApiKey: 'test' })).not.toThrow();
  });
});
