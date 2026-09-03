# SemanticWiki — Feature Roadmap

_Last updated: 2026-09-01_

The "LLM wiki" pattern (DeepWiki-style auto-generated, chat-queryable repo docs) is
gaining momentum. SemanticWiki already has the hard parts — agentic generation
(Claude Agent SDK or local llama.cpp/Ollama), AST-aware chunking, hybrid RAG
(FAISS + BM25 + RRF), Mermaid diagrams, source-line traceability, a static site
with client-side chat, and an MCP server. The gap versus the current trend is that
the wiki is a **one-shot artifact**, not a living, always-current surface.

This document ranks candidate next features by leverage. Items are independent
unless noted; **#1 depends on #2** being solid.

---

## ★ 1. GitHub Action — auto-refresh the wiki on push

**The "always-current" play, and the biggest adoption lever.** A reusable Action
(and a `.github/workflows` template) that regenerates the wiki on every push /
merge and commits it back (or publishes to GitHub Pages / an artifact).

- **Why now:** "docs that never go stale" is the headline promise of the trend.
  This turns SemanticWiki from a tool you run into infrastructure that runs itself.
- **Reuses:** the existing git-diff plumbing — `update-embeddings`, `update-wiki`,
  and `getChangedFilesSince()` in `src/rag/index.ts` — plus `pack`/`unpack` for
  caching the RAG index between runs.
- **Scope:** a thin `action.yml` + entrypoint that runs `generate` (first run) or
  the incremental update path (subsequent runs), restores/saves the
  `.semanticwiki-cache` via Actions cache, and needs `ANTHROPIC_API_KEY` as a
  secret (or a `--full-local` self-hosted runner variant).
- **Depends on #2** — the incremental path must be trustworthy, or every push does
  a full regeneration and burns tokens.

## 2. Robust incremental updates (enables #1)

Replace the half-built update path with a real diff→pages engine.

- **Problem:** `update-docs` still re-runs full generation (explicit `TODO` at
  `src/cli.ts:508`), and `update-wiki` maps changed files to wiki pages with
  brittle filename heuristics (`findAffectedWikiPages`).
- **Approach:** symbol-level diffing using the AST chunker (`src/ast-chunker.ts`)
  to detect which functions/classes actually changed, then resolve affected pages
  through the RAG index and the pages' `sources` frontmatter rather than string
  matching. Regenerate only those pages; re-embed only changed chunks.
- **Payoff:** fast, cheap, reliable updates — the foundation for CI automation and
  for a future served/live wiki.

## 3. Better static-site search + knowledge graph

Make the shipped site as good as the generation-time retrieval.

- **Search:** the static site currently does plain client-side text matching
  (`src/site/scripts.ts`), while generation uses hybrid RAG. Ship the page
  embeddings + a lightweight BM25 index into the site and reuse the RRF fusion for
  in-browser semantic search (the `--ai-chat` build already loads embeddings).
- **Knowledge graph:** the markdown link graph is validated by
  `verifyWikiCompleteness` but never surfaced. Derive backlinks and a
  page-relationship graph from the real links and render an interactive
  architecture map — a strong, on-brand "semantic wiki" feature.

## 4. Hosted / served wiki with a live search API

The biggest leap, and the closest match to the "web app" mental model: a small
server that serves the wiki, exposes a search/RAG API, and streams chat answers
server-side (so no client-side model download). Natural companion to #1 for teams
that want a shared, always-live docs portal. Larger surface area — plan as its own
milestone.

## 5. SQLite FTS for metadata

Chunk metadata currently lives in a JSON blob (`metadata.json`). Move metadata (and
optionally a full-text index) into SQLite FTS5 to speed up large-repo indexing and
enable richer queries. Low-risk and self-contained.

> `better-sqlite3` used to be declared as a dependency in anticipation of this work
> but was never imported, so it was dropped to avoid a native build on every install.
> Add it back (or use `node:sqlite`, available on the supported Node baseline) when
> this item is actually picked up.

## 6. Local-mode roadmap items

From `docs/plans/LOCAL_MODE_PLAN.md`, still unshipped: LoRA / fine-tuned adapters,
quantization selection, model A/B comparison, and air-gapped bundled docs for
fully offline environments. `docs/plans/fine-tuning/` holds the detailed plan for
the fine-tuned-adapter half of this.

## 7. Evaluation harness

`docs/plans/EVAL_PLAN.md` specifies a manual rubric, deterministic automated checks
(link integrity, `file:line` validity, Mermaid parsing, stub detection), and an
optional LLM-judge pass over a set of pinned fixture repositories. This is the
measurement layer that makes every other item on this list verifiable — in
particular it is how you would prove that #2 and the contextual-retrieval work in
PR #7 actually improve output quality rather than just changing it.

---

## Suggested sequencing

1. **#2 Incremental updates** (prerequisite, unblocks automation)
2. **#1 GitHub Action** (headline "always-current" feature)
3. **#3 Site search + knowledge graph** (quality/UX, independently shippable)
4. Then **#4 hosted wiki** as a larger milestone; **#5**, **#6**, and **#7** as opportunistic wins.

Consider pulling **#7** forward if PR #7 is revived, since it is the only way to
judge whether that branch's output is better.

---

## Repository baseline (as of 2026-09-01)

Current state after the maintenance pass:

- `master` builds clean and the suite is green (302 tests across 7 files).
- CI runs build + tests on Node 20.19 and 22.x, plus a dependency audit
  (`.github/workflows/ci.yml`); Dependabot proposes grouped weekly updates.
- `npm audit` reports only the unfixable `sharp` advisory inherited through
  `@huggingface/transformers`.
- Minimum supported Node is 20.19.

Known deferrals, all of which need real code changes rather than a version bump:

| Deferred | Why |
| --- | --- |
| `commander` 15, `chalk` 6 | Require Node >= 22; revisit when the Node floor moves up |
| `inquirer` 14 | Full API rewrite; also pins `inquirer-autocomplete-prompt` |
| `typescript` 7 | Native compiler port; wants its own validation pass |
| `@huggingface/transformers` 4 | New onnxruntime line; touches the embedding path |

Open code debt worth tracking:

- `src/cli.ts` still has the `update-docs` full-regeneration `TODO` that item #2 exists to fix.
- Test coverage is concentrated on site/chat generation. The RAG system, the wiki
  agent loop, and the LLM providers have little to no direct coverage (issue #11).

