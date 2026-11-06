import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const mock = vi.hoisted(() => {
  const disposeSequence = vi.fn();
  const sequence = { dispose: disposeSequence, tokenMeter: { usedInputTokens: 10, usedOutputTokens: 5 } };
  const context = { contextSize: 8192, getSequence: vi.fn(() => sequence), dispose: vi.fn() };
  const model = { trainContextSize: 32768, createContext: vi.fn(async () => context), dispose: vi.fn() };
  const llama = { loadModel: vi.fn(async () => model) };
  return { context, model, llama, sequence, disposeSequence, prompt: vi.fn(), history: vi.fn(), sessions: [] as any[] };
});
vi.mock('node-llama-cpp', () => ({
  getLlama: vi.fn(async () => mock.llama),
  LlamaChatSession: class {
    constructor(options: unknown) { mock.sessions.push(options); }
    setChatHistory = mock.history;
    promptWithMeta = mock.prompt;
    dispose(options: { disposeSequence?: boolean }) { if (options.disposeSequence) mock.disposeSequence(); }
  },
}));
import { LocalLlamaProvider, buildLocalConversation, parseLocalToolCalls } from '../src/llm/local-llama-provider.js';

let directory: string;
let modelPath: string;
beforeEach(() => {
  vi.clearAllMocks(); mock.sessions.length = 0;
  mock.prompt.mockResolvedValue({ responseText: 'Done', stopReason: 'eogToken' });
  directory = mkdtempSync(path.join(os.tmpdir(), 'semanticwiki-local-'));
  modelPath = path.join(directory, 'fixture.gguf'); writeFileSync(modelPath, 'GGUF');
});
afterEach(() => rmSync(directory, { force: true, recursive: true }));

describe('local inference runtime', () => {
  it('uses one sequence, automatic GPU layers, and releases the sequence across 30 pages', async () => {
    const provider = new LocalLlamaProvider({ modelPath });
    await provider.initialize();
    expect(mock.llama.loadModel).toHaveBeenCalledWith({ modelPath, gpuLayers: 'auto' });
    expect(mock.model.createContext).toHaveBeenCalledWith({ contextSize: 8192, threads: undefined, sequences: 1 });
    for (let i = 0; i < 30; i++) await provider.chat([{ role: 'user', content: `Page ${i}` }], [], { maxTokens: 50 });
    expect(mock.disposeSequence).toHaveBeenCalledTimes(30);
    expect(mock.sessions.every(session => session.autoDisposeSequence === true)).toBe(true);
    await provider.shutdown();
    expect(mock.context.dispose).toHaveBeenCalled();
    expect(mock.model.dispose).toHaveBeenCalled();
  });

  it('releases a failed generation and surfaces the failure instead of returning empty success', async () => {
    mock.prompt.mockRejectedValueOnce(new Error('out of memory'));
    const provider = new LocalLlamaProvider({ modelPath, gpuLayers: 0 });
    await provider.initialize();
    await expect(provider.chat([{ role: 'user', content: 'Generate' }], [], { maxTokens: 50 })).rejects.toThrow('out of memory');
    expect(mock.disposeSequence).toHaveBeenCalledTimes(1);
    expect((await provider.chat([{ role: 'user', content: 'Retry' }], [], { maxTokens: 50 })).content).toBe('Done');
    await provider.shutdown();
  });

  it('waits for asynchronous sequence reclamation before starting another queued chat', async () => {
    const provider = new LocalLlamaProvider({ modelPath });
    await provider.initialize();
    let releaseSequence!: () => void;
    let disposalStarted!: () => void;
    const started = new Promise<void>(resolve => { disposalStarted = resolve; });
    mock.disposeSequence.mockImplementationOnce(() => {
      disposalStarted();
      return new Promise<void>(resolve => { releaseSequence = resolve; });
    });
    const first = provider.chat([{ role: 'user', content: 'First page' }], [], { maxTokens: 50 });
    const second = provider.chat([{ role: 'user', content: 'Second page' }], [], { maxTokens: 50 });
    await started;
    await new Promise(resolve => setImmediate(resolve));
    expect(mock.context.getSequence).toHaveBeenCalledTimes(1);
    releaseSequence();
    await Promise.all([first, second]);
    expect(mock.context.getSequence).toHaveBeenCalledTimes(2);
    expect(mock.disposeSequence).toHaveBeenCalledTimes(2);
    await provider.shutdown();
  });

  it('keeps previous instructions, assistant calls, and all tool results in the next prompt', () => {
    const conversation = buildLocalConversation([
      { role: 'user', content: 'Document auth' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'read_file', input: { path: 'auth.ts' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'export function login() {}' }] },
      { role: 'tool', toolCallId: 'c2', content: 'Second result' },
    ], 'Cite sources')!;
    expect(conversation.history[0]).toEqual({ type: 'system', text: 'Cite sources' });
    expect(JSON.stringify(conversation.history)).toContain('Document auth');
    expect(JSON.stringify(conversation.history)).toContain('read_file');
    expect(conversation.prompt).toContain('export function login()');
    expect(conversation.prompt).toContain('Second result');
  });

  it('parses nested Qwen tool arguments while preserving ordinary JSON examples', () => {
    const parsed = parseLocalToolCalls('Searching.\n<tool_call>\n{"name":"search","arguments":{"query":"a {brace}","filter":{"type":"ts"}}}\n</tool_call>\n{"example":true}', [
      { name: 'search', description: '', parameters: { type: 'object' } },
    ]);
    expect(parsed.toolCalls[0].arguments).toEqual({ query: 'a {brace}', filter: { type: 'ts' } });
    expect(parsed.content).toContain('Searching.');
    expect(parsed.content).toContain('{"example":true}');
    expect(parsed.content).not.toContain('<tool_call>');
  });
});
