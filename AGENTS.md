# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project Overview

SemanticWiki is an AI-powered CLI (published to npm as `semanticwiki`) that generates architectural documentation wikis with source traceability (`file:line` references), and doubles as an agentic coding assistant. Built on the Claude Agent SDK with a local RAG system for semantic code search.

## Commands

```bash
npm run build          # Compile TypeScript to dist/ (tsc)
npm run dev            # Watch mode compilation
npm test               # Run all tests (vitest run)
npm run test:watch     # Vitest watch mode
npm run test:coverage  # Tests with v8 coverage

# Run a single test file
npx vitest run tests/chat-scripts.test.ts

# Run tests matching a name
npx vitest run -t "codemap"

# Run the CLI locally (build first — entry point is dist/cli.js)
npm start -- generate -r ./some-project --verbose
```

There is no linter configured. Tests live in `tests/` and have a 30s timeout (some load ML models). `scripts/release.sh` handles version bump + publish.

## Architecture

TypeScript ESM project (`"type": "module"`, Node >= 18). Local imports must use `.js` extensions (e.g. `import { RAGSystem } from './rag/index.js'`). Compiled with plain `tsc`, no bundler. CommonJS-only deps (e.g. `faiss-node`) are loaded via `createRequire(import.meta.url)`.

### Entry point and commands

`src/cli.ts` (commander) defines all commands: `generate`, `continue`, `update-docs`, `update-embeddings`, `update-wiki`, `verify`, `search`, `mcp-server`, `pack`, `unpack`, `config`, plus a default argument form (`semanticwiki "query"` / `-i`) that runs the general coding assistant.

### Two agents

- **`ArchitecturalWikiAgent`** (`src/wiki-agent.ts`, the core of the project) — generates the wiki. Indexes the repo with the RAG system, then runs an agentic loop with custom MCP tools (semantic search, file read, wiki page write). System prompt lives in `src/prompts/wiki-system.ts`. Includes a verification loop (`continue`/`verify` commands) that checks wiki links and generates missing pages, and an `updateContext` path for surgical wiki updates when code changes.
- **`DevelopmentAgentAgent`** (`src/agent.ts`) — general-purpose coding assistant with file/command tools, gated by `PermissionManager` (`src/permissions.ts`). Loads the target repo's own CLAUDE.md/skills/commands via `src/claude-config.ts`.

### Three execution modes for generation

The wiki agent branches on options in `WikiGenerationOptions`:

1. **Default** — Claude Agent SDK `query()` (spawns Claude Code subprocess, uses its billing).
2. **`--direct-api`** — hand-rolled tool-use loop against the Anthropic API via the LLM provider layer (uses `ANTHROPIC_API_KEY` credits directly).
3. **`--full-local`** — same loop, but with a local model; no API key required.

Modes 2 and 3 share the same code path (`generateWithDirectAPI` in `wiki-agent.ts`) via the provider abstraction.

### LLM provider layer (`src/llm/`)

`createLLMProvider()` in `src/llm/index.ts` is the factory. Implementations of the `LLMProvider` interface (`types.ts`):

- `AnthropicProvider` — cloud Claude API, default model `claude-sonnet-5`
- `LocalLlamaProvider` — bundled inference via node-llama-cpp (GGUF models, gpt-oss family)
- `OllamaProvider` — external Ollama server

`ModelManager` (`model-manager.ts`) handles hardware detection, model recommendation, and GGUF downloads.

### RAG system (`src/rag/index.ts` + `src/ast-chunker.ts`)

Powers both wiki generation and the `search`/`mcp-server` commands:

- AST-aware chunking (`ASTChunker`) at logical code boundaries with business-domain hints
- BGE-small-en-v1.5 embeddings via `@huggingface/transformers`, cached in `./.semanticwiki-models`
- FAISS (`IndexFlatIP`) vector search with a JS fallback when faiss-node is unavailable
- Hybrid search: BM25 + vector similarity fused with Reciprocal Rank Fusion; optional cross-encoder reranking
- Incremental indexing (only re-embeds changed files) and chunk prioritization for large repos (`--max-chunks`, `--batch-size`)

### Static site generator (`src/site-generator.ts` + `src/site/`)

Converts the markdown wiki into a self-contained interactive site. The entire site's HTML/CSS/JS is embedded as template strings in `src/site/templates.ts`, `styles.ts`, and `scripts.ts` — editing the generated site means editing these TS files. The `--ai-chat` feature runs SmolLM2 client-side in the browser via transformers.js; most tests in `tests/` cover this site/chat generation.

### Supporting modules

- `src/mcp-wiki-server.ts` — stdio MCP server exposing wiki search/Q&A tools to Claude Desktop/Claude Code
- `src/mcp-config.ts` — loads external MCP servers for the agents to use
- `src/package-format.ts` — `.archiwiki` pack/unpack format (wiki + RAG index)
- `src/planner.ts` / `src/workflows.ts` — plan mode and declarative multi-step workflows for the assistant
