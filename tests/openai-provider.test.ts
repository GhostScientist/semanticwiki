import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIProvider } from '../src/llm/openai-provider.js';
import { assistantMessageFromResponse } from '../src/llm/index.js';
import type { LLMMessage, LLMTool } from '../src/llm/types.js';

const tool: LLMTool = { name: 'search', description: 'Search code', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('OpenAI Responses provider', () => {
  it('round-trips parallel tools and encrypted reasoning without server-side storage', async () => {
    const output = [
      { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'opaque' },
      { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'search', arguments: '{"query":"auth"}' },
      { type: 'function_call', id: 'fc_2', call_id: 'call_2', name: 'search', arguments: '{"query":"db"}' },
    ];
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'completed', output, usage: { input_tokens: 50, output_tokens: 20 } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Cited summary' }] }] })));
    vi.stubGlobal('fetch', fetcher);
    const provider = new OpenAIProvider({ apiKey: 'test-key' });
    await provider.initialize();
    const messages: LLMMessage[] = [{ role: 'user', content: 'Explain architecture' }];
    const first = await provider.chat(messages, [tool], { maxTokens: 1000, temperature: 0.2, systemPrompt: 'Use sources' });
    expect(first.toolCalls).toHaveLength(2);
    messages.push(assistantMessageFromResponse(first), { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'call_1', content: 'auth.ts:1' },
      { type: 'tool_result', tool_use_id: 'call_2', content: 'db.ts:1' },
    ] });
    const second = await provider.chat(messages, [tool], { maxTokens: 1000 });
    const request = JSON.parse(fetcher.mock.calls[1][1].body);
    expect(fetcher.mock.calls[0][0]).toBe('https://api.openai.com/v1/responses');
    expect(request.model).toBe('gpt-6.1-sol');
    expect(request.store).toBe(false);
    expect(request.temperature).toBeUndefined();
    expect(request.input).toEqual([
      { role: 'user', content: 'Explain architecture' }, ...output,
      { type: 'function_call_output', call_id: 'call_1', output: 'auth.ts:1' },
      { type: 'function_call_output', call_id: 'call_2', output: 'db.ts:1' },
    ]);
    expect(request.tools[0].strict).toBe(false);
    expect(second.content).toBe('Cited summary');
    expect(first.usage).toEqual({ inputTokens: 50, outputTokens: 20 });
  });

  it('retries a temporary rate limit and retains the selected model', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output: [], status: 'incomplete' })));
    vi.stubGlobal('fetch', fetcher);
    const provider = new OpenAIProvider({ apiKey: 'test-key', model: 'gpt-6.1-sol-custom' });
    await provider.initialize();
    expect((await provider.chat([{ role: 'user', content: 'Hi' }], [], { maxTokens: 100 })).stopReason).toBe('max_tokens');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetcher.mock.calls[1][1].body).model).toBe('gpt-6.1-sol-custom');
  });

  it('reports missing keys and unavailable models without silently changing provider', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    await expect(new OpenAIProvider().initialize()).rejects.toThrow('OPENAI_API_KEY');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })));
    const provider = new OpenAIProvider({ apiKey: 'test-key', model: 'private-model' });
    await provider.initialize();
    await expect(provider.chat([], [], { maxTokens: 100 })).rejects.toThrow('private-model is unavailable');
  });

  it('rejects malformed function arguments before any tool can execute', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ output: [{ type: 'function_call', call_id: 'c', name: 'search', arguments: '{bad' }] }))));
    const provider = new OpenAIProvider({ apiKey: 'test-key' });
    await provider.initialize();
    await expect(provider.chat([], [tool], { maxTokens: 100 })).rejects.toThrow('invalid JSON');
  });
});
