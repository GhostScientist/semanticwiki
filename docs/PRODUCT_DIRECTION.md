# Product direction and compatibility

## Product thesis

SemanticWiki should become the source-grounded maintenance layer for a codebase:
generate architectural documentation, show the evidence behind it, keep it current
as code changes, and make the resulting knowledge available to developers and
coding agents. Local inference is an important capability, but trust, freshness,
and recoverability are the product.

The durable loop is:

```text
init → generate → verify → search/preview → update → review changes → repeat
```

The general coding assistant can remain available, but documentation maintenance
should be the center of the public interface. This keeps the product legible while
still making the RAG, MCP, site, and model work useful.

## Execution backends

API models and local models should be first-class implementations of the same
workflow, not separate products:

```text
semanticwiki generate -r . --provider anthropic
semanticwiki generate -r . --provider local
```

The provider changes execution characteristics—credentials, cost, latency, disk,
hardware, and model availability—but not the meaning of `generate`, `update`, or
`verify`. There must be no silent fallback from local to cloud or cloud to local.

Prefer a small configuration model:

```json
{
  "provider": "anthropic",
  "model": "claude-opus-4-7",
  "offline": false
}
```

The CLI can retain `--full-local` and `--direct-api` as compatibility aliases, but
new UX should converge on `--provider anthropic|local|ollama`. Hardware tuning,
context sizes, GPU layers, and model paths belong in advanced configuration or
`models prepare`, not in the everyday command path.

The backend contract should expose capabilities and an estimate before work starts:

- API: credential status, model, estimated spend, and network requirement;
- local: model readiness, disk/RAM/VRAM requirement, measured throughput, and
  offline readiness;
- both: model identity, prompt version, context budget, cancellation, usage, and
  a truthful generation result.

Keep retrieval artifacts independent from the writer backend. Switching from an API
writer to a local writer should not force an embedding rebuild; changing the
embedding model or chunker should invalidate the retrieval cache with an explicit
reason. Record the backend and model in run/artifact manifests so users can compare
quality, cost, latency, and grounding instead of relying on impressions.

## Interface shape

The current commands remain compatibility surface. Over time, converge on a small
set of nouns and verbs:

```text
init       choose project settings and explain prerequisites
doctor     diagnose runtime, credentials, models, disk, and caches
generate   create a wiki from a repository
update     inspect and apply changes to an existing wiki
resume     continue an interrupted run
verify     check structure, evidence, and freshness
search     query wiki/code knowledge
preview    build or serve the static reader
models     list, prepare, inspect, and verify local artifacts
```

`update-docs`, `update-embeddings`, `update-wiki`, and `continue` should remain
aliases or advanced commands while a shared update service is built. Do not make a
user rewrite scripts just because the internal architecture improves.

Every command should have the same core properties:

- human-readable progress on stderr;
- stable machine output with `--json` (one final object) or versioned JSONL for
  streaming events;
- no prompts when stdin is not a TTY or `--non-interactive` is set;
- explicit `--yes` for destructive or mutating confirmation;
- documented exit statuses: 0 success/no-op, 1 failed or incomplete result,
  2 invalid input/configuration, 130 cancelled;
- a result that says what was generated, skipped, failed, verified, and can be
  resumed.

## What can break for an existing wiki

A generated wiki is an artifact with more than Markdown content. It may contain:

- page links and anchors;
- source citations tied to file paths, line ranges, and a source revision;
- RAG metadata and embeddings tied to an embedding model and chunking strategy;
- static-site assets and a client-side configuration shape;
- package manifests and MCP expectations;
- user edits made after generation.

The risky changes are therefore:

1. **Path/schema breaks** — pages, cache files, manifests, or site assets move or
   change shape.
2. **Meaning breaks** — defaults, prompts, retrieval, or models change enough that
   regenerated pages differ materially.
3. **Evidence breaks** — citations no longer resolve, or source revisions are lost.
4. **Operational breaks** — a run claims success after a partial failure, cannot
   resume, downloads unexpectedly, or changes cloud/local behavior.

Treat generated output like a database-backed build artifact, not disposable text.

## Compatibility policy

Every generated wiki and cache should carry a small manifest containing at least:

```json
{
  "formatVersion": 1,
  "generatorVersion": "1.4.0",
  "sourceRevision": "…",
  "model": { "provider": "…", "id": "…", "promptVersion": "…" },
  "retrieval": { "embeddingModel": "…", "chunkerVersion": "…" },
  "verification": { "structure": "passed", "evidence": "passed" }
}
```

The exact schema can evolve, but the principles should not:

- read old manifests for at least one major version;
- migrate on read or through an explicit `migrate` command, never by silently
  overwriting user files;
- write to a temporary directory and atomically replace only after verification;
- preserve the previous manifest and artifacts for rollback;
- make cache invalidation explainable (`embedding model changed`, `chunker changed`,
  `source revision changed`);
- never rewrite user-authored Markdown without an explicit opt-in;
- support `--no-migrate`/read-only inspection when a user needs to recover an old
  artifact.

Use semantic versioning for the CLI, but use an independent format version for
generated artifacts. A CLI patch can read and write the same format; a format
change needs a migration note and fixtures for old and new versions.

## Development practices that prevent bad UX

- Record provenance for each page and citation, not just a rendered link.
- Separate structural verification, citation verification, freshness, and semantic
  quality. A broken-link check cannot certify a true explanation.
- Keep a tiny fixture repository and fake provider so failure, interruption,
  resume, and update behavior are tested without API cost.
- Pin and report model, prompt, chunker, embedding, and runtime identities in every
  evaluation.
- Test the published tarball on supported Node versions, not only the checkout.
- Preserve aliases and deprecate loudly before removal.
- Make default changes opt-in first when they alter generated content; promote them
  only after a comparison/evaluation and a changelog migration note.
- Add golden tests for package/site manifests and representative source links.

## Near-term sequence

1. Establish `doctor`, explicit run results, and executable CLI contract tests.
2. Introduce a project manifest and provenance-bearing verification.
3. Unify update/resume around durable run state while keeping old command aliases.
4. Normalize API and local execution behind one provider contract, then make local
   models first-class through preparation, checksums, and offline mode.
5. Add preview/agent integrations and measure whether users keep wikis current.

This sequence keeps the learning surface rich—retrieval, evaluation, inference,
tooling, packaging, and developer workflow—without making every improvement a
breaking interface rewrite.
