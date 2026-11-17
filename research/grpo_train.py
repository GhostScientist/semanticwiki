#!/usr/bin/env python3
"""GRPO training on verifiable page rewards (RLVR) for SemanticWiki writers.

Why RL here, and not more SFT: the v3 study showed the same SFT recipe raised citation
validity on Qwen2.5-Coder-14B (+0.38) and *lowered* it on Qwen3-14B (-0.29) because SFT
replaces the base policy's style wholesale. GRPO with a KL anchor only moves the policy
where the verifier says it is wrong, so a strong base keeps what it already does well.

Prompts are built exactly as the harness builds them (see semanticwiki_reward.evidence),
and completions are scored by the same reward the CLI reports (`semanticwiki eval`).

    python grpo_train.py --repos-dir snapshots/ --model Qwen/Qwen2.5-Coder-7B-Instruct \
        --lora --use-vllm --output out/sw-coder-7b-rlvr

    python grpo_train.py --repos-dir snapshots/ --dry-run      # builds prompts, no GPU

Snapshots: extract repo_snapshots.tar.gz from GhostScientist/semanticwiki-data-v3 (97 repos)
or pass --repo-list repo_registry.json --harvest to download them.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List

sys.path.insert(0, str(Path(__file__).resolve().parent))
from semanticwiki_reward import (  # noqa: E402
    PROMPT_VERSION, REWARD_VERSION, SYSTEM_PROMPT, WEIGHTS, FilesystemRepository,
    build_page_prompt, evidence_budget_chars, select_windows,
)
from semanticwiki_reward.evidence import PAGE_TASKS  # noqa: E402
from semanticwiki_reward.reward import score_markdown  # noqa: E402
from semanticwiki_reward.snapshots import iter_snapshots  # noqa: E402


def build_rows(args) -> List[Dict[str, Any]]:
    rows = []
    budget = evidence_budget_chars(args.context_length, reply_tokens=args.max_completion_length)
    categories = [c.strip() for c in args.categories.split(",") if c.strip()]
    for snapshot in iter_snapshots(args.repos_dir, args.repo_list, args.harvest, args.max_repos):
        for category in categories:
            title, page_type, context = PAGE_TASKS[category]
            windows = select_windows(snapshot, budget, query_terms=title.split())
            if not windows:
                continue
            prompt = build_page_prompt(title, page_type, context, snapshot.name, windows)
            rows.append({
                "prompt": [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": prompt}],
                "repo_dir": str(snapshot.root),
                "repo": snapshot.name,
                "category": category,
                "context_spans": json.dumps([w.as_span() for w in windows]),
            })
    random.Random(args.seed).shuffle(rows)
    if args.max_prompts:
        rows = rows[: args.max_prompts]
    return rows


class RewardFunctions:
    """One total reward (weight 1) plus zero-weight component monitors so TRL logs each axis."""

    def __init__(self, max_completion_length: int):
        self.max_completion_length = max_completion_length
        self.stats = defaultdict(list)
        self._cache: Dict[int, Any] = {}

    def _score(self, completion, repo_dir: str, context_spans: str, completion_ids=None):
        text = completion[0]["content"] if isinstance(completion, list) else str(completion)
        key = hash((text, repo_dir, context_spans))
        if key not in self._cache:
            truncated = completion_ids is not None and len(completion_ids) >= self.max_completion_length
            score = score_markdown(text, FilesystemRepository(repo_dir), json.loads(context_spans), "max_tokens" if truncated else "end_turn")
            self._cache[key] = score
            if len(self._cache) > 4096:
                self._cache.clear()
        return self._cache[key]

    def total(self, completions, repo_dir, context_spans, completion_ids=None, **_):
        rewards = []
        ids = completion_ids or [None] * len(completions)
        for completion, repo, spans, cids in zip(completions, repo_dir, context_spans, ids):
            score = self._score(completion, repo, spans, cids)
            rewards.append(score.reward)
            for name, value in score.components.items():
                self.stats[name].append(value)
            for guard in score.guard_names:
                self.stats[f"guard/{guard}"].append(1.0)
        return rewards

    def component(self, name: str):
        def monitor(completions, repo_dir, context_spans, completion_ids=None, **_):
            ids = completion_ids or [None] * len(completions)
            return [self._score(c, r, s, i).components[name] for c, r, s, i in zip(completions, repo_dir, context_spans, ids)]
        monitor.__name__ = f"component_{name}"
        return monitor


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", default="Qwen/Qwen2.5-Coder-7B-Instruct")
    parser.add_argument("--adapter", default=None, help="PEFT adapter to merge before training (e.g. a v3 SFT adapter)")
    parser.add_argument("--repos-dir", default=None, help="Directory of repository checkouts (one per subdirectory)")
    parser.add_argument("--repo-list", default=None, help="JSON list of repos (repo_registry.json); pair with --harvest")
    parser.add_argument("--harvest", action="store_true", help="Download missing repos from GitHub")
    parser.add_argument("--max-repos", type=int, default=None)
    parser.add_argument("--max-prompts", type=int, default=None)
    parser.add_argument("--categories", default=",".join(PAGE_TASKS))
    parser.add_argument("--context-length", type=int, default=16384, help="Writer context the prompts are sized for")
    parser.add_argument("--max-completion-length", type=int, default=2048)
    parser.add_argument("--num-generations", type=int, default=8, help="Group size per prompt")
    parser.add_argument("--beta", type=float, default=0.04, help="KL penalty toward the reference policy")
    parser.add_argument("--learning-rate", type=float, default=None)
    parser.add_argument("--epochs", type=float, default=1.0)
    parser.add_argument("--lora", action="store_true")
    parser.add_argument("--lora-rank", type=int, default=32)
    parser.add_argument("--use-vllm", action="store_true", help="Sample with vLLM (colocate mode)")
    parser.add_argument("--per-device-batch", type=int, default=2)
    parser.add_argument("--grad-accum", type=int, default=4)
    parser.add_argument("--output", default="out/semanticwiki-rlvr")
    parser.add_argument("--push-to-hub", default=None, help="Hub repo id to push the adapter/model to")
    parser.add_argument("--report-to", default="none", help="trackio, wandb, tensorboard or none")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--dry-run", action="store_true", help="Build prompts and score a synthetic completion; no ML imports")
    args = parser.parse_args()

    rows = build_rows(args)
    if not rows:
        print("No prompts built. Pass --repos-dir with checkouts or --repo-list with --harvest.", file=sys.stderr)
        return 2
    print(f"[grpo] {len(rows)} prompts from {len({r['repo'] for r in rows})} repos, prompt version {PROMPT_VERSION}, reward version {REWARD_VERSION}")
    lengths = sorted(len(r["prompt"][1]["content"]) for r in rows)
    print(f"[grpo] prompt chars: min {lengths[0]}, median {lengths[len(lengths)//2]}, max {lengths[-1]}")

    if args.dry_run:
        rewards = RewardFunctions(args.max_completion_length)
        sample = rows[0]
        spans = json.loads(sample["context_spans"])
        first = spans[0]
        fake = (f"# Page\n\n## Overview\n\n{'This component coordinates work. ' * 40}\n\nThe entry point is defined in "
                f"`{first['file']}:{first['start']}-{min(first['end'], first['start'] + 5)}` and a phantom in `nope/missing.py:1`.\n")
        print("[grpo] dry run reward:", rewards.total([[{"role": "assistant", "content": fake}]], [sample["repo_dir"]], [sample["context_spans"]]))
        print("[grpo] dry run components:", {k: v[-1] for k, v in rewards.stats.items()})
        out = Path(args.output); out.mkdir(parents=True, exist_ok=True)
        (out / "prompts-dry-run.jsonl").write_text("\n".join(json.dumps(r) for r in rows[:5]) + "\n")
        print(f"[grpo] wrote {out / 'prompts-dry-run.jsonl'}")
        return 0

    from datasets import Dataset
    from trl import GRPOConfig, GRPOTrainer

    dataset = Dataset.from_list(rows)
    rewards = RewardFunctions(args.max_completion_length)
    reward_funcs = [rewards.total] + [rewards.component(name) for name in WEIGHTS]
    reward_weights = [1.0] + [0.0] * len(WEIGHTS)

    peft_config = None
    if args.lora:
        from peft import LoraConfig
        peft_config = LoraConfig(r=args.lora_rank, lora_alpha=args.lora_rank * 2, lora_dropout=0.05, task_type="CAUSAL_LM",
                                 target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"])

    model = args.model
    if args.adapter:
        import torch
        from peft import PeftModel
        from transformers import AutoModelForCausalLM
        base = AutoModelForCausalLM.from_pretrained(args.model, dtype=torch.bfloat16)
        model = PeftModel.from_pretrained(base, args.adapter).merge_and_unload()

    config = GRPOConfig(
        output_dir=args.output,
        learning_rate=args.learning_rate or (2e-5 if args.lora else 1e-6),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.per_device_batch,
        gradient_accumulation_steps=args.grad_accum,
        num_generations=args.num_generations,
        max_prompt_length=None,
        max_completion_length=args.max_completion_length,
        beta=args.beta,
        temperature=0.8,
        reward_weights=reward_weights,
        bf16=True,
        gradient_checkpointing=True,
        logging_steps=1,
        save_steps=50,
        report_to=args.report_to,
        use_vllm=args.use_vllm,
        vllm_mode="colocate" if args.use_vllm else None,
        seed=args.seed,
        push_to_hub=bool(args.push_to_hub),
        hub_model_id=args.push_to_hub,
        log_completions=True,
    )
    trainer = GRPOTrainer(model=model, reward_funcs=reward_funcs, args=config, train_dataset=dataset, peft_config=peft_config)
    trainer.train()
    trainer.save_model(args.output)
    summary = {name: sum(values) / len(values) for name, values in rewards.stats.items() if values}
    Path(args.output, "reward-summary.json").write_text(json.dumps({"rewardVersion": REWARD_VERSION, "promptVersion": PROMPT_VERSION, "means": summary}, indent=2))
    print("[grpo] mean reward components over training:", json.dumps(summary, indent=2))
    if args.push_to_hub:
        trainer.push_to_hub()
    return 0


if __name__ == "__main__":
    sys.exit(main())
