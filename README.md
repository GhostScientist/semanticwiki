# SemanticWiki

**SemanticWiki is the intellectual property of [reasoning.software](https://reasoning.software) (MadWatch LLC). Created by Dakota Kim.**

> Generate architectural documentation wikis with source code traceability

An AI-powered CLI that does two things:

1. **Generates architectural wikis** with source traceability (`file:line` references), Mermaid diagrams, and an optional interactive static site
2. **Works as an agentic coding assistant** with semantic (RAG) search over your codebase

**Built with [buildanagentworkshop.com](https://buildanagentworkshop.com)**

---

## Choose Your Mode: Cloud or Local

SemanticWiki can generate documentation three ways. **Pick one before you start** — it determines whether you need an API key at all.

| Mode | Flag | Requires | Billing | Best for |
|------|------|----------|---------|----------|
| **Claude Code** (default) | _none_ | Claude Code installed + credits | Claude Code account | Existing Claude Code users |
| **Direct API** | `--direct-api` | `ANTHROPIC_API_KEY` | Your Anthropic API credits | Most users with an API key |
| **Fully local** | `--full-local` | Capable hardware (see below) | **Free** — no API key, no cloud | Privacy, air-gapped, zero-cost runs |

```bash
# Cloud, via Claude Code subprocess (default)
semanticwiki generate -r ./my-project --site

# Cloud, directly against the Anthropic API with your key
semanticwiki generate -r ./my-project --site --direct-api

# 100% local — no API key, nothing leaves your machine
semanticwiki generate -r ./my-project --site --full-local
```

Notes on each mode:

- **Claude Code mode** spawns a Claude Code subprocess and uses its billing. If you hit a "Credit balance is too low" error here, switch to `--direct-api`.
- **Direct API mode** runs the same agentic loop against the Anthropic API using your `ANTHROPIC_API_KEY` (default model: `claude-sonnet-5`; override with `--model`).
- **Local mode** downloads a fine-tuned GGUF model (`gpt-oss-20b-semanticwiki`, ~22 GB one-time download) and runs inference on your machine via node-llama-cpp. Recommended: 24 GB VRAM or 32 GB RAM. You can also point it at an existing [Ollama](https://ollama.com) server with `--use-ollama`. See the **[Local Mode Guide](./docs/local-mode.md)** for hardware requirements, tuning, and troubleshooting.

In every mode, embeddings and semantic search always run locally — the mode only changes which LLM writes the documentation.

---

## Installation

```bash
npm install -g semanticwiki
```

**Prerequisites:**

- Node.js >= 18
- For cloud modes: an Anthropic API key from [console.anthropic.com](https://console.anthropic.com)
- For local mode: see the [Local Mode Guide](./docs/local-mode.md)

---

## Quick Start

```bash
# 1. Set your API key (skip this step for --full-local)
export ANTHROPIC_API_KEY=your-api-key-here

# 2. Generate a wiki + interactive site
semanticwiki generate -r ./my-project --site --direct-api

# Works with GitHub URLs too
semanticwiki generate -r https://github.com/user/repo --site --direct-api

# 3. View the results
#    Markdown wiki:    ./wiki/README.md
#    Interactive site: ./site/index.html  (generated next to the wiki directory)
```

Tip: run with `-e / --estimate` first for a dry-run time/cost estimate (in local mode this also checks your hardware and shows the recommended model).

---

## What You Get

The generated wiki contains an architecture overview with Mermaid diagrams, per-module documentation, data-flow docs, getting-started guides, and a glossary. Every concept links to specific source locations:

```markdown
The authentication system uses JWT tokens for stateless auth.

**Source:** [`src/auth/jwt-provider.ts:23-67`](../../../src/auth/jwt-provider.ts#L23-L67)
```

With `--site`, you also get a self-contained static site with full-text search (`/`), keyboard navigation, dark/light themes, rendered Mermaid diagrams, and — with `--ai-chat` — an AI assistant that runs entirely in the browser (SmolLM2 via transformers.js, works offline after the first model download).

---

## Commands

### `generate` — create a wiki

```bash
semanticwiki generate -r <repo-path-or-url> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-r, --repo <path/url>` | Repository path or GitHub/GitLab URL (required) | — |
| `-o, --output <dir>` | Output directory for wiki | `./wiki` |
| `-c, --config <file>` | Path to `wiki.json` config file | — |
| `-t, --token <token>` | Access token for private repos | `$GITHUB_TOKEN` |
| `-m, --model <model>` | Claude model (cloud modes) | `claude-sonnet-5` |
| `-p, --path <path>` | Focus on a specific directory | — |
| `-f, --force` | Force regeneration (ignore cache) | — |
| `-v, --verbose` | Show detailed progress | — |
| `-e, --estimate` | Estimate time/cost without running | — |
| `-s, --site` | Also generate the interactive static site | — |
| `--site-only` | Generate site from existing wiki markdown | — |
| `--site-title <title>` | Custom site title | `Architecture Wiki` |
| `--theme <theme>` | Site theme: `light`, `dark`, `auto` | `auto` |
| `--ai-chat` | Add the in-browser AI chat assistant to the site | — |
| `--direct-api` | **Mode:** use the Anthropic API directly | — |
| `--full-local` | **Mode:** run entirely locally, no API key | — |
| `--max-turns <n>` | Limit agent iterations | `200` |
| `--skip-index` | Reuse the cached embeddings index | — |
| `--max-chunks <n>` | Limit indexed chunks (large repos) | unlimited |
| `--max-results <n>` | Max search results per query | `10` |
| `--batch-size <n>` | Batched indexing for very large repos | — |
| `--compact-search` | Truncate search results to save tokens (auto for large repos) | — |

Local-mode-only options (`--local-model`, `--model-path`, `--use-ollama`, `--ollama-host`, `--gpu-layers`, `--context-size`, `--threads`) are documented in the [Local Mode Guide](./docs/local-mode.md).

### `continue` — finish an incomplete wiki

Verifies internal links and generates any missing pages.

```bash
semanticwiki continue -r ./my-project -o ./wiki
semanticwiki continue -r ./my-project -o ./wiki --verify-only   # check only
semanticwiki continue -r ./my-project -o ./wiki --skip-index    # faster iteration
```

Also supports `-m/--model`, `--direct-api`, `--max-turns`, `-v`.

### `verify` — check wiki completeness

```bash
semanticwiki verify -o ./wiki          # human-readable report
semanticwiki verify -o ./wiki --json   # JSON output; exit code 1 if incomplete
```

### `update-embeddings` / `update-wiki` — keep docs current

After new commits, update the RAG index and then the affected wiki pages:

```bash
semanticwiki update-embeddings -r ./my-project -o ./wiki          # incremental re-index
semanticwiki update-embeddings -r ./my-project -o ./wiki --full   # full re-index
semanticwiki update-wiki -r ./my-project -o ./wiki                # update affected pages
semanticwiki update-wiki -r ./my-project -o ./wiki --dry-run      # preview only
```

(`update-docs` also exists but currently re-runs full generation; prefer the two commands above.)

### `search` — search the wiki or the code index

```bash
semanticwiki search "authentication flow" -o ./wiki               # search wiki pages
semanticwiki search "token validation" -o ./wiki --code           # search code (RAG index)
semanticwiki search "login" -o ./wiki --code -m keyword           # mode: hybrid|vector|keyword
semanticwiki search "login" -o ./wiki --code --rerank             # cross-encoder reranking
```

Options: `-o, --output <dir>` (wiki dir, default `./wiki`), `-n, --max-results <n>` (default 10), `-m, --mode <mode>` (default `hybrid`), `--code`, `--rerank`.

### `mcp-server` — expose the wiki to AI assistants

Starts a stdio MCP server with wiki search/Q&A tools for Claude Desktop or Claude Code:

```bash
semanticwiki mcp-server -o ./wiki                     # wiki tools
semanticwiki mcp-server -o ./wiki -r ./my-project     # + code search
```

Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "my-wiki": {
      "command": "semanticwiki",
      "args": ["mcp-server", "-o", "/path/to/wiki"]
    }
  }
}
```

### `pack` / `unpack` — share portable wiki packages

Bundle a wiki (optionally with its RAG index) into a single `.archiwiki` file:

```bash
semanticwiki pack -o ./wiki -f ./my-wiki.archiwiki    # create (add --no-rag to exclude index)
semanticwiki unpack ./my-wiki.archiwiki -o ./extracted
semanticwiki unpack ./my-wiki.archiwiki --info        # inspect without extracting
semanticwiki unpack ./my-wiki.archiwiki --wiki-only   # skip the RAG index
```

### Coding assistant (default command)

Without a subcommand, SemanticWiki is a general-purpose coding agent (requires an API key):

```bash
semanticwiki "explain the auth flow in this repo"   # one-shot query
semanticwiki -i                                     # interactive session
semanticwiki -p "refactor the config loader"       # plan mode: review a plan before executing
```

The interactive session supports slash commands (`/help`, `/plan`, `/mcp-add`, custom commands from `.claude/commands/`, skills, and workflows) and loads the target repo's own `CLAUDE.md`.

### `config` — API key help

`semanticwiki config --show` displays the current API key source. Keys are read from `ANTHROPIC_API_KEY` (or legacy `CLAUDE_API_KEY`), including from a `.env` file in the working directory.

---

## Large Codebases

For repos with 10,000+ files:

```bash
semanticwiki generate -r ./large-project --max-chunks 5000   # cap memory usage
semanticwiki generate -r ./large-project --batch-size 3000   # batched indexing
semanticwiki generate -r ./large-project --max-results 5     # smaller search results
```

When the index exceeds 50k chunks, search automatically switches to fewer results and compact mode. Chunks are prioritized: core directories (`src/`, `lib/`, `app/`) and entry points score highest; tests and vendored code score lowest.

---

## Configuration (Optional)

Create a `wiki.json` in your project root to customize generation:

```json
{
  "repo_notes": [
    { "content": "Focus on the src/core directory for main logic" }
  ],
  "pages": [
    { "title": "Architecture Overview", "purpose": "High-level design", "parent": null },
    { "title": "Authentication", "parent": "Architecture Overview" }
  ],
  "exclude_patterns": ["**/*.test.ts", "**/__mocks__/**"],
  "output": {
    "format": "markdown",
    "diagrams": true
  }
}
```

---

## How It Works

- **[Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk)** or a hand-rolled tool-use loop (direct API / local modes) orchestrates the agent
- **RAG system**: AST-aware chunking at logical code boundaries; `BGE-small-en-v1.5` embeddings computed locally via `@huggingface/transformers` (cached in `./.semanticwiki-models`); FAISS vector search with a pure-JS fallback; hybrid BM25 + vector search fused with Reciprocal Rank Fusion; optional cross-encoder reranking
- **Incremental indexing**: only changed files are re-embedded on subsequent runs (index lives in `<wiki>/.semanticwiki-cache`)
- **Verification loop**: checks all internal wiki links and generates missing pages
- **[MCP](https://modelcontextprotocol.io)** for tool integration, **Mermaid** for diagrams

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Credit balance is too low" | Use `--direct-api` (your API credits) or `--full-local` (free) |
| No API key and don't want one | Use `--full-local` — see [Local Mode Guide](./docs/local-mode.md) |
| Out of memory on large repos | `--max-chunks 5000 --batch-size 3000` |
| Slow re-runs while iterating | `--skip-index` to reuse cached embeddings |
| Missing pages / broken links | `semanticwiki continue -r ./my-project -o ./wiki` |
| Local mode issues | See [Local Mode Guide](./docs/local-mode.md#troubleshooting) |

---

## Development

```bash
git clone https://github.com/GhostScientist/semanticwiki.git
cd semanticwiki
npm install
npm run build            # compile to dist/
npm test                 # run tests (vitest)
npm start -- generate -r ./my-project --verbose
```

More docs live in [`docs/`](./docs/README.md).

---

## License

MIT License — Copyright (c) 2025 Dakota Kim / reasoning.software (MadWatch LLC)

See [LICENSE](./LICENSE) for full terms. Attribution to Dakota Kim as the original creator is required in all forks and derivative works.
