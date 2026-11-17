# Working on SemanticWiki

SemanticWiki generates, verifies, searches and publishes source-linked codebase wikis. Documentation maintenance is the primary product. The older coding assistant is retained behind an explicit query / interactive mode.

## Development

Use Node 24+ and TypeScript ESM imports with `.js` suffixes. The compiler is plain `tsc`; no bundler or linter is configured.

```bash
npm ci --ignore-scripts
npm run check          # build, tests, isolated compiled-CLI contracts
npm run test:coverage
npm pack --dry-run --ignore-scripts
```

CI covers Node 24 and 26, package contents and a high/critical dependency audit. Default tests use fixture data, fake providers and in-memory MCP transports; they must not require secrets or large model downloads. Native/live checks are separate and documented in CONTRIBUTING.md.

## Architecture

- `src/cli.ts`: command routing and wiki workflow. `cli-options.ts` resolves explicit provider choices and legacy aliases before side effects. `cli-management.ts` registers diagnostics, model preparation and export commands.
- `src/wiki-agent.ts`: source retrieval, generation, repair and structural verification. Direct Anthropic/OpenAI and local providers share a tool abstraction; local initial generation uses page-by-page planning. Always consume error events as failures and release providers in `finally`.
- `src/local-page.ts`: the local writer's page contract: line-numbered evidence windows (`### FILE: path (lines a-b of n)`), the versioned page and repair prompts. Pure functions; `research/semanticwiki_reward/evidence.py` mirrors them and `tests/fixtures/prompt-conformance.json` holds both to the same text. Bump `LOCAL_PAGE_PROMPT_VERSION` with any wording change.
- `src/eval/`: citation grammar and verification against the repository, structure and lightweight Mermaid checks, the page reward with anti-gaming guards, wiki-level reports and paired comparison. `research/semanticwiki_reward/reward.py` mirrors it; `tests/fixtures/reward-conformance.json` is the shared contract. Bump `REWARD_VERSION` together with any scoring change. Verification is structural: a resolving citation does not prove the claim.
- `src/trajectory.ts`: opt-in JSONL capture of local page attempts (`--trajectories`). Records must contain everything needed to re-score the attempt offline.
- `src/llm/`: cloud/local/Ollama implementations. Use `assistantMessageFromResponse` to preserve complete thinking, tool and Responses continuation state. Defaults are centralized in `defaults.ts`; never silently substitute another provider/model.
- `src/runtime-paths.ts`: shared weights, embedding downloads and repository clones. Paths default under `~/.semanticwiki`, never the caller's repository. `SEMANTICWIKI_HOME` and `SEMANTICWIKI_MODELS_DIR` overrides must be absolute. Per-wiki code indexes remain portable under `<wiki>/.semanticwiki-cache`.
- `src/rag/`: EmbeddingGemma 2 via Transformers.js, AST chunking, contextual enrichment, FAISS and BM25. Model and source provenance determine cache compatibility. Keyword search must not download embedding weights.
- `src/discovery/`: heuristic source/domain discovery. Do not treat language constructs or generic entities as evidence of business functionality; retain unmatched source files under a neutral category.
- `src/wiki-catalog.ts`: common Markdown discovery, heading IDs, links and metadata for agents. Exclude `knowledge/`, `site/`, hidden paths, dependencies and symlinks from human page discovery.
- `src/knowledge-export.ts`: OKF 0.2 catalog. Preserve human pages and existing trust metadata; do not manufacture verification. Maintain managed-file ownership and protect unrelated content.
- `src/mcp-wiki-server.ts`: read-only stdio MCP. Keep protocol stdout clean; diagnostics go to stderr. Provide bounded reads, discovery, structured search and related-page navigation.
- `src/site-generator.ts` and `src/site/`: generated reader. Use a per-instance Marked renderer, sanitize Markdown/inline config, and use page-relative URLs so file access and arbitrary hosted subpaths work. AI chat remains opt-in.
- `src/package-format.ts`: portable `.semantics` package, with legacy `.archiwiki` reading. Preserve knowledge manifest/ownership, llms.txt and per-wiki retrieval cache on roundtrip. Never include shared model weights or credentials.
- `src/safe-path.ts`: contain model-provided source and output paths; guard traversal and symlinks.
- `src/agent.ts`, `permissions.ts`, `planner.ts`, `workflows.ts`: legacy coding-assistant surface.

## Changes and evidence

Preserve existing command aliases. Add behavioral regression coverage for provider roundtrips, failure/cancellation, path boundaries, export compatibility and CLI machine output. Test an actual generated site, not just source-template strings. Check fixture sites in a browser when navigation or layout changes.

`verify` proves structural link completeness and `eval` proves citation resolution, not factual correctness. Local pages receive a `verified` event only when every citation resolves; never add one on other grounds. Keep claims in docs and status output within what was tested. Historical plans under `docs/plans/` are context, not implemented capabilities. See docs/LAUNCH_BASELINE.md for the consolidation decisions and remaining launch checks.
