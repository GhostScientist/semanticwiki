import { DEFAULT_OPENAI_MODEL } from './defaults.js';
import type {
  LLMMessage, LLMProvider, LLMProviderOptions, LLMResponse, LLMTool,
  LLMToolCall, ModelInfo, ProgressCallback,
} from './types.js';

export interface OpenAIProviderOptions {
  apiKey?: string;
  model?: string;
  onProgress?: ProgressCallback;
  timeoutMs?: number;
  maxRetries?: number;
}

interface ResponsesResult {
  status?: string;
  output?: Array<Record<string, unknown>>;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
  incomplete_details?: { reason?: string };
}

/** OpenAI Responses API, with stateless, encrypted reasoning continuation. */
export class OpenAIProvider implements LLMProvider {
  private apiKey?: string;
  private readonly model: string;
  private progressCallback?: ProgressCallback;
  private initialized = false;

  constructor(private readonly options: OpenAIProviderOptions = {}) {
    this.model = options.model ?? DEFAULT_OPENAI_MODEL;
    this.progressCallback = options.onProgress;
  }

  setProgressCallback(callback: ProgressCallback): void { this.progressCallback = callback; }

  async initialize(): Promise<void> {
    this.apiKey = this.options.apiKey?.trim() || process.env.OPENAI_API_KEY?.trim();
    if (!this.apiKey) {
      throw new Error('OpenAI API key not found. Set OPENAI_API_KEY or choose --provider local.');
    }
    this.initialized = true;
    this.progressCallback?.({ phase: 'ready', message: `OpenAI · ${this.model}` });
  }

  async shutdown(): Promise<void> {
    this.apiKey = undefined;
    this.initialized = false;
  }

  getModelInfo(): ModelInfo {
    // Unknown custom models use a conservative context budget.
    const contextLength = this.model === DEFAULT_OPENAI_MODEL ? 1_050_000 : 128_000;
    return { name: this.model, contextLength, supportsTools: true, supportsStreaming: false, isLocal: false };
  }

  async chat(messages: LLMMessage[], tools: LLMTool[], options: LLMProviderOptions): Promise<LLMResponse> {
    if (!this.initialized) throw new Error('Provider not initialized. Call initialize() first.');
    const systemMessages = messages.filter(m => m.role === 'system').map(m => textContent(m.content));
    const instructions = [options.systemPrompt, ...systemMessages].filter(Boolean).join('\n\n');
    const reasoningModel = /^(gpt-[56](?:[.-]|$)|o[134](?:-|$))/.test(this.model);
    const body = {
      model: this.model,
      instructions: instructions || undefined,
      input: this.convertMessages(messages),
      tools: tools.length ? tools.map(tool => ({
        type: 'function', name: tool.name, description: tool.description,
        parameters: tool.parameters,
        // Existing MCP schemas have optional properties; do not silently make them required.
        strict: false,
      })) : undefined,
      max_output_tokens: options.maxTokens,
      store: false,
      include: reasoningModel ? ['reasoning.encrypted_content'] : undefined,
      reasoning: reasoningModel ? { effort: 'medium' } : undefined,
      temperature: reasoningModel ? undefined : options.temperature,
    };
    const result = await this.request(body);
    if (result.status === 'failed' || result.error) {
      throw new Error(`OpenAI generation failed: ${result.error?.message ?? 'unknown error'}`);
    }
    const output = result.output ?? [];
    const toolCalls: LLMToolCall[] = [];
    const content: string[] = [];
    for (const item of output) {
      if (item.type === 'function_call') {
        let args: unknown;
        try { args = JSON.parse(String(item.arguments)); } catch {
          throw new Error(`OpenAI returned invalid JSON for tool ${String(item.name)}. Retry generation.`);
        }
        if (!args || typeof args !== 'object' || Array.isArray(args)) {
          throw new Error(`OpenAI returned non-object arguments for tool ${String(item.name)}.`);
        }
        if (typeof item.call_id !== 'string' || typeof item.name !== 'string') {
          throw new Error('OpenAI returned an incomplete function call. Retry generation.');
        }
        toolCalls.push({ id: item.call_id, name: item.name, arguments: args as Record<string, unknown> });
      } else if (item.type === 'message' && Array.isArray(item.content)) {
        for (const block of item.content) {
          if (block.type === 'output_text' && typeof block.text === 'string') content.push(block.text);
          if (block.type === 'refusal' && typeof block.refusal === 'string') content.push(block.refusal);
        }
      }
    }
    return {
      content: content.join('\n'), toolCalls,
      providerState: { provider: 'openai', output },
      stopReason: result.status === 'incomplete' ? 'max_tokens' : toolCalls.length ? 'tool_use' : 'end_turn',
      usage: { inputTokens: result.usage?.input_tokens ?? 0, outputTokens: result.usage?.output_tokens ?? 0 },
    };
  }

