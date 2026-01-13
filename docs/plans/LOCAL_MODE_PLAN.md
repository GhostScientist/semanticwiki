# Local Mode Implementation Plan

## Overview

This document outlines the implementation plan for adding a `--full-local` flag to the `ted-mosby generate` command, enabling complete offline operation using local language models.

## Current Architecture Analysis

### Already Local Components ✅

| Component | Technology | Location |
|-----------|------------|----------|
| **Embeddings** | Transformers.js (`all-MiniLM-L6-v2`) | `src/rag/index.ts` |
| **Vector Database** | FAISS (`faiss-node`) | `src/rag/index.ts` |
| **Code Chunking** | TypeScript Compiler AST | `src/ast-chunker.ts` |
| **File Operations** | Node.js fs | `src/tools/file-operations.ts` |
| **Wiki Verification** | In-process link checking | `src/wiki-agent.ts` |
| **Site Generation** | Marked (Markdown→HTML) | `src/site-generator.ts` |

### Cloud-Dependent Components ☁️

| Component | Current Implementation | Location |
|-----------|----------------------|----------|
| **LLM Reasoning** | Claude API via `@anthropic-ai/sdk` | `src/wiki-agent.ts:698-932` |
| **Agent Orchestration** | Claude Agent SDK | `src/agent.ts`, `src/wiki-agent.ts` |

**Key Finding:** The `--direct-api` mode in `generateWikiDirectApi()` already implements a manual tool-calling loop that is perfect for local model integration.

---

## Proposed Solution

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         ted-mosby CLI                            │
│                                                                  │
│   --full-local flag → LocalLLMProvider                          │
│   (default)         → AnthropicProvider                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      LLM Provider Interface                      │
│                                                                  │
│   interface LLMProvider {                                        │
│     chat(messages, tools, options): Promise<LLMResponse>        │
│     getModelInfo(): ModelInfo                                   │
│   }                                                              │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────┐
│   AnthropicProvider     │     │    OllamaProvider       │
│                         │     │                         │
│ - client.messages.create│     │ - ollama.chat()         │
│ - Tool use support      │     │ - Tool use support      │
│ - Streaming optional    │     │ - Streaming optional    │
└─────────────────────────┘     └─────────────────────────┘
                                          │
                                          ▼
                              ┌─────────────────────────┐
                              │   Local Model Options   │
                              │                         │
                              │ - Llama 3.1 70B/405B    │
                              │ - Qwen 2.5 72B Coder    │
                              │ - DeepSeek Coder V2     │
                              │ - Mistral Large         │
                              │ - Codestral             │
                              └─────────────────────────┘
```

### Technology Choice: Ollama

**Why Ollama?**
1. **Easy Setup** - Single binary, no Python dependencies
2. **OpenAI-Compatible API** - Well-documented, easy to integrate
3. **Tool/Function Calling** - Native support in recent versions
4. **Model Management** - Pull models with simple commands
5. **Cross-Platform** - macOS, Linux, Windows
6. **Active Development** - Strong community, frequent updates
7. **Resource Management** - Automatic GPU detection, memory management

**Alternative Providers (Future Extension):**
- `llama.cpp` server - Lower level, maximum performance
- `vLLM` - Production-grade, high throughput
- `LocalAI` - OpenAI API drop-in replacement
- `LM Studio` - GUI-based, beginner friendly

---

## Implementation Phases

### Phase 1: LLM Provider Abstraction

**Goal:** Create a clean abstraction layer for LLM providers

**New Files:**
```
src/llm/
├── index.ts              # Exports and factory function
├── types.ts              # Shared types and interfaces
├── anthropic-provider.ts # Existing Claude integration
├── ollama-provider.ts    # New Ollama integration
└── prompt-adapter.ts     # Model-specific prompt formatting
```

**Core Interface:**

```typescript
// src/llm/types.ts

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentBlock[];
  tool_call_id?: string;
  name?: string;
}

