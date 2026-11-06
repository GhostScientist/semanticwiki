/** Local Qwen-based GGUF inference with bounded memory and complete conversation history. */
import * as path from 'node:path';
import { stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { ChatHistoryItem, Llama, LlamaContext, LlamaModel } from 'node-llama-cpp';
import type { LLMProvider, LLMMessage, LLMTool, LLMToolCall, LLMResponse, LLMProviderOptions, ModelInfo, ProgressCallback, ModelFamily } from './types.js';
import { ModelManager } from './model-manager.js';
import { DEFAULT_LOCAL_CONTEXT_SIZE } from './defaults.js';

export interface LocalLlamaProviderOptions {
  modelPath?: string;
  modelId?: string;
  modelFamily?: ModelFamily;
  /** -1 or omitted selects automatic GPU offload; 0 forces CPU inference. */
  gpuLayers?: number;
  contextSize?: number;
  threads?: number;
  onProgress?: ProgressCallback;
  verbose?: boolean;
}

export class LocalLlamaProvider implements LLMProvider {
  private llama: Llama | null = null;
  private model: LlamaModel | null = null;
  private context: LlamaContext | null = null;
  private readonly modelManager = new ModelManager();
  private progressCallback?: ProgressCallback;
  private modelInfo: ModelInfo | null = null;
  private pendingChat: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: LocalLlamaProviderOptions = {}) {
    if (options.onProgress) this.setProgressCallback(options.onProgress);
  }

  setProgressCallback(callback: ProgressCallback): void {
    this.progressCallback = callback;
    this.modelManager.setProgressCallback(callback);
  }

  async initialize(): Promise<void> {
    if (this.context) return;
    if (this.options.contextSize !== undefined && (!Number.isInteger(this.options.contextSize) || this.options.contextSize < 512)) {
      throw new Error('Local context size must be an integer of at least 512 tokens.');
    }
    if (this.options.gpuLayers !== undefined && (!Number.isInteger(this.options.gpuLayers) || this.options.gpuLayers < -1)) {
      throw new Error('GPU layers must be -1 (automatic), 0 (CPU), or a positive integer.');
    }
    if (this.options.threads !== undefined && (!Number.isInteger(this.options.threads) || this.options.threads < 1)) {
      throw new Error('Local thread count must be a positive integer.');
    }
    let modelPath: string;
    let modelId: string;
    let contextLength = Number.POSITIVE_INFINITY;
    if (this.options.modelPath) {
      modelPath = path.resolve(this.options.modelPath);
      if (!(await stat(modelPath)).isFile()) throw new Error(`Local model is not a file: ${modelPath}`);
      modelId = path.basename(modelPath, '.gguf');
    } else {
      const model = this.options.modelId
        ? this.modelManager.getModelById(this.options.modelId)
        : this.modelManager.recommendModel(await this.modelManager.detectHardware(), this.options.modelFamily ?? 'semanticwiki');
      if (!model) throw new Error(`Unknown local model: ${this.options.modelId}. Run semanticwiki models list.`);
      modelPath = await this.modelManager.ensureModel(model);
      modelId = model.modelId;
      contextLength = model.contextLength;
    }
    this.progressCallback?.({ phase: 'loading', message: `Loading ${modelId}` });
    try {
      const { getLlama } = await import('node-llama-cpp');
      this.llama = await getLlama();
      this.model = await this.llama.loadModel({
        modelPath,
        gpuLayers: this.options.gpuLayers === undefined || this.options.gpuLayers === -1 ? 'auto' : this.options.gpuLayers,
      });
      const modelLimit = this.model.trainContextSize || contextLength;
      this.context = await this.model.createContext({
        contextSize: Math.min(this.options.contextSize ?? DEFAULT_LOCAL_CONTEXT_SIZE, contextLength, modelLimit),
        threads: this.options.threads,
        // Calls are serialized. Allocating twenty sequences multiplied the KV-cache footprint.
        sequences: 1,
      });
      this.modelInfo = { name: modelId, contextLength: this.context.contextSize, supportsTools: true, supportsStreaming: false, isLocal: true };
      this.progressCallback?.({ phase: 'ready', message: `${modelId} · ${this.context.contextSize.toLocaleString()} token context` });
    } catch (error) {
      await this.releaseResources();
      throw new Error(`Failed to load local model: ${(error as Error).message}. Try --gpu-layers 0 or a smaller --context-size.`);
    }
  }

  chat(messages: LLMMessage[], tools: LLMTool[], options: LLMProviderOptions): Promise<LLMResponse> {
    // A single model sequence is reusable across arbitrarily many pages and concurrent callers.
    const result = this.pendingChat.then(() => this.runChat(messages, tools, options));
    this.pendingChat = result.catch(() => {});
    return result;
  }

  private async runChat(messages: LLMMessage[], tools: LLMTool[], options: LLMProviderOptions): Promise<LLMResponse> {
    if (!this.context || !this.model) throw new Error('Provider not initialized. Call initialize() first.');
    const systemPrompt = [options.systemPrompt, buildToolPrompt(tools)].filter(Boolean).join('\n\n');
    const conversation = buildLocalConversation(messages, systemPrompt);
    if (!conversation) return { content: '', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
    const { LlamaChatSession } = await import('node-llama-cpp');
    const sequence = this.context.getSequence();
    let session: InstanceType<typeof LlamaChatSession> | undefined;
    try {
      session = new LlamaChatSession({ contextSequence: sequence, systemPrompt, autoDisposeSequence: true });
      session.setChatHistory(conversation.history);
      const response = await session.promptWithMeta(conversation.prompt, {
        maxTokens: options.maxTokens,
        temperature: options.temperature ?? 0.2,
        customStopTriggers: options.stopSequences,
      });
      const parsed = parseLocalToolCalls(response.responseText, tools);
      return {
        content: parsed.content, toolCalls: parsed.toolCalls,
        stopReason: response.stopReason === 'maxTokens' ? 'max_tokens' : parsed.toolCalls.length ? 'tool_use' : 'end_turn',
        usage: { inputTokens: sequence.tokenMeter.usedInputTokens, outputTokens: sequence.tokenMeter.usedOutputTokens },
      };
    } catch (error) {
      throw new Error(`Local generation failed: ${(error as Error).message}`);
    } finally {
      // Session disposal is synchronous and does not await sequence reclamation.
      // Release it separately before the next queued chat requests our sole sequence.
      try { session?.dispose({ disposeSequence: false }); }
      finally { await sequence.dispose(); }
    }
  }

  async shutdown(): Promise<void> {
    await this.pendingChat;
    await this.releaseResources();
  }

  private async releaseResources(): Promise<void> {
    try { await this.context?.dispose(); }
    finally {
      this.context = null;
      try { await this.model?.dispose(); }
      finally { this.model = null; this.llama = null; this.modelInfo = null; }
    }
  }

  getModelInfo(): ModelInfo {
    return this.modelInfo ?? { name: this.options.modelId ?? 'local', contextLength: this.options.contextSize ?? DEFAULT_LOCAL_CONTEXT_SIZE, supportsTools: true, supportsStreaming: false, isLocal: true };
  }
}

/** Preserve earlier assistant turns and tool results instead of resending only the last question. */
export function buildLocalConversation(messages: LLMMessage[], systemPrompt: string): { history: ChatHistoryItem[]; prompt: string } | null {
  const system = [systemPrompt, ...messages.filter(m => m.role === 'system').map(messageText)].filter(Boolean).join('\n\n');
  const history: ChatHistoryItem[] = system ? [{ type: 'system', text: system }] : [];
  for (const message of messages) {
    if (message.role === 'system') continue;
    const text = messageText(message);
    if (!text) continue;
    const previous = history.at(-1);
    if (message.role === 'assistant') {
      if (previous?.type === 'model') previous.response.push(text);
      else history.push({ type: 'model', response: [text] });
    } else {
      if (previous?.type === 'user') previous.text += `\n\n${text}`;
      else history.push({ type: 'user', text });
    }
  }
  const latest = history.at(-1);
  if (!latest || latest.type === 'system') return null;
  if (latest.type === 'user') { history.pop(); return { history, prompt: latest.text }; }
  return { history, prompt: 'Continue from the conversation above.' };
}

function messageText(message: LLMMessage): string {
  if (typeof message.content === 'string') return message.role === 'tool' ? `Tool result (${message.toolCallId ?? message.name ?? 'tool'}):\n${message.content}` : message.content;
  return message.content.map(block => {
    if (block.type === 'text') return block.text;
    if (block.type === 'tool_use') return JSON.stringify({ tool: block.name, args: block.input });
    if (block.type === 'tool_result') return `Tool result (${block.tool_use_id})${block.is_error ? ' [error]' : ''}:\n${block.content}`;
    return '';
  }).filter(Boolean).join('\n');
}

function buildToolPrompt(tools: LLMTool[]): string {
  if (!tools.length) return '';
  return `Available tools:\n${tools.map(tool => JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters })).join('\n')}\n\nTo call a tool, output a JSON object on its own line: {"tool":"tool_name","args":{"parameter":"value"}}. Use only the listed tools. Wait for tool results before drawing conclusions. When finished, write a final response.`;
}

/** Parse balanced JSON so nested argument objects and Qwen tool-call tags are supported. */
export function parseLocalToolCalls(response: string, tools: LLMTool[]): { content: string; toolCalls: LLMToolCall[] } {
  const names = new Set(tools.map(tool => tool.name));
  const toolCalls: LLMToolCall[] = [];
  const spans: Array<[number, number]> = [];
  let start = -1, depth = 0, quoted = false, escaped = false;
  for (let i = 0; i < response.length; i++) {
    const char = response[i];
    if (start < 0) { if (char === '{') { start = i; depth = 1; } continue; }
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) {
      try {
        const parsed = JSON.parse(response.slice(start, i + 1));
        const name = parsed.tool ?? parsed.name;
        const args = parsed.args ?? parsed.arguments ?? {};
        if (names.has(name) && args && typeof args === 'object' && !Array.isArray(args)) {
          toolCalls.push({ id: `call_${randomUUID()}`, name, arguments: args });
          spans.push([start, i + 1]);
        }
      } catch { /* Leave non-tool or malformed JSON in the response text. */ }
      start = -1;
    }
  }
  let content = response;
  for (const [from, to] of spans.reverse()) content = content.slice(0, from) + content.slice(to);
  if (toolCalls.length) content = content.replace(/<tool_call>\s*<\/tool_call>/g, '').replace(/```(?:json)?\s*```/g, '').trim();
  return { content, toolCalls };
}
export default LocalLlamaProvider;
