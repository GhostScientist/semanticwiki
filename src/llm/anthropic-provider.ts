/**
 * Anthropic Provider
 *
 * LLM provider that connects to the Anthropic API (Claude).
 * This is the default cloud provider.
 */

import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_ANTHROPIC_MODEL } from './defaults.js';
import type {
  LLMProvider,
  LLMMessage,
  LLMTool,
  LLMToolCall,
  LLMResponse,
  LLMProviderOptions,
  ModelInfo,
  ProgressCallback,
  ContentBlock,
  ThinkingContentBlock,
  RedactedThinkingContentBlock,
} from './types.js';

/**
 * Options for the AnthropicProvider
 */
export interface AnthropicProviderOptions {
  /** Anthropic API key */
  apiKey?: string;
  /** Model name to use (default: claude-sonnet-5-5) */
  model?: string;
  /** Progress callback for status updates */
  onProgress?: ProgressCallback;
}

/**
 * AnthropicProvider - Connect to Anthropic's Claude API
 *
 * The default cloud provider for high-quality wiki generation.
 */
export class AnthropicProvider implements LLMProvider {
  private client: Anthropic | null = null;
  private modelName: string;
  private apiKey?: string;
  private progressCallback?: ProgressCallback;

  constructor(options: AnthropicProviderOptions = {}) {
    this.apiKey = options.apiKey;
    this.modelName = options.model || DEFAULT_ANTHROPIC_MODEL;
    this.progressCallback = options.onProgress;
  }

  /**
   * Set a progress callback for status updates
   */
  setProgressCallback(callback: ProgressCallback): void {
    this.progressCallback = callback;
  }

  /**
   * Initialize the provider - create client and verify API key
   */
  async initialize(): Promise<void> {
    const key = this.apiKey || process.env.ANTHROPIC_API_KEY;

    if (!key) {
      throw new Error(
        'Anthropic API key not found.\n\n' +
          'Set it via:\n' +
          '  1. Environment variable: ANTHROPIC_API_KEY=your-key\n' +
          '  2. Or use --provider local for local generation'
      );
    }

    this.client = new Anthropic({ apiKey: key });

    // Optionally verify the key works (commented out to avoid unnecessary API call)
    // await this.client.messages.create({ model: this.modelName, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] });

    this.progressCallback?.({ phase: 'ready', message: `Anthropic · ${this.modelName}` });
  }

  /**
   * Send a chat completion request
   */
  async chat(
    messages: LLMMessage[],
    tools: LLMTool[],
    options: LLMProviderOptions
  ): Promise<LLMResponse> {
    if (!this.client) {
      throw new Error('Provider not initialized. Call initialize() first.');
    }

    const anthropicMessages = this.convertMessages(messages);
    const anthropicTools = this.convertTools(tools);

    try {
      // Build system parameter - use cache_control for prompt caching if system prompt provided
      const systemPrompt = [options.systemPrompt, ...messages.filter(m => m.role === 'system').map(m => typeof m.content === 'string' ? m.content : m.content.filter(b => b.type === 'text').map(b => b.text).join('\n'))].filter(Boolean).join('\n\n');
      const systemParam = systemPrompt
        ? [
            {
              type: 'text' as const,
              text: systemPrompt,
              cache_control: { type: 'ephemeral' as const }
            }
          ]
        : undefined;

      const adaptiveThinking = /^claude-(?:opus|sonnet)-4-[678](?:-|$)/.test(this.modelName)
        || /^claude-(?:opus|sonnet|haiku|fable)-5(?:-|$)/.test(this.modelName);
      const createParams: Anthropic.MessageCreateParamsNonStreaming = {
        model: this.modelName,
        max_tokens: options.maxTokens,
        system: systemParam,
        tools: anthropicTools.length > 0 ? anthropicTools : undefined,
        messages: anthropicMessages,
        stop_sequences: options.stopSequences,
        ...(adaptiveThinking ? {
          thinking: { type: 'adaptive' },
          output_config: { effort: 'high' },
        } : { temperature: options.temperature }),
      };
      const response = await this.client.messages.create(createParams);

      return this.parseResponse(response);
    } catch (error) {
      const err = error as Error & { status?: number };

      if (err.status === 401) {
        throw new Error('Invalid Anthropic API key. Please check your ANTHROPIC_API_KEY.');
      }

      if (err.status === 429) {
        throw new Error('Rate limited by Anthropic API. Please wait and try again.');
      }

      throw error;
    }
  }

  /**
   * Clean up resources
   */
  async shutdown(): Promise<void> {
    this.client = null;
  }

  /**
   * Get information about the current model
   */
  getModelInfo(): ModelInfo {
    const contextLength = this.getContextLength();

    return {
      name: this.modelName,
      contextLength,
      supportsTools: true,
      supportsStreaming: false,
      isLocal: false,
    };
  }

