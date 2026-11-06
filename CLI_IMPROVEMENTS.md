# SemanticWiki CLI: competitive improvement plan

Reviewed 2026-09-16 against checkout `252cfd42790165523dde6fa5a0dca18620e15979`, including the pre-existing working changes in `anthropic-provider.ts`, `wiki-agent.ts`, `site-generator.ts`, and `site/scripts.ts`. Those changes were preserved. This document proposes future work; it does not claim the fixes below have been implemented. Model plan: [MODEL.md](MODEL.md).

## Recommendation

Position SemanticWiki as **source-grounded architectural documentation you can generate locally, keep current, and use from your editor or coding agent**. The strongest next release combines the new 7B model with a dependable generate → verify → update → search workflow.

There is already substantial functionality: local GGUF and Ollama inference, cloud generation, AST-based retrieval, incremental operations, static sites, code maps, MCP, and portable packages. The biggest opportunity is making those features trustworthy and easy to adopt. Reliable completion, clear configuration, clean installation, and evidence of documentation quality have higher immediate value than more commands or another general coding-assistant feature.

Suggested order: fix correctness and installation promises; establish real workflow tests and CI; ship the evaluated 7B local path; make updates and agent integrations excellent; then refine discovery and visual presentation.

## 1. Evidence and limits of this review

| Check performed | Result | Interpretation |
| --- | --- | --- |
| `npm run build` | Passed on Node 22.21.1. | The current source, including existing local changes, compiles. |
| `npm test` | 6 files, 291 tests passed. | Useful baseline, but not end-to-end product assurance. |
| `npm run test:coverage` | 1.02% statements, 1.05% lines, 1.89% branches, 1.68% functions. | CLI, wiki agent, RAG implementation, providers, downloads, and package implementation report 0%. |
| Compiled `--version` / command help | Version prints `1.0.0`; package is `1.4.0`. | Visible release identity is inconsistent. |
| `verify --json` on an empty directory | Exit 0; `totalPages: 0`, `isComplete: true`. | Verification currently means absence of broken page links, not completion. |
| Two-page fixture verify → pack → unpack → verify | Passed, using `--no-rag`. | Basic Markdown packaging works; RAG portability was not tested. |
| README MCP example with `-w` | Rejected: unknown option `-w`. | Documentation has an actual copy/paste failure. |
| `npm pack --dry-run --ignore-scripts --json` | Succeeded; approximately 285 KB compressed / 1.42 MB unpacked, 111 files, no bundled dependencies. `prepare` still ran in this environment. | The tarball itself is small; native/transitive installation and lifecycle behavior need separate tests. |

The coverage result needs context: many site tests assert that generated JavaScript strings contain particular text. That does not execute browser behavior. Several RAG tests reimplement formulas or assert hand-written objects/constants rather than calling production code. A green count therefore overstates the workflow coverage. See [tests/rag-hybrid-search.test.ts](tests/rag-hybrid-search.test.ts), [tests/chat-scripts.test.ts](tests/chat-scripts.test.ts), and [vitest.config.ts](vitest.config.ts).

This was a code/command audit and public-documentation comparison, not a full security audit or a competitor benchmark. No paid API generation, model downloads, quantization, fresh global install, GPU run, or real-browser end-to-end run was performed. Competitor capabilities below are documented claims, not independently measured quality. Review artifacts were kept outside the repository; only these two planning documents are intended additions.

## 2. What competing offerings establish

