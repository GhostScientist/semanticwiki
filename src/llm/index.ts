/**
 * LLM Provider Module
 *
 * Unified interface for multiple LLM backends:
 * - AnthropicProvider: Cloud-based Claude API (default)
 * - OpenAIProvider: OpenAI Responses API
 * - LocalLlamaProvider: Self-contained local inference via node-llama-cpp
 * - OllamaProvider: External Ollama server for power users
 */

import { AnthropicProvider } from './anthropic-provider.js';
import { LocalLlamaProvider } from './local-llama-provider.js';
import { OllamaProvider } from './ollama-provider.js';
import { OpenAIProvider } from './openai-provider.js';
import type { LLMProvider, CreateProviderOptions, LLMMessage, LLMResponse, ContentBlock } from './types.js';

/**
 * Create an LLM provider based on the given options
 *
 * @param options - Configuration options for the provider
 * @returns Initialized LLM provider ready for use
 *
 * @example
 * // Use Claude API (default)
 * const provider = await createLLMProvider({ model: 'claude-sonnet-5-5' });
 *
 * @example
 * // Use local mode (self-contained)
 * const provider = await createLLMProvider({ fullLocal: true });
 *
 * @example
 * // Use Ollama
 * const provider = await createLLMProvider({
 *   fullLocal: true,
 *   useOllama: true,
 *   ollamaHost: 'http://localhost:11434',
 *   localModel: 'qwen2.5-coder:14b'
 * });
 */
export async function createLLMProvider(options: CreateProviderOptions = {}): Promise<LLMProvider> {
  const providerName = options.provider ?? (options.useOllama ? 'ollama' : options.fullLocal ? 'local' : 'anthropic');
  let provider: LLMProvider;
  switch (providerName) {
    case 'local':
      provider = new LocalLlamaProvider({
        modelPath: options.modelPath,
        modelId: options.localModel,
        modelFamily: options.modelFamily ?? 'semanticwiki',
        gpuLayers: options.gpuLayers,
        contextSize: options.contextSize,
        threads: options.threads,
        onProgress: options.onProgress,
        verbose: options.verbose,
      });
      break;
    case 'ollama':
      provider = new OllamaProvider({
        host: options.ollamaHost,
        model: options.localModel ?? options.model ?? 'semanticwiki-coder-7b-v2',
        onProgress: options.onProgress,
      });
      break;
    case 'openai':
      provider = new OpenAIProvider({ apiKey: options.apiKey, model: options.model, onProgress: options.onProgress });
      break;
    case 'anthropic':
      provider = new AnthropicProvider({ apiKey: options.apiKey, model: options.model, onProgress: options.onProgress });
      break;
    default:
      throw new Error(`Unknown provider: ${providerName}. Choose anthropic, openai, local, or ollama.`);
  }
  try {
    await provider.initialize();
    return provider;
  } catch (error) {
    await provider.shutdown().catch(() => {});
    throw error;
  }
}

/** Preserve provider continuation state as well as every tool call across turns. */
export function assistantMessageFromResponse(response: LLMResponse): LLMMessage {
  if (response.assistantContent) {
    return { role: 'assistant', content: response.assistantContent, providerState: response.providerState };
  }
  const content: ContentBlock[] = [...(response.thinkingBlocks ?? [])];
  if (response.content) content.push({ type: 'text', text: response.content });
  content.push(...response.toolCalls.map(call => ({
    type: 'tool_use' as const, id: call.id, name: call.name, input: call.arguments,
  })));
  return { role: 'assistant', content, providerState: response.providerState };
}

/**
 * Check if local mode is available on this system
 */
export async function isLocalModeAvailable(): Promise<{
  available: boolean;
  reason?: string;
  hardware?: import('./types.js').HardwareProfile;
}> {
  try {
    const { ModelManager } = await import('./model-manager.js');
    const manager = new ModelManager();
    const hardware = await manager.detectHardware();

    // Check minimum requirements
    if (hardware.gpuVram < 6 && hardware.systemRam < 8) {
      return {
        available: false,
        reason: 'Insufficient hardware: need at least 6GB VRAM or 8GB RAM for the default 7B model',
        hardware,
      };
    }

    return { available: true, hardware };
  } catch (error) {
    return {
      available: false,
      reason: `Hardware detection failed: ${(error as Error).message}`,
    };
  }
}

/**
 * Get recommended model for the current hardware
 */
export async function getRecommendedModel(): Promise<{
  model: import('./types.js').ModelRecommendation;
  hardware: import('./types.js').HardwareProfile;
} | null> {
  try {
    const { ModelManager } = await import('./model-manager.js');
    const manager = new ModelManager();
    const hardware = await manager.detectHardware();
    const model = manager.recommendModel(hardware);
    return { model, hardware };
  } catch {
    return null;
  }
}

/**
 * List all downloaded models
 */
export async function listDownloadedModels(): Promise<
  Array<{
    model: import('./types.js').ModelRecommendation;
    path: string;
    sizeBytes: number;
  }>
> {
  try {
    const { ModelManager } = await import('./model-manager.js');
    const manager = new ModelManager();
    return manager.listDownloadedModels();
  } catch {
    return [];
  }
}

// Re-export types and providers
export * from './types.js';
export * from './defaults.js';
export { OpenAIProvider } from './openai-provider.js';
export { AnthropicProvider } from './anthropic-provider.js';
export { LocalLlamaProvider } from './local-llama-provider.js';
export { OllamaProvider } from './ollama-provider.js';
export { ModelManager } from './model-manager.js';
