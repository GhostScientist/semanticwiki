# Launch baseline — November 6, 2026

This baseline consolidates the existing work and prepares version 2.0.0. Source changes and merging are separate from publishing a tagged/npm release.

## Consolidation decisions

Existing uncommitted work was first preserved in commit `3dd6224` on `codex/launch-baseline`. The integration branch preserves ancestry instead of replacing existing branch history.

| Original work | Disposition |
| --- | --- |
| Current `master` / prior PRs #14–19 | Integrated with the local improvements; retained CI, docs reorganization and Marked compatibility fixes. |
| PR #7, wiki discovery/contextual retrieval | Integrated discovery, hierarchical planning, contextual enrichment and regression tests; repaired local runtime lifecycle. |
| PR #41, EmbeddingGemma migration | Integrated Transformers.js 4 / EmbeddingGemma 2 and compatibility tests. |
| PR #43, grouped dependencies | Integrated and advanced vulnerable packages to fixed versions; native llama.cpp runtime updated. |
| PRs #36 / #37, Vitest and coverage | Integrated as a matched upgrade, then validated together. |
| PR #38, Node 26 types | Superseded by Node 24 types to match the supported minimum. CI also exercises Node 26. Branch ancestry is retained. |
| PR #8, fine-tuning plan | Confirmed all five files already preserved under `docs/plans/fine-tuning`; no duplicate top-level training tree. |
| Local `eval-plan` | Plan already preserved under `docs/plans/EVAL_PLAN.md`; ancestry retained. |
| Old static-site planning branch | Archived as `docs/plans/STATIC_SITE_PLAN.md`; shipped reader takes precedence. |
| Other remote feature branches | Already ancestors of the integrated main baseline. |

Old local branches and other active worktrees are not forcibly deleted. They may contain a developer's context. Once the integration is merged, branch heads are reachable from the new baseline and can be retired safely by their owners.

## Migration from 1.x

- **Node:** upgrade to Node 24+ before installing 2.0.0.
- **Writer:** the default now uses the direct Anthropic API. Use `--provider claude-code` for the prior SDK/subprocess path. Existing `--direct-api` and `--full-local` flags remain available.
- **Cloud keys:** each user provides their own `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`; use `doctor` to check presence without revealing values.
- **Local writer:** the default is the pinned 7B v2 Q4_K_M model, with an 8,192-token runtime context. Run `models prepare` and `models verify`. Old weights are not deleted or renamed.
- **Storage:** weights, embedding downloads and remote checkouts default to `~/.semanticwiki`. `doctor` lists actual locations and legacy cwd caches. Delete old cache directories only after a successful new run and after confirming they contain no files you need.
- **Index:** changing embedding model or source compatibility rebuilds the code index. Existing portable indexes remain colocated with their wiki. `--skip-index` is an explicit choice to reuse existing metadata.
- **Site:** new builds write to `<wiki>/site/` and work at arbitrary hosted subpaths and from local files. Old sibling `site/` output is left untouched. Deploy the new directory.
- **Agents:** `export -o ./wiki` adds OKF 0.2 without rewriting human Markdown. The generated `knowledge/` directory must retain its ownership marker. An unrelated preexisting directory is protected from overwrite.
- **Packages:** new packages default to `.semantics`; older `.archiwiki` input remains accepted. Extracted code indexes now land inside the extracted wiki so search can find them.
- **Automation:** `search --json`, `verify --json`, `doctor --json` and `export --json` produce machine-readable output. Existing-document updates require `--yes` in noninteractive sessions. Failure/incomplete generation returns nonzero.

## Release evidence

See the [validation report](LAUNCH_VALIDATION.md) for observed results and outstanding release gates. Required evidence includes the supported-Node check suite, isolated CLI contracts, generated-site browser checks, package contents/roundtrip, clean dependency audit, synthetic cloud-provider tool roundtrip and a real native 7B completion.

Live Claude verification requires an Anthropic API key and remains a separate check when none is configured. Review representative generated documentation for factual/source accuracy before announcing release; link verification and mocked tests do not establish model output quality. This pass does not publish to npm or create a release tag.