| Offering and primary source | Current documented strengths | What SemanticWiki should learn |
| --- | --- | --- |
| [LangChain OpenWiki](https://github.com/langchain-ai/openwiki) | Guided initialization, updates, durable page jobs, agent integrations, claim/evidence sidecars, interactive/static graph reader, broad provider support including local-compatible endpoints. | Treat repeat use, recovery, and source evidence as product features. Model choice alone is not differentiation. |
| [OpenWiki launch/workflow explanation](https://www.langchain.com/blog/introducing-openwiki-an-open-source-agent-for-repo-documentation) | A maintained repository wiki that coding agents consult, with automation for refreshing documentation. | Sell maintained repository knowledge and reduced onboarding effort; provide a ready-to-use update workflow. |
| [Cognition DeepWiki](https://docs.devin.ai/work-with-devin/deepwiki) | Repository wikis with diagrams/source links, grounded Q&A, and explicit page/scope steering through `.devin/wiki.json`. | Let maintainers control topics and exclusions, and demonstrate the resulting output immediately. |
| [DeepWiki-Open / Grok-Wiki](https://github.com/AsyncFuncAI/deepwiki-open) | Its current README emphasizes repository-to-wiki generation, visual diagrams, navigable docs, code-map tours, and a 2.0 desktop offering. | Guided exploration matters. Make source-linked tours useful before adding more visualization types. |

OpenWiki is the LangChain project here, not one of several unrelated projects with the same name. Its current source documents local-compatible providers, durable state, and source grounding: do not claim SemanticWiki is uniquely local, portable, or evidence-aware. Its viewer also documents CDN requirements, leaving an opportunity for a fully packaged offline experience if SemanticWiki proves it.

The competitive thesis is a hypothesis: a tuned small writer plus controlled retrieval, verifiable source references, and simpler deployment may give solo developers and small teams better local usability. Test that with representative users and equal-task benchmarks. Avoid claims of superior output, lower total cost, or faster generation until measured.

Defer personal-knowledge connectors, a hosted collaboration product, additional model runtimes, and expansion of the general coding assistant. They serve different workflows and would dilute the first local-docs release. Keep existing assistant commands available, but make documentation the primary entry point.

## 3. Ranked opportunities

Effort is approximate focused maintainer time; rows overlap and should not simply be summed. P0 means release blocker for a dependable local offering; P1 is the next adoption/retention work; P2 follows a successful pilot.

| Rank | Priority | Opportunity | Why it matters | Effort | Completion evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | P0 | Correct failure/completion semantics and local sequence ownership | Prevent false success and failure partway through a wiki. | 2–4 days | Injected failures, empty wiki, partial pages, and >30 calls behave correctly. |
| 2 | P0 | Executable CLI contracts and CI | Catch the paths currently untouched by 291 tests. | 2–4 days initially | PR checks exercise compiled CLI and real services with controlled model/retrieval boundaries. |
| 3 | P0 | Version, Node support, README command repairs | Make installation and the first five minutes credible. | 0.5–1.5 days | Supported-node tarball install and every quickstart command pass. |
| 4 | P0/P1 | Evaluated 7B model, model preparation, `doctor` | Turns local mode into a usable reason to choose SemanticWiki. | See [MODEL.md](MODEL.md) | Grounding, memory, download integrity, and offline gates pass. |
| 5 | P1 | Unified config and noninteractive output | Makes daily use, scripts, and support predictable. | 2–4 days | Explicit precedence, no prompts in CI, stable JSON/exit codes. |
| 6 | P1 | Durable updates/resume and richer verification | Gives users confidence to keep documentation current. | 4–7 days | Interrupted jobs resume; unchanged repos avoid generation; changed evidence marks pages stale. |
| 7 | P1 | Repeatable npm release pipeline | Reduces maintainer effort and partial-release incidents. | 2–3 days | Candidate artifact installs; rerun resumes publication without duplicating a release. |
| 8 | P1 | Contributor workflow and narrow module extraction | Makes returning to the project and changing it less costly. | 2–4 days incrementally | One check command, fixture-driven development, fewer duplicated generation contracts. |
| 9 | P1/P2 | Agent integrations and a generated-docs update action | Converts generated output into a recurring workflow. | 2–4 days | Agent can search/open docs; changed-source update can produce a reviewable docs-only PR. |
| 10 | P2 | Offline viewer, preview, demos, and adoption measurements | Makes the local promise tangible and the product easier to evaluate. | 2–4 days | Fresh offline browser test and observed first-run usability trials. |

## 4. Correctness before polish

### Generation must report what happened

In [cli.ts](src/cli.ts), the `generate` handler prints error events but keeps consuming the generator and finally prints a generated-path message. In [wiki-agent.ts](src/wiki-agent.ts), local initialization errors yield an error then return; page failures are counted, yet a completion event still follows. Verification happens before index generation, and the initial `generatedFilenames` set contains planned filenames even if writing them failed, which can prevent repair retries.

Introduce a typed `GenerationResult` with `success | partial | failed | cancelled`, successful/failed page records, final verification, source revision, and model/prompt identity. Command handlers should render that result and choose exit status; they should not infer success from iterator exhaustion. Only offer site generation as successful output when prerequisites meet the selected policy. Preserve partial artifacts and provide a resume instruction.

In [local-llama-provider.ts](src/llm/local-llama-provider.ts), the 20-sequence allocation masks a lifecycle problem: the installed `node-llama-cpp` 3.18.1 implementation defaults `autoDisposeSequence` to false, so bare `session.dispose()` does not release the acquired sequence. Explicitly own/dispose or reuse the sequence, start with one for serial generation, and ensure provider shutdown is in `finally` around planning and writing. Also move all returns/errors after session acquisition under cleanup. This finding is based on source/library inspection, not a GPU reproduction.

The signal handler currently exits immediately with status 0 on first SIGINT/SIGTERM, despite describing graceful cleanup. Replace that with an `AbortController`, propagated cancellation, bounded cleanup, checkpoint persistence, and conventional cancelled statuses (e.g. 130/143). Do not let cancellation or an unhandled rejection look successful.

Acceptance: initialization failure, malformed plan, inference failure, a failed required page, post-index broken links, and Ctrl+C produce distinct truthful outcomes. A run that generated some useful pages should say so without claiming completeness.

### Verification must distinguish structure, evidence, and freshness

`verifyWikiCompleteness()` currently checks selected Markdown page links, skips source-code references and anchors, and defines completeness as zero broken links. The empty-directory smoke test demonstrates the consequence.

Extend verification in layers:

1. Required plan pages and entry point exist and are nonempty; generated index links only successful pages.
2. Internal page links and anchors resolve; Mermaid parses; invalid diagrams produce actionable diagnostics.
3. Source references resolve to files and line ranges at the recorded source revision. Preserve evidence metadata rather than relying only on rendered URLs.
4. Source changes invalidate affected evidence/page records. Label stale pages and expose the reason.

Use different fields for structural validity, citation validity, and semantic evaluation. A link checker cannot certify that a claim is true. Add a strict release/CI mode with a documented policy; keep machine output stable and useful to the update workflow.

### Enforce scope consistently

The local page path scans `this.repoPath` and has no enforcement of the requested focus path; page generation also hard-codes search limits and character budgets. `--config` primarily becomes an agent prompt note in `buildWikiPrompt()`, rather than a shared validated contract. `--force` should be traced into actual cache invalidation before it is described as reliable across backends.

Move include/exclude/focus configuration into the common repository discovery and retrieval layer. Test local, direct API, and SDK routes with a fixture containing an excluded subtree. Report indexed/omitted files and why. Validate option combinations: backend-specific flags should either take effect or cause a helpful error, never silently disappear.

## 5. CLI UX: first run and everyday use

### A small, coherent command surface

There are currently three update commands, a `continue` command, many `generate` switches, and a default coding-assistant interaction. Evolve toward the following **proposed** public surface while retaining compatibility aliases:

```bash
semanticwiki init                  # configure this repo and explain local/cloud choices
semanticwiki doctor               # diagnose runtime, config, disk and model readiness
semanticwiki generate -r .         # preserve current -r syntax; allow '.' as a future default
semanticwiki update --dry-run      # show changed files and affected documentation
semanticwiki update --yes          # execute without interactive questions
semanticwiki resume               # continue durable work with recorded settings
semanticwiki verify --strict --json
semanticwiki search "authentication" --json
semanticwiki preview --no-open
semanticwiki models list
```

These commands/options do not all exist today. `update-docs`, `update-embeddings`, and `update-wiki` should share an update service, with old commands remaining as explicit aliases/advanced operations during deprecation. `continue` becomes an alias for durable resume once implemented.

`--site-only` is currently processed after cloud selection/key validation. Building existing Markdown should require neither model selection nor an API key; route it to a standalone site build/preview operation before inference setup. Preserve the existing flag as an alias.

### Configuration users can understand

[config.ts](src/config.ts) stores only API key/verbose configuration and silently treats all read/parse failures as an empty config. Backend selection and model options are largely command-local. Add schema-validated project configuration and a separate user configuration, with explicit precedence: **CLI flags → environment → project → user → defaults**. Publish field names and the supported environment mapping.

Store nonsecret repository preferences in version control: provider, model ID, output, scope, page plan, and verification policy. Resolve secrets from environment/user credentials and show redacted values with their origin in `config show`. Invalid config should identify the file/field and suggested fix. Support an overridable data/config directory so fixtures, containers, and multiple workspaces are isolated.

`doctor` should inspect supported Node version, required native runtime availability, available disk, model cache integrity, effective context, selected backend, embedding assets, output writability, and remote connectivity only when the selected mode needs it. Return actionable fixes and JSON. Local mode must not require a cloud credential; never silently fall back to cloud.

### Output and automation contracts

The initial mode picker respects TTY state, but update/continue actions include unconditional confirmation prompts. Add shared `--yes`, `--non-interactive`, `--quiet`, `--verbose`, and `--json` behavior where appropriate. In noninteractive mode, missing required choices should fail with a command example. Validate numeric limits, enums, incompatible flags, and paths before expensive indexing.

Human progress belongs on stderr; structured results belong on stdout. Replace unconditional provider/debug logs with typed progress events rendered by the CLI. Show phase, completed/total pages, elapsed time, effective model/backend, and final output entry point. Label estimates as estimates and derive local estimates from the selected model/context; the current estimate call does not forward those selections.

Proposed exit contract: 0 success/no-op, 1 failed or partial generation under the chosen policy, 2 invalid input/configuration, 130 cancellation. Keep existing `verify` success/failure behavior compatible while fixing false positives. For streaming consumers, use an explicitly versioned JSONL event mode; keep `--json` to one final object.

MCP needs especially clean stdout. [mcp-wiki-server.ts](src/mcp-wiki-server.ts) imports RAG code that logs to stdout when loading an index. Test a real stdio handshake and tool call with a cached index. The global stdin-history reader in [cli.ts](src/cli.ts) also uses CommonJS `require` in an ESM entry point inside a swallowed catch; isolate that legacy behavior to the command that needs it instead of doing it before all argument parsing.

## 6. DevEx for the maintainer

### Make the common loop cheap

Add a concise `CONTRIBUTING.md` with supported Node/package-manager versions, `npm ci`, architecture map, fixture commands, debugging, native dependency troubleshooting, test tiers, and release procedure. Provide one `npm run check` that performs type checking, lint/format checks, and deterministic tests. Add a pinned runtime/version file and a formatter/linter configuration; use modest rules and ratchet rather than reformatting the entire codebase in one change.

Create a tiny example repository and sample wiki with no model requirement. A scripted fake provider should let you run a complete CLI workflow, inject errors, and inspect page state without waiting for generation. Keep hardware/model evaluation as a separate opt-in task. Add a deliberate local integration command that runs the real model against the same fixture when needed.

### Refactor along test boundaries

[cli.ts](src/cli.ts) is about 2,975 lines; [wiki-agent.ts](src/wiki-agent.ts) about 4,329; [rag/index.ts](src/rag/index.ts) about 1,844. The maintainability issue is coupled responsibilities and inconsistent routes, not file length by itself.

Extract incrementally:

- `createProgram(dependencies)`: command definitions, option validation, and rendering, with `main()` responsible for execution/exit only.
- Generation/update services: shared configuration, page plan, result types, and state transitions independent of terminal UI.
- Repository/evidence service: discovery, scope, source snapshots, retrieval, and citation resolution.
- Provider adapters: typed capabilities, context/token accounting, cancellation, and resource ownership.
- Storage schemas: run manifest, page provenance, index metadata, package manifest, and their version migrations.

Replace module-global `currentGenerationOptions` and global embedding-pipeline selection with explicit per-run dependencies or correctly keyed caches. Remove `any` at these boundaries before attempting broad type cleanup. Keep SDK, direct API, and local implementations where their capabilities differ, but use the same result/config/verification contracts.

Declare imported runtime dependencies directly. For example, `@modelcontextprotocol/sdk` is imported by production code but currently arrives transitively. Review whether `better-sqlite3` is needed and whether FAISS/local inference can be optional or lazy-loaded without compromising the local install promise. Measure clean install and command startup before choosing a package split.

The lockfile requires newer Node than the advertised `>=18`: `node-llama-cpp` 3.18.1 requires >=20 and Cheerio 1.2.0 requires >=20.18.1. Set a tested support matrix (proposed Node 22 and 24), align `engines`, README, and CI, and explicitly document any native build prerequisites. This conclusion comes from the locked packages, not a speculative dependency update.

## 7. Testing that measures the product

Do not chase a global coverage percentage first. Protect the workflows where failures lose time, produce misleading docs, or break automation.

| Tier | What to exercise | When | Boundary |
| --- | --- | --- | --- |
| Fast unit/contract | Real production option validation, config precedence, page-path validation, token budgets, citation normalization, model manifests, status transitions. | Every PR | Mock network/inference; avoid reimplementing the function under test. |
| Workflow integration | Generate → verify → update → resume; incremental add/rename/delete; archive round trip including RAG; stale index/schema handling. | Every PR | Temporary repo/filesystem and deterministic fake provider/embedding adapter. |
| Compiled CLI/package | Installed tarball, help/version, documented commands, invalid flags, non-TTY stdin, JSON purity, exit codes, paths with spaces, cancellation. | Every PR for one platform; release matrix | Spawn the actual executable outside the source checkout. |
| Native runtime | Actual FAISS/fallback behavior, 30+ local calls, context fit, disposal, Ollama compatibility. | Nightly/manual release gate | Real supported hardware/runtime; small fixed fixture. |
| Browser | Generated-site navigation/search, citation links, diagram rendering, errors, offline startup. | Site-changing PRs and release | Browser executes generated JS; assertions on behavior, not substrings. |
| Model quality | Grounding, required facts, citation accuracy, diagram validity, latency/memory. | Model/prompt/retrieval changes | Frozen, held-out corpus described in [MODEL.md](MODEL.md). |

First regression cases: empty wiki; model initialization failure; failed required page; 31 sequential provider calls; interrupted/resumed generation; excluded subtree; corrupted download; changed embedding model invalidating cache; README examples; MCP JSON-RPC with a cached index; and offline generation after preparation.

For packages and generated paths, add bounded tests for malformed/truncated archives, oversized declarations, traversal paths, and writes outside the output directory. These are high-value boundary tests for a distribution format, not a claim that this review completed a security assessment. [package-format.ts](src/package-format.ts) uses a custom gzip-compressed binary layout despite its opening comment describing tar; document the actual versioned format. Its extraction layout places RAG data beside `wiki/`, while CLI autodetection usually looks inside the wiki, so test and standardize the full RAG round trip before promising portability.

Use `mkdtemp` per test rather than fixed `/tmp/test-package` directories. Keep model downloads/credentials out of normal test runs. Set coverage floors on newly extracted critical modules and increase them as behavior tests land; do not use string-presence tests to inflate reported confidence. CI should upload failures, generated fixture output, and coverage without polluting the checkout (`coverage/` is not currently ignored).

## 8. Automate releases around a tested artifact

### Current friction

[scripts/release.sh](scripts/release.sh) checks the version/changelog and clean tree, builds/tests, prompts, pushes a tag, creates a GitHub release, then publishes npm. If npm publication fails, GitHub already shows a release and retry hits the existing-tag check. [scripts/publish.sh](scripts/publish.sh) runs `npm install` and builds before even processing `--help`; it offers another publication path. `prepublishOnly` repeats build/tests. No `.github/workflows` files exist in this checkout.

Centralize version identity in `package.json`, including CLI `--version` and MCP server identity where appropriate. Preserve separate archive/schema versions. Add repository/issue/homepage metadata to the package so users can find docs and report problems; provenance metadata should point to the actual repository.

### Proposed workflow

Use **Changesets** for change entries and a release PR; one maintainer can approve the version/changelog as a normal code review. This supplies a lightweight release queue without requiring all historical commits to follow a new format. A tag-driven pipeline is also viable, but choose one owner of version/tag creation to avoid dueling release paths.

1. PR checks: `npm ci`, type/build checks, deterministic tests, docs/example checks, and a packed-artifact smoke test. Run supported Node/OS combinations in proportion to native dependency risk.
2. Release PR: version and changelog changes; link model compatibility/evaluation when affected. Merge only with the normal checks passing.
3. Trusted release job: check out the approved release commit and build/package once. Produce a checksummed tarball, inspect its file list, and install that exact tarball in a clean temporary project on the support matrix.
4. Publish a prerelease to `next` when onboarding/model/runtime behavior changes; perform a fresh-install smoke check. Stable promotion or stable publication should use the already-tested bytes and an explicit channel/version policy.
5. Publish npm through OIDC, verify the expected registry version/integrity, then finalize the matching Git tag/GitHub release. If the versioning tool creates tags earlier, keep the release draft and make npm success a prerequisite for announcing success.
6. Record commit SHA, artifact digest, runtime matrix, and model compatibility. Make steps resumable: an existing matching npm version is verified, an existing tag must match the commit, and missing release metadata can be completed without republishing.

Use a single concurrency group for each version/channel, least-privilege jobs, and pinned action revisions. Keep ordinary PR jobs unprivileged; model benchmarks can use dedicated hardware separately. Retain scripts as local check/pack helpers, with help processing before install/build. Avoid a second rebuild in publish lifecycle hooks producing different bytes from the tested tarball; verify the actual npm lifecycle behavior in CI.

Current [npm trusted-publishing documentation](https://docs.npmjs.com/trusted-publishers/) requires npm >=11.5.1 and Node >=22.14.0. It supports GitHub-hosted runners and requires `id-token: write` plus a package trust configuration bound to the repository/workflow. The local npm here is 10.9.4, so explicitly provision a supported publisher CLI. New trust configurations may default to staged publishing; enable the intended direct-publish action if that is the workflow chosen. Automatic provenance also has documented repository/package eligibility conditions; verify them during setup.

One-time npm trusted-publisher/account setup remains maintainer work when implementing this plan. Do not use a long-lived publish token as the default architecture. Do not mix npm publication with model conversion jobs: model artifacts have separate provenance, licenses, evaluation, and rollback requirements.

Acceptance: starting from an approved release revision, the pipeline produces one identifiable tested artifact, can resume after a failed publication/metadata step, and reports a release only after registry verification. Rollback means restoring a previous working dist-tag and deprecating a bad version where appropriate, not attempting to overwrite an immutable published version.

## 9. Documentation and distribution

### Immediate repairs

The following are actual current syntax; update README examples and make them executable smoke fixtures:

```bash
semanticwiki mcp-server -o ./wiki -r ./my-project
semanticwiki pack -o ./wiki -f ./my-wiki.archiwiki
semanticwiki unpack ./my-wiki.archiwiki -o ./extracted
```

The README instead uses `-w` for MCP/pack and `-p` for unpack. It also presents older model/embedding defaults and describes a fully offline site despite CDN assets in [site/templates.ts](src/site/templates.ts) and runtime model/CDN loading in [site/scripts.ts](src/site/scripts.ts). The local testing guide lists models absent from the current registry and unverified timing estimates. Reconcile [README.md](README.md), [docs/LOCAL_ONLY_TESTING.md](docs/LOCAL_ONLY_TESTING.md), and [docs/plans/LOCAL_MODE_PLAN.md](docs/plans/LOCAL_MODE_PLAN.md); label historical plans clearly.

### Documentation structure

Keep the README focused on the outcome, a generated example, supported hardware/runtime, and two tested quickstarts: local and cloud. Show download size/setup time separately from recurring generation time. Explain the current distinction between SDK and direct-API execution/billing accurately without promising subscription behavior that hasn't been validated.

Create focused guides for installation, local-model preparation, configuration/scope, updating/resuming, search/MCP, static preview/export, troubleshooting, contribution, and release maintenance. Generate option reference from the command definitions. Include a backend capability matrix: generation, update, resume, estimate, tools, streaming, and offline support. Unsupported combinations should be obvious in both help and docs.

Troubleshooting should cover native install errors, insufficient RAM/context, interrupted model downloads, stale/corrupt index, missing credentials for the selected backend, invalid citations, and partial output. Add a redacted diagnostics export with versions/effective settings; exclude source contents and keys by default.

Provide a small checked-in sample wiki, screenshot/short walkthrough, and a reproducible benchmark report. Pick one documentation name and entry point: the code and docs currently mix SemanticWiki, ArchitecturalWiki, ArchiWiki, `index.md`, and `README.md`. Keep `.archiwiki` file compatibility unless a migration is justified.

### Close the offline promise

Vendor required viewer assets or provide an explicit offline export profile; test a fresh browser with network disabled and no cache. Browser chat uses a separate Transformers.js model path, not the new CLI GGUF. Explain its additional assets and requirements, and keep plain documentation/search usable if chat cannot initialize. A loopback `preview` server should handle static fetches, ports, and `--no-open` predictably.

## 10. Retention: updates and coding-agent use

Add a durable run/page manifest recording source revision or dirty-tree content hashes, page plan, successful writes, relevant source hashes, model/prompt versions, and verification results. Commit page output atomically before advancing its state. Resume only compatible pending work; changed source/config/model requires a visible invalidation decision. Do not call a cloud-only `continue` path a local resume feature.

Use evidence dependencies to target updates after modifications, additions, renames, and deletions. A no-op update should perform zero model calls and leave page bodies unchanged. An update should show the affected pages before generation, preserve user-owned sections/files, and produce a concise change summary. Handle stale remote clones and distinguish repositories with identical basename in cache keys.

Offer an opt-in, idempotent agent integration that adds a managed pointer block to existing agent instruction files and configures the existing MCP server. Preview the exact changes, preserve unrelated content, and support removal. Start with one or two commonly used hosts; expansion can follow adoption. Benchmark whether an agent can answer repository questions more accurately or with fewer steps using the generated wiki.

Provide a pinned example GitHub Action that detects source changes, runs noninteractive update/verify, and opens a documentation-only PR. Default to review, not automatic merge. Document required runner/model setup and credentials, generated-path exclusions, and how PR checks are triggered when using a bot token. This is a future user-facing integration, not an instruction to create or send PRs during this review.

## 11. A practical release sequence

| Stage | Focus | Exit condition |
| --- | --- | --- |
| Release A: trustworthy baseline | Failure/status fixes, sequence disposal, empty-wiki verification, README/version/Node repairs, initial CLI tests and CI. | Compiled/packaged fixture workflow and injected failures pass; support matrix is honest. |
| Release B: local-model preview | [MODEL.md](MODEL.md) milestones, preparation/doctor, prompt/token/citation contract, evaluated Q4/Q5 choice. | Users on target hardware can complete a grounded wiki; memory and quality results are published. |
| Release C: maintained knowledge | Shared update service, durable resume, source freshness, JSON/noninteractive contracts, release automation. | No-op and changed-source update tests pass; interrupted work recovers; candidate publication is repeatable. |
| Release D: adoption | Agent integration, docs-update action, offline preview/export, examples and onboarding trials. | Pilot users install, generate, find an answer, update, and return without maintainer intervention. |

Develop release automation alongside A/B if time permits; do not delay every small fix until the entire roadmap is complete. Roughly 4–6 focused maintainer weeks is a planning range for a credible first competitive release, with hardware benchmarking and user feedback likely extending elapsed time.

Track a small scorecard: successful fresh installs by platform; time to first verified useful page; full-run completion rate; citation/required-fact quality; cold/warm resource use; no-op update model calls; changed-page update correctness; interrupted-run recovery; and maintainer release steps. Start with at least five observed pilot users and explicit success criteria. Record opt-in feedback or local benchmark results; telemetry is not required to begin.

The first three concrete work items are the failure/lifecycle patch, a compiled CLI fixture suite with CI, and a reproducible high-precision/quantized model evaluation. Together they establish whether SemanticWiki can deliver its core promise before investing in broader feature parity.
