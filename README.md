# SemanticWiki

Turn a codebase into architectural documentation that people and coding agents can navigate. Generate source-linked Markdown, publish a searchable site, and export an [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) catalog from the same wiki.

**Created by Dakota Kim / [reasoning.software](https://reasoning.software) (MadWatch LLC).**

## Get started

Requires **Node.js 24 or newer**. Native local inference supports hardware with a compatible node-llama-cpp build; run the diagnostics before a large job.

```bash
npm install -g semanticwiki
semanticwiki doctor

# Choose a writer and supply your own API key through your environment or .env.
export ANTHROPIC_API_KEY=your-key
semanticwiki generate -r ./my-project --provider anthropic --site

# Or use OpenAI:
export OPENAI_API_KEY=your-key
semanticwiki generate -r ./my-project --provider openai --site

# Or prepare the local model once, then generate without a cloud API key:
semanticwiki models prepare
semanticwiki generate -r ./my-project --provider local --site
```

The default writer is the **direct Anthropic API**. No provider silently falls back to another. Cloud writers send retrieved source code to the selected API; local generation keeps inference on your machine. Initial local model and embedding downloads still require network access.

Open `wiki/site/index.html` to read the result, or deploy the contents of `wiki/site/` to any static host. The default output directory is `./wiki`; use `-o` to choose another.

## Choose your provider

| Provider | Authentication / setup | Default writer |
| --- | --- | --- |
| `anthropic` | Your `ANTHROPIC_API_KEY` | `claude-sonnet-5-5` |
| `openai` | Your `OPENAI_API_KEY` | `gpt-6.1-sol` via Responses API |
| `local` | `semanticwiki models prepare` | SemanticWiki Coder 7B v2, Q4_K_M |
| `ollama` | A running Ollama server and an installed model | Set `--local-model` to your installed model |
| `claude-code` | Your configured Claude Code / Agent SDK environment | Claude; retains the previous execution mode |

Use `--model` for a cloud model ID, `--model-path` for an existing GGUF, or `--local-model` for a registered local / Ollama model. `SEMANTICWIKI_PROVIDER` and `SEMANTICWIKI_MODEL` set defaults; flags take precedence. Each user supplies their own credentials. Keys are never bundled with the package, site, or exported wiki.

Existing scripts can retain `--direct-api` (Anthropic), `--full-local` (bundled inference), and `--full-local --use-ollama`. Contradictory flags fail with an explanation. See [model and provider details](docs/models.md) and the [local guide](docs/local-mode.md).

## The documentation workflow

```bash
# Generate; all providers produce the same Markdown and agent export structure.
semanticwiki generate -r . --provider anthropic --site

# Inspect the existing wiki without a model or credentials.
semanticwiki verify -o ./wiki --json
semanticwiki search "authentication flow" -o ./wiki --json
semanticwiki preview -o ./wiki --theme dark

# Repair missing pages. --yes makes approval explicit in automation.
semanticwiki continue -r . -o ./wiki --provider openai --yes

# Inspect changes and update affected documentation.
semanticwiki update-wiki -r . -o ./wiki --dry-run
semanticwiki update-wiki -r . -o ./wiki --provider anthropic --yes
semanticwiki update-embeddings -r . -o ./wiki
semanticwiki preview -o ./wiki
```

`verify` checks page existence and internal Markdown links. It does **not** certify that the generated explanation is factually correct or that every source citation is current. Review the wiki against its sources before publishing. Empty or incomplete generation returns a nonzero exit status; partial pages remain available for inspection and `continue`.

`update-wiki` compares current source contents with the last completed documentation snapshot. When that fingerprint changes, it conservatively refreshes **all existing wiki pages**, including pages about deleted untracked files or dirty files later reverted to Git HEAD. This costs more than a selective update; use `--dry-run` to inspect the scope first. Legacy wikis without a fingerprint use Git changes and source-reference heuristics. `update-docs` remains a broader regeneration command. Documentation commits and content fingerprints are tracked separately from the retrieval index, so refreshing embeddings does not hide pending documentation changes.

The bare `semanticwiki` command shows help. The older coding assistant remains available through an explicit query or `--interactive`.

## Agents and coding harnesses

Each successful generation exports a separate **OKF 0.2** bundle while preserving the human wiki. Existing wikis can be exported without a model:

```bash
semanticwiki export -o ./wiki -r ./my-project --json
semanticwiki search "request lifecycle" -o ./wiki --json
semanticwiki mcp-server -o ./wiki -r ./my-project
```

Start with `wiki/llms.txt`, then `wiki/knowledge/index.md`. The catalog includes typed concept pages, directory indexes, source-page identities and a machine-readable manifest. Generated content is not automatically promoted to verified knowledge.

An MCP client configuration:

```json
{
  "mcpServers": {
    "project-wiki": {
      "command": "semanticwiki",
      "args": ["mcp-server", "-o", "/absolute/path/to/wiki", "-r", "/absolute/path/to/project"]
    }
  }
}
```

The server supports discovery, page and section reads, related-page navigation, wiki search and optional indexed code search. Results are bounded and structured for agents. See the [agent integration guide](docs/AGENT_INTEGRATION.md) for tools, resources and format details.

## A readable, portable site

`--site` or `preview` creates a responsive reader with light/dark themes, page navigation, table of contents, Markdown copy/download, an agent entry point, and keyboard-accessible search. Text, navigation, and search work from `file://` and when hosted under a subpath.

Mermaid diagrams and syntax highlighting use optional CDN enhancements. Browser AI chat is **opt-in** with `--ai-chat`; it needs first-use model downloads and compatible browser capabilities. The basic reader does not download a language model.

```text
wiki/
├── README.md or index.md       Human entry point
├── architecture/…             Source-linked Markdown
├── knowledge/                 OKF catalog for agents
│   ├── index.md
│   ├── manifest.json
│   └── concepts/…
├── llms.txt                   Agent discovery entry point
├── .semanticwiki-run.json      Last finalized run and structural verification
├── .semanticwiki-cache/        Portable code index
└── site/                      Deployable reader, Markdown and agent exports
```

## Storage that stays out of your source tree

Shared weights, embeddings and remote checkouts use `~/.semanticwiki/` by default:

| Location | Contents |
| --- | --- |
| `~/.semanticwiki/models/` | Shared GGUF model weights |
| `~/.semanticwiki/cache/embeddings/` | Transformer / embedding downloads |
| `~/.semanticwiki/cache/repos/` | Remote repository checkouts, keyed by URL |
| `<wiki>/.semanticwiki-cache/` | That wiki's portable retrieval index |

Set `SEMANTICWIKI_HOME` to an **absolute path** to relocate managed storage, or `SEMANTICWIKI_MODELS_DIR` to relocate GGUF weights only. `doctor` shows actual paths and reports old working-directory caches. Legacy directories are left untouched; see the [migration notes](docs/LAUNCH_BASELINE.md) before removing them.

The default local writer is [GhostScientist/semanticwiki-coder-7b-v2-gguf](https://huggingface.co/GhostScientist/semanticwiki-coder-7b-v2-gguf). The 4.68 GB download is pinned to a revision and verified by size and SHA-256 before use. Start with the 8,192-token context default; memory use also includes embeddings and inference buffers.

## Useful options

Run `semanticwiki <command> --help` for the complete reference.

| Task | Option / command |
| --- | --- |
| Limit indexing memory | `generate --max-chunks 5000` |
| Reduce retrieval payload | `generate --max-results 5 --compact-search` |
| Bound cloud work | `generate --max-turns 30` |
| Use an existing index deliberately | `generate --skip-index` |
| Preview repository size | `generate --estimate` (rough heuristic, not a billing quote) |
| Improve chunk context | `generate --contextual` (extra Anthropic requests) or `--contextual-local` |
| Search cached code without an embedding download | `search "term" --code --mode keyword --json` |
| Check local weights | `models list`, `models verify` |
| Share a wiki and its index | `pack -o ./wiki -f ./project.semantics` |
| Extract a package | `unpack ./project.semantics -o ./extracted` |

`.archiwiki` packages remain readable. `.semantics` is the default extension for new packages. The package contains documentation and index artifacts, not shared model weights or API keys.

## Development

```bash
git clone https://github.com/GhostScientist/semanticwiki.git
cd semanticwiki
npm ci --ignore-scripts
npm run check
npm run test:coverage
npm pack --dry-run --ignore-scripts
```

The default tests use fixtures and fake providers; they do not require API keys or large downloads. See [CONTRIBUTING.md](CONTRIBUTING.md) for native/live smoke tests, release checks and project structure. Historical plans are under [docs/plans](docs/README.md); they are not promises about implemented features.

## License

MIT. Copyright (c) 2025 Dakota Kim / reasoning.software (MadWatch LLC). See [LICENSE](LICENSE).