  /**
   * Return the known context window for Anthropic models used by this CLI.
   * Modern model IDs are pinned snapshots. Older/custom models retain the
   * conservative 200K input budget.
   */
  private getContextLength(): number {
    if (/^claude-(?:opus|sonnet)-4-[678](?:-|$)/.test(this.modelName)
      || /^claude-(?:opus|sonnet|haiku|fable)-5(?:-|$)/.test(this.modelName)) return 1_000_000;
    return 200_000;
  }

  /**
   * Convert messages to Anthropic format
   */
  private convertMessages(messages: LLMMessage[]): Anthropic.MessageParam[] {
    const result: Anthropic.MessageParam[] = [];
    for (const message of messages) {
      if (message.role === 'system') continue;
      const role = message.role === 'assistant' ? 'assistant' : 'user';
      let blocks: Anthropic.ContentBlockParam[];
      if (message.role === 'tool' && typeof message.content === 'string') {
        if (!message.toolCallId) throw new Error('A tool result is missing its tool call ID.');
        blocks = [{ type: 'tool_result', tool_use_id: message.toolCallId, content: message.content }];
      } else if (typeof message.content === 'string') {
        blocks = [{ type: 'text', text: message.content }];
      } else {
        blocks = message.content.map(block => this.convertContentBlock(block));
      }
      const previous = result.at(-1);
      // Parallel tool results must remain one user turn immediately after the tool calls.
      if (previous?.role === role && Array.isArray(previous.content)) previous.content.push(...blocks);
      else result.push({ role, content: blocks });
    }
    return result;
  }

  /**
   * Convert a content block to Anthropic format
   */
  private convertContentBlock(
    block: ContentBlock
  ): Anthropic.ContentBlockParam {
    switch (block.type) {
      case 'text':
        return { type: 'text', text: block.text };
      case 'tool_use':
        return {
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input,
        };
      case 'tool_result':
        return {
          type: 'tool_result',
          tool_use_id: block.tool_use_id,
          content: block.content,
          is_error: block.is_error,
        };
      case 'thinking':
        // Pass thinking blocks back verbatim — signature carries the encrypted reasoning
        // that the server needs to reconstruct context on the next turn.
        return { type: 'thinking', thinking: block.thinking, signature: block.signature };
      case 'redacted_thinking':
        return { type: 'redacted_thinking', data: block.data };
      default:
        throw new Error(`Unknown content block type: ${(block as ContentBlock).type}`);
    }
  }

  /**
   * Convert tools to Anthropic format
   */
  private convertTools(tools: LLMTool[]): Anthropic.Tool[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters as Anthropic.Tool['input_schema'],
    }));
  }

  /**
   * Parse Anthropic response to our format
   */
  private parseResponse(response: Anthropic.Message): LLMResponse {
    if (response.stop_reason === 'model_context_window_exceeded') {
      throw new Error(`Anthropic model ${this.modelName} reached its context limit before completing the response. Reduce conversation history or resume with semanticwiki continue to start a fresh conversation.`);
    }
    const toolCalls: LLMToolCall[] = [];
    const thinkingBlocks: Array<ThinkingContentBlock | RedactedThinkingContentBlock> = [];
    const assistantContent: ContentBlock[] = [];
    let textContent = '';

    for (const block of response.content) {
      if (block.type === 'text') {
        textContent += block.text;
        assistantContent.push({ type: 'text', text: block.text });
      } else if (block.type === 'tool_use') {
        assistantContent.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input as Record<string, unknown> });
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        });
      } else if (block.type === 'redacted_thinking') {
        thinkingBlocks.push({ type: 'redacted_thinking', data: block.data });
        assistantContent.push({ type: 'redacted_thinking', data: block.data });
      } else if (block.type === 'thinking') {
        // Collect adaptive-thinking blocks so the caller can round-trip them on the next
        // turn. signature is opaque; thinking text is empty on Opus 4.7 by default.
        const t = block;
        thinkingBlocks.push({ type: 'thinking', thinking: t.thinking ?? '', signature: t.signature });
        assistantContent.push({ type: 'thinking', thinking: t.thinking ?? '', signature: t.signature });
      }
    }

    let stopReason: LLMResponse['stopReason'] = 'end_turn';
    if (response.stop_reason === 'tool_use') {
      stopReason = 'tool_use';
    } else if (response.stop_reason === 'max_tokens') {
      stopReason = 'max_tokens';
    }

    return {
      content: textContent,
      assistantContent,
      toolCalls,
      thinkingBlocks: thinkingBlocks.length > 0 ? thinkingBlocks : undefined,
      stopReason,
      usage: {
        inputTokens: response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0),
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}

export default AnthropicProvider;
