/**
 * LLM Provider Types
 *
 * Shared types and interfaces for Anthropic, OpenAI, local GGUF, and Ollama providers
 */

// JSON Schema type for tool parameters
export type JSONSchema = {
  type?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  description?: string;
  enum?: string[];
  [key: string]: unknown;
};

/**
 * Content block types for complex message content
 */
export interface TextContentBlock {
  type: 'text';
  text: string;
}

export interface ToolUseContentBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultContentBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

// Anthropic thinking blocks must be passed back verbatim with tool results.
// Signatures are opaque; visible thinking text may be empty for some models.
export interface ThinkingContentBlock {
  type: 'thinking';
  thinking: string;
  signature: string;
}

export interface RedactedThinkingContentBlock {
  type: 'redacted_thinking';
  data: string;
}

/** Provider-owned continuation items, including encrypted reasoning. Never render these. */
export interface ProviderState {
  provider: 'openai';
  output: Array<Record<string, unknown>>;
}

export type ContentBlock =
  | TextContentBlock
  | ToolUseContentBlock
  | ToolResultContentBlock
  | ThinkingContentBlock
  | RedactedThinkingContentBlock;

/**
 * Message format for LLM conversations
 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentBlock[];
  toolCallId?: string;
  name?: string;
  providerState?: ProviderState;
}

/**
 * Tool definition for function calling
 */
export interface LLMTool {
  name: string;
  description: string;
  parameters: JSONSchema;
}

/**
 * Tool call made by the LLM
 */
export interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Response from an LLM provider
 */
export interface LLMResponse {
  content: string;
  toolCalls: LLMToolCall[];
  // Thinking blocks returned by the provider. Must be round-tripped verbatim in the next
  // assistant message when adaptive thinking is combined with tool use (Anthropic API
  // requirement). Local/Ollama providers leave this undefined.
  thinkingBlocks?: Array<ThinkingContentBlock | RedactedThinkingContentBlock>;
  /** Original assistant block order for providers with interleaved thinking/tool use. */
  assistantContent?: ContentBlock[];
  providerState?: ProviderState;
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'error';
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Streaming chunk for real-time responses
 */
export interface LLMStreamChunk {
  type: 'text' | 'tool_call_start' | 'tool_call_delta' | 'tool_call_end' | 'done';
  text?: string;
  toolCall?: Partial<LLMToolCall>;
}

/**
 * Options for chat completions
 */
export interface LLMProviderOptions {
  maxTokens: number;
  temperature?: number;
  systemPrompt?: string;
  stopSequences?: string[];
}

/**
 * Model information returned by providers
 */
export interface ModelInfo {
  name: string;
  contextLength: number;
  supportsTools: boolean;
  supportsStreaming: boolean;
  isLocal: boolean;
}

/**
 * Progress callback for long-running operations
 */
export interface ProgressCallback {
  (progress: {
    phase: string;
    percent?: number;
    message?: string;
    tokensPerSecond?: number;
    memoryUsage?: number;
  }): void;
}

/**
 * Base interface for all LLM providers
 */
export interface LLMProvider {
  /**
   * Initialize the provider (load model, connect to server, etc.)
   * Must be called before using chat()
   */
  initialize(): Promise<void>;

  /**
   * Send a chat completion request
   */
  chat(
    messages: LLMMessage[],
    tools: LLMTool[],
    options: LLMProviderOptions
  ): Promise<LLMResponse>;

  /**
   * Stream a chat completion (optional)
   */
  stream?(
    messages: LLMMessage[],
    tools: LLMTool[],
    options: LLMProviderOptions
  ): AsyncIterable<LLMStreamChunk>;

  /**
   * Clean up resources (unload model, close connections)
   */
  shutdown(): Promise<void>;

  /**
   * Get information about the current model
   */
  getModelInfo(): ModelInfo;

  /**
   * Set a progress callback for status updates
   */
  setProgressCallback?(callback: ProgressCallback): void;
}

/**
 * Hardware profile for model selection
 */
export interface HardwareProfile {
  gpuVendor: 'nvidia' | 'amd' | 'apple' | 'intel' | 'none';
  gpuName?: string;
  gpuVram: number; // In GB
  systemRam: number; // In GB
  cpuCores: number;
  cpuModel?: string;
}

/**
 * Model recommendation from the registry
 */
export interface ModelRecommendation {
  modelId: string;
  ggufFile: string;
  downloadUrl: string;
  fileSizeBytes: number;
  minVram: number;
  minRam: number;
  contextLength: number;
  quality: 'excellent' | 'good' | 'acceptable';
  sha256?: string;
}

/**
 * Model family type for local models
 * - 'semanticwiki': Default Qwen-based SemanticWiki Coder 7B v2
 * - 'gpt-oss': Legacy 20B model available by explicit selection
 * - 'completion': Small fast model (1.5B) for text completion tasks like contextual retrieval
 */
export type ModelFamily = 'semanticwiki' | 'gpt-oss' | 'completion';

export type ProviderName = 'anthropic' | 'openai' | 'local' | 'ollama';

/**
 * Options for creating an LLM provider
 */
export interface CreateProviderOptions {
  // Mode selection
  provider?: ProviderName;
  fullLocal?: boolean;
  useOllama?: boolean;

  // Cloud options (apiKey belongs to the selected provider)
  apiKey?: string;
  model?: string;

  // Local options
  modelPath?: string;
  localModel?: string;
  modelFamily?: ModelFamily;
  gpuLayers?: number;
  contextSize?: number;
  threads?: number;
  verbose?: boolean;

  // Ollama options
  ollamaHost?: string;

  // Progress callback
  onProgress?: ProgressCallback;
}
