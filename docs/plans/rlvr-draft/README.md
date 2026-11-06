# Preserved RLVR research draft

This preserves unfinished, uncommitted work found in the existing `ghostscientist-build-rlvr-foundation` worktree. It is **not part of the shipped runtime**. The original worktree remains untouched. The public snapshot normalizes private registry download addresses in the old lockfile; all source, tests, dependency versions, and integrity hashes are retained.

- Base commit: `33271fc92213b4d098e6687d068482e6a8968f09`
- Original files last modified: September 3–4, 2026
- Snapshot: November 6, 2026
- Files: five tracked modifications and four new files, all recorded in [manifest.json](manifest.json)
- [changes.patch](changes.patch) includes the complete tracked and untracked source changes, tests, documentation, and dependency changes.

The patch was applied to a temporary export of its base commit. All nine reconstructed files match the snapshot hashes; eight match the original files exactly, and the lockfile differs only in registry download addresses. The manifest records both lockfile hashes. A read-only Node 24 typecheck and six focused draft tests passed. The tests exercise helpers with a fake semantic embedder; they do not establish real citation accuracy or end-to-end trajectory coverage.

## What it contains

Opt-in JSONL research trajectories, source-file and line-range validation, page structure checks, Mermaid parsing, and experimental embedding similarity scores for citations. These are useful starting points for future evaluation work.

## Why it remains a draft

- Quality scoring is called after direct generation even when trajectory capture is disabled. It can download another embedding model and fail after generation completes.
- A fixed cosine-similarity threshold is labeled citation support without calibration or entailment checks. Similar text is not proof of a correct claim.
- Source parsing includes fenced examples, mishandles repeated references, and does not contain symlink targets within the source repository.
- Captured trajectories omit model inputs, do not cover every provider mode, and need complete cancellation/failure handling.
- CLI success is based on link completeness even when other quality checks fail.

Before integrating, reuse current managed storage and provider-history APIs, make expensive evaluation explicit, separate structural checks from factual assessments, and add end-to-end tests for all capture modes. Do not replace current dependency versions with this old lockfile.

To reconstruct the preserved draft, use a separate checkout of the recorded base commit, run `git apply --check` with this patch, then apply it there. The patch is historical and is not intended to apply directly to the new baseline.
