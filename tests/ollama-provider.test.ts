import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ chat: vi.fn(), list: vi.fn() }));
vi.mock('ollama', () => ({ Ollama: class { chat = mock.chat; list = mock.list; } }));
import { OllamaProvider } from '../src/llm/ollama-provider.js';

beforeEach(() => {
  vi.clearAllMocks();
  mock.list.mockResolvedValue({ models: [{ name: 'fixture:latest' }] });
  mock.chat.mockResolvedValue({ message: { content: 'Documented' } });
});

describe('Ollama tool history', () => {
  it('passes every tool-result block as a named tool message', async () => {
    const provider = new OllamaProvider({ model: 'fixture' });
    await provider.initialize();
    await provider.chat([
      { role: 'user', content: 'Read both files' },
      { role: 'assistant', content: [
        { type: 'tool_use', id: 'one', name: 'read_file', input: { path: 'one.ts' } },
        { type: 'tool_use', id: 'two', name: 'read_file', input: { path: 'two.ts' } },
      ] },
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'one', content: 'First source' },
        { type: 'tool_result', tool_use_id: 'two', content: 'Second source' },
      ] },
    ], [], { maxTokens: 100 });
    expect(mock.chat.mock.calls[0][0].messages.slice(-2)).toEqual([
      { role: 'tool', tool_name: 'read_file', content: 'First source' },
      { role: 'tool', tool_name: 'read_file', content: 'Second source' },
    ]);
  });

  it('surfaces inference errors instead of returning an empty page', async () => {
    mock.chat.mockRejectedValue(new Error('model unavailable'));
    const provider = new OllamaProvider({ model: 'fixture' });
    await provider.initialize();
    await expect(provider.chat([], [], { maxTokens: 100 })).rejects.toThrow('model unavailable');
  });
});