export interface LLMTool {
  name: string;
  description: string;
  parameters: JSONSchema;
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMResponse {
  content: string;
  toolCalls: LLMToolCall[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'error';
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface LLMProviderOptions {
  model: string;
  maxTokens: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface LLMProvider {
  chat(
    messages: LLMMessage[],
    tools: LLMTool[],
    options: LLMProviderOptions
  ): Promise<LLMResponse>;

  stream?(
    messages: LLMMessage[],
    tools: LLMTool[],
    options: LLMProviderOptions
  ): AsyncIterable<LLMStreamChunk>;

  getModelInfo(): {
    name: string;
    contextLength: number;
    supportsTools: boolean;
    supportsStreaming: boolean;
  };
}
```

### Phase 2: Ollama Provider Implementation

**Dependency:**
```json
{
  "dependencies": {
    "ollama": "^0.5.0"
  }
}
```

**Implementation:**

```typescript
// src/llm/ollama-provider.ts

import { Ollama } from 'ollama';
import type { LLMProvider, LLMMessage, LLMTool, LLMResponse, LLMProviderOptions } from './types';

export class OllamaProvider implements LLMProvider {
  private client: Ollama;
  private modelName: string;

  constructor(options: {
    host?: string;  // Default: http://localhost:11434
    model: string;
  }) {
    this.client = new Ollama({ host: options.host });
    this.modelName = options.model;
  }

  async chat(
    messages: LLMMessage[],
    tools: LLMTool[],
    options: LLMProviderOptions
  ): Promise<LLMResponse> {
    const ollamaMessages = this.convertMessages(messages);
    const ollamaTools = this.convertTools(tools);

    const response = await this.client.chat({
      model: options.model || this.modelName,
      messages: ollamaMessages,
      tools: ollamaTools,
      options: {
        num_predict: options.maxTokens,
        temperature: options.temperature ?? 0.7,
      },
    });

    return this.convertResponse(response);
  }

  private convertMessages(messages: LLMMessage[]): OllamaMessage[] {
    // Convert from our format to Ollama format
    // Handle tool results, multimodal content, etc.
  }

  private convertTools(tools: LLMTool[]): OllamaTool[] {
    // Convert tool definitions to Ollama format
    // Ollama uses OpenAI-compatible function calling
  }

  private convertResponse(response: OllamaResponse): LLMResponse {
    // Extract tool calls, content, usage stats
  }

  getModelInfo() {
    return {
      name: this.modelName,
      contextLength: 128000, // Varies by model
      supportsTools: true,
      supportsStreaming: true,
    };
  }
}
```

### Phase 3: CLI Integration

**Modified Files:**
- `src/cli.ts` - Add `--full-local` flag and related options
- `src/wiki-agent.ts` - Use LLM provider abstraction

**New CLI Options:**

```typescript
// src/cli.ts additions

program
  .command('generate')
  .description('Generate architecture wiki')
  .option('--full-local', 'Use local models for all operations (requires Ollama)')
  .option('--local-model <model>', 'Local model to use (default: qwen2.5-coder:32b)', 'qwen2.5-coder:32b')
  .option('--ollama-host <url>', 'Ollama server URL (default: http://localhost:11434)', 'http://localhost:11434')
  .option('--local-context-size <size>', 'Context window size for local model', '32768')
  // ... existing options
```

**Environment Variables:**

```bash
# .env support
OLLAMA_HOST=http://localhost:11434
LOCAL_MODEL=qwen2.5-coder:32b
LOCAL_CONTEXT_SIZE=32768
```

### Phase 4: Prompt Adaptation

**Challenge:** Local models may need different prompting strategies than Claude.

**Solution:** Create a prompt adapter that adjusts system prompts and instructions based on the model.

```typescript
// src/llm/prompt-adapter.ts

export interface PromptAdapter {
  adaptSystemPrompt(basePrompt: string): string;
  adaptToolDescription(tool: LLMTool): LLMTool;
  getModelSpecificInstructions(): string;
}

export class OllamaPromptAdapter implements PromptAdapter {
  constructor(private modelFamily: 'llama' | 'qwen' | 'mistral' | 'deepseek') {}

  adaptSystemPrompt(basePrompt: string): string {
    // Add model-specific instructions
    // Simplify complex instructions for smaller models
    // Add explicit tool-use formatting guidance

    const additions = `
## Tool Use Guidelines

When you need to use a tool, respond with a tool call in the following format:
- Call tools one at a time when possible
- Wait for tool results before proceeding
- Always verify your work using the verification tools

## Response Guidelines

- Be concise but thorough
- Include source file references for all claims
- Generate Mermaid diagrams for architecture visualization
`;

    return basePrompt + additions;
  }
}
```

### Phase 5: Local Model Recommendations

**Recommended Models by Hardware:**

| Hardware | Recommended Model | Context | Notes |
|----------|------------------|---------|-------|
| **64GB+ RAM, GPU 24GB+** | `qwen2.5-coder:32b` | 128K | Best quality |
| **32GB RAM, GPU 16GB** | `qwen2.5-coder:14b` | 128K | Good balance |
| **16GB RAM, GPU 8GB** | `qwen2.5-coder:7b` | 32K | Minimum viable |
| **Apple M1/M2/M3 Max** | `qwen2.5-coder:32b` | 128K | Unified memory |
| **Apple M1/M2/M3 Pro** | `qwen2.5-coder:14b` | 64K | Good performance |

**Why Qwen 2.5 Coder?**
1. Excellent code understanding
2. Strong instruction following
3. Native tool/function calling support
4. Large context windows (128K)
5. Permissive license (Apache 2.0)
6. Active maintenance by Alibaba

**Alternative Models:**
- `deepseek-coder-v2:16b` - Strong code reasoning
- `codestral:22b` - Mistral's code model
- `llama3.1:70b` - General purpose, very capable
- `mistral-large:123b` - If you have the hardware

---

## Detailed File Changes

### 1. New File: `src/llm/types.ts`

Complete type definitions for the LLM abstraction layer.

### 2. New File: `src/llm/index.ts`

```typescript
import { AnthropicProvider } from './anthropic-provider';
import { OllamaProvider } from './ollama-provider';
import type { LLMProvider } from './types';

export interface CreateProviderOptions {
  type: 'anthropic' | 'ollama';
  model: string;
  apiKey?: string;      // For Anthropic
  host?: string;        // For Ollama
}

export function createLLMProvider(options: CreateProviderOptions): LLMProvider {
  switch (options.type) {
    case 'anthropic':
      return new AnthropicProvider({
        apiKey: options.apiKey || process.env.ANTHROPIC_API_KEY!,
        model: options.model,
      });
    case 'ollama':
      return new OllamaProvider({
        host: options.host || 'http://localhost:11434',
        model: options.model,
      });
    default:
      throw new Error(`Unknown provider type: ${options.type}`);
  }
}

export * from './types';
export { AnthropicProvider } from './anthropic-provider';
export { OllamaProvider } from './ollama-provider';
```

### 3. Modified: `src/wiki-agent.ts`

**Key Changes:**

```typescript
// Before (line ~700)
const client = new Anthropic();
const response = await client.messages.create({...});

// After
const provider = createLLMProvider({
  type: this.options.fullLocal ? 'ollama' : 'anthropic',
  model: this.options.fullLocal ? this.options.localModel : this.options.model,
  host: this.options.ollamaHost,
  apiKey: this.options.apiKey,
});

const response = await provider.chat(messages, tools, {
  model: this.options.model,
  maxTokens: 8192,
  systemPrompt: WIKI_SYSTEM_PROMPT,
});
```

### 4. Modified: `src/cli.ts`

Add new options to the generate command and pass them through to WikiAgent.

---

## Configuration

### New Config File: `~/.ted-mosby/local-config.json`

```json
{
  "ollama": {
    "host": "http://localhost:11434",
    "defaultModel": "qwen2.5-coder:32b",
    "contextSize": 32768
  },
  "localMode": {
    "autoDetect": true,
    "fallbackToCloud": false,
    "maxRetries": 3
  },
  "performance": {
    "batchSize": 50,
    "parallelChunks": 4
  }
}
```

### Environment Variables

```bash
# Local mode configuration
FULL_LOCAL=true
OLLAMA_HOST=http://localhost:11434
LOCAL_MODEL=qwen2.5-coder:32b
LOCAL_CONTEXT_SIZE=32768

# Disable cloud fallback
NO_CLOUD_FALLBACK=true
```

---

## User Experience

### Setup Flow

```bash
# 1. Install Ollama (one-time)
curl -fsSL https://ollama.com/install.sh | sh

# 2. Pull recommended model
ollama pull qwen2.5-coder:32b

# 3. Run ted-mosby in local mode
ted-mosby generate ./my-project --full-local

# Or with specific model
ted-mosby generate ./my-project --full-local --local-model codestral:22b
```

### Progress Output

```
🏠 Running in full local mode
📦 Model: qwen2.5-coder:32b via Ollama
🔍 Indexing repository...
  ├─ Parsed 245 files
  ├─ Generated 1,247 chunks
  └─ Created embeddings (local)

📝 Generating wiki...
  ├─ Phase 1: Discovery [████████░░] 80%
  │   └─ Analyzing architecture patterns...
  ├─ Phase 2: Planning [░░░░░░░░░░] 0%
  ├─ Phase 3: Content Generation [░░░░░░░░░░] 0%
  └─ Phase 4: Verification [░░░░░░░░░░] 0%

⚡ Local inference: ~2.3 tokens/sec
📊 Memory usage: 18.4 GB
```

### Error Handling

```bash
# If Ollama not running
$ ted-mosby generate ./project --full-local
Error: Cannot connect to Ollama at http://localhost:11434

  To use --full-local mode, ensure Ollama is running:
    $ ollama serve

  Or specify a different host:
    $ ted-mosby generate ./project --full-local --ollama-host http://192.168.1.100:11434

# If model not available
$ ted-mosby generate ./project --full-local --local-model llama3.1:405b
Error: Model 'llama3.1:405b' not found in Ollama

  Available models:
    - qwen2.5-coder:32b
    - codestral:22b

  Pull the model first:
    $ ollama pull llama3.1:405b
```

---

## Performance Considerations

### Expected Performance

| Metric | Claude API | Local (32B) | Local (14B) | Local (7B) |
|--------|------------|-------------|-------------|------------|
| Tokens/sec | ~80 | ~15-25 | ~30-50 | ~60-100 |
| Wiki gen time (small repo) | ~5 min | ~15-20 min | ~10-15 min | ~8-12 min |
| Wiki gen time (large repo) | ~30 min | ~2-3 hours | ~1-2 hours | ~45-90 min |
| Quality | Excellent | Very Good | Good | Acceptable |

### Optimization Strategies

1. **Batch Processing** - Process multiple small requests together
2. **Caching** - Cache intermediate LLM responses
3. **Streaming** - Show progress during generation
4. **Chunked Generation** - Break large wikis into smaller pieces
5. **Model Quantization** - Use Q4_K_M or Q5_K_M for better speed

---

## Testing Plan

### Unit Tests

```typescript
// tests/llm/ollama-provider.test.ts
describe('OllamaProvider', () => {
  it('should convert messages to Ollama format');
  it('should handle tool calls correctly');
  it('should parse tool results');
  it('should handle streaming responses');
  it('should report usage statistics');
});
```

### Integration Tests

```typescript
// tests/integration/local-mode.test.ts
describe('Local Mode Integration', () => {
  it('should generate wiki for small repo');
  it('should handle tool calling loop');
  it('should recover from model errors');
  it('should respect context limits');
});
```

### Manual Testing

1. Test with various repository sizes
2. Test different local models
3. Test on different hardware configurations
4. Compare output quality with Claude baseline

---

## Implementation Checklist

### Phase 1: Foundation (Week 1)
- [ ] Create `src/llm/` directory structure
- [ ] Define `LLMProvider` interface and types
- [ ] Implement `AnthropicProvider` (extract from existing code)
- [ ] Add unit tests for provider interface

### Phase 2: Ollama Integration (Week 2)
- [ ] Add `ollama` package dependency
- [ ] Implement `OllamaProvider` class
- [ ] Handle tool/function calling conversion
- [ ] Add streaming support
- [ ] Test with Qwen 2.5 Coder models

### Phase 3: CLI Integration (Week 3)
- [ ] Add `--full-local` flag to CLI
- [ ] Add `--local-model` and `--ollama-host` options
- [ ] Update WikiAgent to use provider abstraction
- [ ] Add connection testing and error handling
- [ ] Update help text and documentation

### Phase 4: Prompt Optimization (Week 4)
- [ ] Create `PromptAdapter` for model-specific prompts
- [ ] Test and tune prompts for Qwen models
- [ ] Add fallback strategies for smaller models
- [ ] Document model-specific behaviors

### Phase 5: Polish & Documentation (Week 5)
- [ ] Add progress indicators for local mode
- [ ] Create setup documentation
- [ ] Add troubleshooting guide
- [ ] Performance benchmarking
- [ ] Update README with local mode instructions

---

## Future Enhancements

1. **Multiple Provider Support** - Add vLLM, LocalAI, LM Studio backends
2. **Hybrid Mode** - Use local for embeddings, cloud for generation
3. **Model Auto-Selection** - Detect hardware and recommend model
4. **Distributed Inference** - Support multiple Ollama instances
5. **Fine-Tuning Support** - Allow custom LoRA adapters
6. **Quantization Options** - Support different quantization levels

---

## Appendix: Message Format Conversion

### Anthropic → Ollama Tool Calling

```typescript
// Anthropic format
{
  role: 'assistant',
  content: [
    { type: 'text', text: 'Let me search...' },
    { type: 'tool_use', id: 'toolu_123', name: 'search_codebase', input: { query: 'auth' } }
  ]
}

// Ollama format
{
  role: 'assistant',
  content: 'Let me search...',
  tool_calls: [
    {
      function: {
        name: 'search_codebase',
        arguments: '{"query":"auth"}'
      }
    }
  ]
}
```

### Tool Results

```typescript
// Anthropic format
{
  role: 'user',
  content: [
    { type: 'tool_result', tool_use_id: 'toolu_123', content: 'Found 5 results...' }
  ]
}

// Ollama format
{
  role: 'tool',
  content: 'Found 5 results...'
}
```

---

## Summary

The local mode implementation is **highly feasible** because:

1. **80% of the work is already done** - Embeddings, vector search, chunking, and all tools are local
2. **Clean architecture** - The `--direct-api` mode provides a perfect foundation
3. **Mature tooling** - Ollama provides reliable local model serving
4. **Quality models available** - Qwen 2.5 Coder offers excellent code understanding

The main trade-off is **speed vs. privacy/cost**:
- Local mode will be 3-5x slower than Claude API
- Local mode requires no API costs and works fully offline
- Quality with 32B+ models approaches Claude quality for most tasks