  private convertMessages(messages: LLMMessage[]): Array<Record<string, unknown>> {
    const input: Array<Record<string, unknown>> = [];
    for (const message of messages) {
      if (message.role === 'system') continue;
      if (message.role === 'assistant' && message.providerState?.provider === 'openai') {
        // Required for tool continuations: replay the full output, including encrypted reasoning.
        input.push(...message.providerState.output);
        continue;
      }
      if (message.role === 'tool' && typeof message.content === 'string') {
        if (!message.toolCallId) throw new Error('A tool result is missing its tool call ID.');
        input.push({ type: 'function_call_output', call_id: message.toolCallId, output: message.content });
        continue;
      }
      if (typeof message.content === 'string') {
        input.push({ role: message.role, content: message.content });
        continue;
      }
      for (const block of message.content) {
        switch (block.type) {
          case 'text':
            if (block.text) input.push({ role: message.role === 'assistant' ? 'assistant' : 'user', content: block.text });
            break;
          case 'tool_use':
            input.push({ type: 'function_call', call_id: block.id, name: block.name, arguments: JSON.stringify(block.input) });
            break;
          case 'tool_result':
            input.push({ type: 'function_call_output', call_id: block.tool_use_id, output: block.content });
            break;
          // Anthropic continuation blocks have no meaning in the OpenAI protocol.
          case 'thinking':
          case 'redacted_thinking':
            break;
        }
      }
    }
    return input;
  }

  private async request(body: Record<string, unknown>): Promise<ResponsesResult> {
    const maxRetries = this.options.maxRetries ?? 2;
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 120_000),
        });
      } catch (error) {
        if (attempt < maxRetries) { await retryDelay(attempt); continue; }
        const timedOut = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
        throw new Error(timedOut ? 'OpenAI request timed out. Retry or reduce the request size.' : 'Could not reach the OpenAI API. Check your connection.');
      }
      if (response.ok) return await response.json() as ResponsesResult;
      if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
        await response.body?.cancel();
        await retryDelay(attempt, response.headers.get('retry-after'));
        continue;
      }
      if (response.status === 401) throw new Error('Invalid OpenAI API key. Check OPENAI_API_KEY.');
      if (response.status === 403 || response.status === 404) throw new Error(`OpenAI model ${this.model} is unavailable to this API key. Check model access or set --model.`);
      if (response.status === 429) throw new Error('OpenAI rate or quota limit reached. Check your API quota and retry.');
      throw new Error(`OpenAI API request failed (${response.status}). Check the selected model and request options.`);
    }
  }
}

function textContent(content: LLMMessage['content']): string {
  return typeof content === 'string' ? content : content.filter(b => b.type === 'text').map(b => b.text).join('\n');
}

async function retryDelay(attempt: number, retryAfter?: string | null): Promise<void> {
  const seconds = retryAfter ? Number(retryAfter) : NaN;
  const delay = Number.isFinite(seconds) ? Math.min(30_000, Math.max(0, seconds * 1000)) : 1000 * 2 ** attempt;
  await new Promise(resolve => setTimeout(resolve, delay));
}
