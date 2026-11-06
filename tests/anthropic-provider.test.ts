import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create }; } }));
import { AnthropicProvider } from '../src/llm/anthropic-provider.js';
import { assistantMessageFromResponse } from '../src/llm/index.js';

beforeEach(() => { create.mockReset(); create.mockResolvedValue({ content: [], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 2 } }); });
afterEach(() => vi.unstubAllEnvs());

describe('Anthropic Messages provider', () => {
  it('uses current Sonnet without unsupported sampling parameters', async () => {
    const provider = new AnthropicProvider({ apiKey: 'test-key' });
    await provider.initialize();
    await provider.chat([{ role: 'system', content: 'Global instructions' }, { role: 'user', content: 'Document' }], [], { maxTokens: 500, temperature: 0.1, systemPrompt: 'Use citations' });
    const request = create.mock.calls[0][0];
    expect(request.model).toBe('claude-sonnet-5-5');
    expect(request.temperature).toBeUndefined();
    expect(request.thinking).toEqual({ type: 'adaptive' });
    expect(request.system[0].text).toBe('Use citations\n\nGlobal instructions');
  });

  it('preserves thinking, redacted thinking, tool failures, and parallel results', async () => {
    const thinking = [{ type: 'thinking', thinking: '', signature: 'opaque' }, { type: 'redacted_thinking', data: 'opaque-redacted' }];
    create.mockResolvedValueOnce({ content: [...thinking, { type: 'tool_use', id: 'a', name: 'read', input: { path: 'a.ts' } }, { type: 'tool_use', id: 'b', name: 'read', input: { path: 'b.ts' } }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 10, cache_creation_input_tokens: 20 } });
    const provider = new AnthropicProvider({ apiKey: 'test-key' });
    await provider.initialize();
    const response = await provider.chat([{ role: 'user', content: 'Read' }], [], { maxTokens: 500 });
    expect(response.usage.inputTokens).toBe(31);
    const assistant = assistantMessageFromResponse(response);
    await provider.chat([
      { role: 'user', content: 'Read' }, assistant,
      { role: 'tool', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'Permission denied', is_error: true }] },
      { role: 'tool', toolCallId: 'b', content: 'file b' },
    ], [], { maxTokens: 500 });
    expect(create.mock.calls[1][0].messages[1].content.slice(0, 2)).toEqual(thinking);
    expect(create.mock.calls[1][0].messages[2].content).toEqual([
      { type: 'tool_result', tool_use_id: 'a', content: 'Permission denied', is_error: true },
      { type: 'tool_result', tool_use_id: 'b', content: 'file b' },
    ]);
  });

  it('does not enable adaptive thinking for an older explicitly selected model', async () => {
    const provider = new AnthropicProvider({ apiKey: 'test-key', model: 'claude-haiku-4-5' });
    await provider.initialize();
    await provider.chat([{ role: 'user', content: 'Read' }], [], { maxTokens: 500, temperature: 0.2 });
    expect(create.mock.calls[0][0].thinking).toBeUndefined();
    expect(create.mock.calls[0][0].temperature).toBe(0.2);
  });

  it('fails explicitly when the context window truncates the response', async () => {
    create.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Partially completed wiki' }],
      stop_reason: 'model_context_window_exceeded',
      usage: { input_tokens: 999_990, output_tokens: 10 },
    });
    const provider = new AnthropicProvider({ apiKey: 'test-key' });
    await provider.initialize();
    await expect(provider.chat([{ role: 'user', content: 'Finish the wiki' }], [], { maxTokens: 500 }))
      .rejects.toThrow('context limit before completing the response. Reduce conversation history or resume with semanticwiki continue');
  });
});
