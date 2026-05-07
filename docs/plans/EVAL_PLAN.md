# Wiki Evaluation Plan

Issue: [#10 — Establish evaluation rubric for output wikis, both manual and automated checks](https://github.com/GhostScientist/semanticwiki/issues/10)

## Goals

1. Score any generated wiki on a consistent rubric so we can compare runs over time.
2. Detect regressions automatically (CI-runnable checks; no human in the loop).
3. Provide a heavier signal for fine-tune comparisons (Claude direct-API vs. fine-tuned gpt-oss vs. future gemma4) via an LLM-judge.
4. Keep the comparison set stable: a small handful of pinned fixture repos.

Non-goals for v1: scoring third-party wikis (e.g., DeepWiki) head-to-head; multi-rater inter-annotator analysis.

---

## 1. Manual Rubric

A scored checklist a reviewer fills out per generated wiki. Each category scored 1–5; total weighted score on a 0–100 scale.

| # | Category | Weight | What "5" looks like |
|---|----------|--------|---------------------|
| 1 | **Source traceability** | 20 | Every architectural claim has a `file:line` ref; spot-checked refs all point at code that justifies the claim. |
| 2 | **Coverage** | 15 | All entry points, top-level components, and primary data flows are documented. No glaring omissions. |
| 3 | **Architectural clarity** | 15 | Explains *why* decisions exist, not just *what* the code does. A new engineer could form a useful mental model. |
| 4 | **Cross-linking** | 10 | Internal links resolve. Pages reference each other where the concepts connect. |
| 5 | **Mermaid diagrams** | 10 | Diagrams parse. They match the prose and accurately depict relationships. No phantom nodes. |
| 6 | **Writing quality** | 10 | Concise, no repetition, clean markdown. No malformed code fences or duplicated headings. |
| 7 | **Hallucination rate** | 20 | No claims that contradict the code. Inverted scoring: 5 = zero hallucinations found in N spot-checks. |

Reviewer protocol: pick 5 random pages, score each category, average across pages, weight, sum.

---

## 2. Automated Checks

Deterministic, no LLM calls, runnable in CI. Each check emits pass/fail + a count.

| Check | What it catches | Output |
|-------|-----------------|--------|
| **Link integrity** | Broken internal markdown links | `broken_links: N / total_links: M` |
| **`file:line` validity** | Refs to nonexistent files or out-of-range lines | `invalid_refs: N / total_refs: M` |
| **Mermaid parse** | Diagrams that won't render | `invalid_diagrams: N / total_diagrams: M` |
| **Stub detection** | Pages under a min word count, or matching "TODO"/"...truncated" patterns | `stub_pages: [list]` |
| **Coverage proxy** | % of repo's top-N important files referenced at least once (uses RAG-prioritization scoring) | `coverage_pct: 0.XX` |
| **Page-plan adherence** | Every planned page actually exists; no orphan pages | `missing: [list], orphan: [list]` |
| **Markdown sanity** | Unclosed code fences, duplicate H1s, malformed tables | `malformed_pages: [list]` |

These are the "smoke tests" — they should be cheap and run on every wiki we generate.

---

## 3. LLM-Judge

Runs after deterministic checks. Reads each page + the source files it references, scores it against the rubric, returns structured output. Mirrors the wiki generator's API/local choice:

```bash
semanticwiki eval <wiki-dir> --llm-judge              # default: Claude API
semanticwiki eval <wiki-dir> --llm-judge --local      # use local fine-tuned judge
```

### Judge prompt structure

```
SYSTEM: You are evaluating a generated architectural wiki page against the source code it documents.
        Score each rubric category 1-5 and explain your reasoning. Output JSON.

USER:   <wiki page markdown>
        ---
        <referenced source excerpts>
        ---
        <rubric definitions>
```

Output: per-page rubric scores + a brief rationale per category. Aggregated at the wiki level.

### v1 implementation

- Default model: Claude Sonnet 4.6 via the existing `AnthropicProvider`. Reuses the prompt-cache plumbing already in `src/llm/anthropic-provider.ts:93`.
- Local fallback: same `LLMProvider` interface, points at the local fine-tune (or eventually a dedicated judge fine-tune — see §5).
- Cost control: spot-check N pages instead of full wiki (`--llm-judge --sample 5`).

---

## 4. Fixture Repos

Five pinned repos chosen to cover language, size, and architecture variety. Each fixture: a `repo + commit_sha + expected_page_count` record stored in `tests/eval/fixtures.json`.

| Fixture | Language | Size | Why |
|---------|----------|------|-----|
| `semanticwiki@<sha>` | TypeScript | ~10k LOC | Self-host. Dakota knows it intimately, so manual scoring is fast. Catches regressions immediately. |
| `chalk@v5.x` | TypeScript | small | Tiny, well-architected lib. Sanity baseline — if a wiki for `chalk` is bad, something is broken. |
| `flask@v3.x` | Python | mid (~30k LOC) | Classic Python framework. Tests Python parsing + larger codebase scaling. |
| `cobra@v1.x` | Go | mid | Popular CLI lib. Tests Go support and a clean library architecture. |
| **One small COBOL repo** | COBOL | small | You explicitly added COBOL support (PR #3); needs a regression target. Candidate: a public GnuCOBOL sample. |

Each fixture commit gets pinned. Generated wikis are stored under `tests/eval/golden/<fixture>/<run_id>/` so trend lines persist. After Phase 1 below, we hand-score one "golden" wiki per fixture and track delta against it.

**Storage call:** golden wikis are markdown, so they go in-tree. Embeddings/RAG indexes do not — those rebuild on demand.

---

## 5. LLM-as-a-Wiki-Judge: Fine-Tune Roadmap

You asked what's realistic. Honest assessment:

### The load-bearing problem

A fine-tuned judge is only as good as its labels. The bottleneck is **getting consistent ground-truth scores**, not training infra. So the plan is staged so that the early steps produce useful artifacts even if you never train a custom judge.

### Phased plan

#### Phase 0 — Prompted judge (in scope for #10)
- Use Claude Sonnet 4.6 with a careful rubric prompt as the judge.
- Use the local fine-tuned wiki model as a comparison judge (same prompt).
- Ship the eval CLI, run it across the 5 fixtures, get baseline numbers.
- **Deliverable:** working `semanticwiki eval` with `--llm-judge` flag, baseline scores for all fixtures.
- **Effort:** ~1 week.

#### Phase 1 — Hand-graded gold dataset (post-#10, before any training)
- You personally hand-grade 200–300 wiki pages across the 5 fixtures using the §1 rubric.
- This becomes both the calibration set (does the Claude judge agree with you?) and the seed dataset for any future fine-tune.
- **Deliverable:** `tests/eval/gold/` with JSON-encoded rubric scores per page + rationale.
- **Effort:** 4–8 hours of focused review (40 pages/hour is a reasonable pace once the rubric is internalized).
- **Why this is the most important step:** without it, you can't tell whether a "smarter" judge is actually better. Skipping it makes Phases 2–4 unfalsifiable.

#### Phase 2 — Distillation SFT (only if Phase 1 shows the local judge is worse)
- Use Claude as a teacher: feed it ~5,000 (page, source, rubric_scores) examples and capture its outputs.
- SFT a small open model (Qwen2.5-7B-Instruct or Llama-3.1-8B) on Claude's outputs, validated against your hand-graded set.
- Use TRL on HuggingFace Jobs (you already have this infra from the gpt-oss fine-tune; the `hugging-face-model-trainer` skill is already installed).
- **Deliverable:** `GhostScientist/semanticwiki-judge-7b` on HF.
- **Effort:** 1–2 weeks. Cost: ~$30–80 (5k Claude calls + ~2hr H100 training).
- **Risk:** teacher bias propagates. Phase 1 catches this — if the SFT judge agrees with Claude but disagrees with humans, you've cloned the bias.
- **Recommended judge size:** 7B is plenty for scoring. You're classifying, not generating prose. Don't match the 20B writer — judge size and writer size aren't coupled.

#### Phase 3 — DPO on hard cases (only if Phase 2 plateaus)
- Find pages where SFT judge disagrees with humans. Build pairwise (preferred, dispreferred) judgments.
- DPO fine-tune on top of the SFT judge.
- **Deliverable:** `GhostScientist/semanticwiki-judge-7b-dpo`.
- **Effort:** 1 week incremental. Cost: similar.
- **When to pull this lever:** if SFT-judge / human agreement plateaus below ~80%.

#### Phase 4 — Full RLAIF (probably never)
- Reward model + PPO loop on judge outputs. This is where infra cost balloons (vLLM-backed rollout, more bookkeeping). The marginal gain over DPO for a scoring task is small.
- **Recommendation:** skip unless evals matter enough that you're staffing them like a research project.

### What I'd actually do

**Do Phase 0 now (under #10), then Phase 1 the week after.** Stop and reassess. If the Claude judge correlates with your hand-grades at >85%, you don't need a custom judge at all — you ship Claude-as-judge as the production answer and the local judge becomes a "best effort offline" mode. Phase 2+ only happens if (a) you want true offline eval, or (b) Claude judge correlation is poor.

**Do not start Phase 2 before Phase 1.** Training without ground truth is a guarantee of producing a confidently-wrong judge.

### Cost summary

| Phase | Time | $ | Output |
|-------|------|---|--------|
| 0 | 1 week | <$10 in Claude calls | Eval CLI + baselines |
| 1 | 1 day | $0 | Gold dataset (the most valuable artifact in this whole plan) |
| 2 | 1–2 weeks | ~$30–80 | Custom 7B judge model |
| 3 | 1 week | ~$30 | DPO judge |
| 4 | 1+ month | $$$ | (skip) |

---

## 6. CLI Surface

```bash
# Run all checks on a generated wiki
semanticwiki eval <wiki-dir>

# Run only deterministic checks (CI default)
semanticwiki eval <wiki-dir> --no-llm-judge

# Add LLM-judge scoring
semanticwiki eval <wiki-dir> --llm-judge                  # Claude API
semanticwiki eval <wiki-dir> --llm-judge --local          # local judge
semanticwiki eval <wiki-dir> --llm-judge --sample 5       # spot-check N pages

# Compare two wikis
semanticwiki eval --compare <wiki-a> <wiki-b>

# Compare across fixtures (full sweep)
semanticwiki eval --suite                                  # runs against all fixtures
semanticwiki eval --suite --against <baseline-run>         # delta vs prior run

# JSON output for scripting
semanticwiki eval <wiki-dir> --json
```

Reports written to `<wiki-dir>/.eval-report.json` and `<wiki-dir>/.eval-report.md` by default.

---

## 7. Code Layout

```
src/eval/
  index.ts              # CLI entry, exported from cli.ts
  rubric.ts             # Manual rubric definitions (the canonical source)
  checks/
    links.ts            # Link integrity
    refs.ts             # file:line validation
    mermaid.ts          # Diagram parse via mermaid CLI
    stubs.ts            # Stub/empty page detection
    coverage.ts         # Coverage proxy
    plan-adherence.ts   # Page-plan adherence
    markdown.ts         # Markdown sanity
  judge/
    index.ts            # Judge orchestration
    prompt.ts           # Judge system prompt
    aggregate.ts        # Per-page → wiki-level aggregation
  compare.ts            # Diff two reports
  suite.ts              # Run against fixtures.json
  report.ts             # Markdown + JSON output

tests/eval/
  fixtures.json         # Pinned fixture commits
  gold/                 # Hand-graded scores (Phase 1 output)
  golden/               # Generated wikis kept for trend tracking
```

---

## 8. Scope for This PR (#10)

**In:**
- Manual rubric (this doc; canonical version under `src/eval/rubric.ts`)
- All seven automated checks
- `semanticwiki eval` CLI with `--llm-judge` (Claude API + local), `--compare`, `--suite`, `--json`
- Fixture manifest (5 repos, pinned commits)
- Baseline run results checked in for the 5 fixtures

**Out (follow-ups):**
- Phase 1 hand-graded gold dataset (separate session, ~1 day of focused review)
- Phase 2+ judge fine-tune (separate issues, post-#10)
- DeepWiki head-to-head (separate issue, depends on this rubric)

---

## Open questions before I cut code

1. **Fixture COBOL repo** — do you have a preferred one, or should I pick a GnuCOBOL sample?
2. **Self-fixture commit pin** — pin to current `master` (`438524a`), or to last release tag?
3. **`mermaid` CLI dep** — happy to add `@mermaid-js/mermaid-cli` as a dev dep for the parse check, or do you want to validate via a lighter regex/AST approach?
4. **Eval report format** — is markdown + JSON enough, or do you want HTML for trend-line charting?
5. **Judge model default** — Sonnet 4.6 (cheaper, faster) or Opus 4.7 (highest quality, more $)? I'd default Sonnet.
