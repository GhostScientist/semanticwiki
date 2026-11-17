# SemanticWiki research kit

Python half of the evaluation loop. The TypeScript harness (`src/eval`, `src/local-page.ts`)
scores pages at generation time and in `semanticwiki eval`; this kit scores the same way
during training and offline evaluation. The two are held equal by two fixtures that both
test suites load:

- `tests/fixtures/reward-conformance.json`: pages + repository + expected scores.
- `tests/fixtures/prompt-conformance.json`: evidence windows + expected prompt text.

Regenerate the fixtures only when the TypeScript side changes on purpose, then make this
side match. Bump `REWARD_VERSION` / `LOCAL_PAGE_PROMPT_VERSION` in both languages together.

## Layout

| Path | Purpose |
| --- | --- |
| `semanticwiki_reward/reward.py` | Citation grammar, verifier, structure and Mermaid checks, page reward with guards (mirror of `src/eval`). No ML imports. |
| `semanticwiki_reward/evidence.py` | Line-numbered evidence windows, file ranking, the page/repair prompts (mirror of `src/local-page.ts`). |
| `semanticwiki_reward/snapshots.py` | Repository snapshots from local checkouts or GitHub tarballs. |
| `grpo_train.py` | TRL GRPO training on the verifiable reward (RLVR), LoRA or full, optional vLLM sampling. |
| `eval_runner.py` | Paired held-out evaluation of any OpenAI-compatible endpoint; emits a `semanticwiki eval` report. |
| `tests/` | Conformance tests (run with `python3 -I tests/test_reward_conformance.py`, or pytest). |

## Quick start

```bash
# 1. Conformance (no dependencies beyond the standard library)
python3 -I research/tests/test_reward_conformance.py
python3 -I research/tests/test_prompt_conformance.py

# 2. Held-out evaluation of a served model (vLLM, llama-server, Ollama, hosted API)
hf download GhostScientist/semanticwiki-eval-v3 eval_repo_list.json --repo-type dataset --local-dir research/data
python3 research/eval_runner.py --base-url http://localhost:8000/v1 --model sw-coder-7b-v2 \
  --repo-list research/data/eval_repo_list.json --repos-dir research/data/eval_snapshots --harvest \
  --repair --out research/reports/7b-v2.json
semanticwiki eval --compare research/reports/7b-v2.json research/reports/candidate.json

# 3. Training (GPU; pip install "trl>=0.21" peft datasets vllm)
hf download GhostScientist/semanticwiki-data-v3 repo_snapshots.tar.gz --repo-type dataset --local-dir research/data
tar -xzf research/data/repo_snapshots.tar.gz -C research/data/
python3 research/grpo_train.py --repos-dir research/data/repo_snapshots \
  --model Qwen/Qwen2.5-Coder-7B-Instruct --lora --use-vllm --num-generations 8 --beta 0.04 \
  --output research/out/sw-coder-7b-rlvr --report-to trackio
```

Both scripts have `--dry-run` modes that build prompts and score a synthetic completion
with no model, which is how CI exercises the data path.

The training and evaluation repositories must stay disjoint: `repo_registry.json` (training)
and `eval_repo_list.json` (held out) from the v3 datasets already are.

See `docs/research/REWARD_LOOP.md` for the reward's derivation and the experiment protocol.
