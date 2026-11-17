#!/usr/bin/env python3
"""Score any model on the held-out page task with the harness reward.

Serves the paired protocol from SemanticWiki-Eval v3 (same repos, same prompts for every
arm) but with the harness prompt and the harness reward, so an offline number here means
the same thing as `semanticwiki eval` on a generated wiki. The output is an EvalReport
(formatVersion 1) and can be compared with:

    semanticwiki eval --compare before.json after.json

Any OpenAI-compatible chat endpoint works: vLLM, llama-server, Ollama, or a hosted API.

    python eval_runner.py --base-url http://localhost:8000/v1 --model sw-coder-7b \
        --repo-list eval_repo_list.json --repos-dir eval_snapshots --harvest --out reports/7b.json

Set OPENAI_API_KEY (or --api-key) for hosted endpoints. `--repair` runs the harness's one
repair turn so the report matches what the CLI would ship.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))
from semanticwiki_reward import (  # noqa: E402
    PROMPT_VERSION, REWARD_VERSION, SYSTEM_PROMPT, WEIGHTS, build_page_prompt, build_repair_prompt,
    evidence_budget_chars, extract_citations, score_page, select_windows, verify_citations,
)
from semanticwiki_reward.evidence import PAGE_TASKS  # noqa: E402
from semanticwiki_reward.reward import mean, round3  # noqa: E402
from semanticwiki_reward.snapshots import iter_snapshots  # noqa: E402


def chat(base_url: str, api_key: Optional[str], model: str, messages: List[dict], temperature: float, max_tokens: int, timeout: int = 600) -> Dict[str, Any]:
    body = json.dumps({"model": model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens}).encode()
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    request = urllib.request.Request(base_url.rstrip("/") + "/chat/completions", data=body, headers=headers)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                data = json.loads(response.read())
            choice = data["choices"][0]
            finish = choice.get("finish_reason")
            return {"content": choice["message"].get("content") or "", "stop_reason": "max_tokens" if finish == "length" else "end_turn", "usage": data.get("usage")}
        except urllib.error.HTTPError as error:
            if error.code in (429, 500, 502, 503, 504) and attempt < 3:
                time.sleep(2 ** attempt * 5)
                continue
            raise
    raise RuntimeError("unreachable")


def stub_chat(messages: List[dict], spans: List[dict]) -> Dict[str, Any]:
    first = spans[0]
    page = (f"# Page\n\n## Overview\n\n{'The module coordinates the request lifecycle. ' * 40}\n\n"
            f"The entry point is in `{first['file']}:{first['start']}-{min(first['end'], first['start'] + 4)}`.\n")
    return {"content": page, "stop_reason": "end_turn", "usage": None}


def evaluate_one(args, snapshot, category: str) -> Optional[Dict[str, Any]]:
    title, page_type, context = PAGE_TASKS[category]
    budget = evidence_budget_chars(args.context_length, reply_tokens=args.max_tokens)
    windows = select_windows(snapshot, budget, query_terms=title.split())
    if not windows:
        return None
    spans = [w.as_span() for w in windows]
    prompt = build_page_prompt(title, page_type, context, snapshot.name, windows)
    messages = [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": prompt}]
    reply = stub_chat(messages, spans) if args.dry_run else chat(args.base_url, args.api_key, args.model, messages, args.temperature, args.max_tokens)
    content = reply["content"]
    citations = verify_citations(extract_citations(content), snapshot, spans)
    score = score_page(content, citations, reply["stop_reason"])
    repaired = False
    problems = [c for c in citations if c.status != "valid"]
    if args.repair and problems and reply["stop_reason"] == "end_turn":
        repair = build_repair_prompt([{"file": p.file, "start": p.start, "end": p.end, "status": p.status} for p in problems], windows)
        repair_reply = stub_chat(messages, spans) if args.dry_run else chat(args.base_url, args.api_key, args.model, messages + [{"role": "assistant", "content": content}, {"role": "user", "content": repair}], 0.1, args.max_tokens)
        candidate = repair_reply["content"]
        if repair_reply["stop_reason"] == "end_turn" and len(candidate) > 200:
            candidate_citations = verify_citations(extract_citations(candidate), snapshot, spans)
            candidate_score = score_page(candidate, candidate_citations, "end_turn")
            if candidate_score.reward >= score.reward and candidate_score.citations["valid"] >= score.citations["valid"]:
                content, citations, score, repaired = candidate, candidate_citations, candidate_score, True
    return {
        "path": f"{snapshot.name.replace('/', '__')}/{category}.md",
        "title": title,
        "contextSource": "spans",
        "rewardVersion": REWARD_VERSION,
        "citations": score.citations,
        "components": score.components,
        "base": score.base,
        "guards": score.guards,
        "reward": score.reward,
        "structure": score.structure,
        "diagrams": score.diagrams,
        "problems": [{"file": c.file, "start": c.start, "end": c.end, "status": c.status, "pageLine": c.page_line} for c in citations if c.status != "valid"],
        "trust": "machine-confirmed" if score.citations["total"] and score.citations["valid"] == score.citations["total"] else "unverified",
        "repaired": repaired,
        "stopReason": reply["stop_reason"],
        "usage": reply.get("usage"),
        "content": content if args.keep_pages else None,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", default=os.environ.get("OPENAI_BASE_URL", "http://localhost:8000/v1"))
    parser.add_argument("--api-key", default=os.environ.get("OPENAI_API_KEY"))
    parser.add_argument("--model", default="default")
    parser.add_argument("--repos-dir", default=None)
    parser.add_argument("--repo-list", default=None, help="Pinned held-out set, e.g. eval_repo_list.json from GhostScientist/semanticwiki-eval-v3")
    parser.add_argument("--harvest", action="store_true")
    parser.add_argument("--max-repos", type=int, default=None)
    parser.add_argument("--categories", default="architecture_overview,data_flow")
    parser.add_argument("--context-length", type=int, default=16384)
    parser.add_argument("--max-tokens", type=int, default=4096)
    parser.add_argument("--temperature", type=float, default=0.2)
    parser.add_argument("--repair", action="store_true", help="Run the harness repair turn on unresolved citations")
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--keep-pages", action="store_true", help="Store generated Markdown in the report")
    parser.add_argument("--out", default="eval-report.json")
    parser.add_argument("--dry-run", action="store_true", help="Use a stub writer; exercises prompts and scoring without a server")
    args = parser.parse_args()

    categories = [c.strip() for c in args.categories.split(",") if c.strip()]
    jobs = [(snapshot, category) for snapshot in iter_snapshots(args.repos_dir, args.repo_list, args.harvest, args.max_repos) for category in categories]
    if not jobs:
        print("No repositories found. Pass --repos-dir or --repo-list (with --harvest).", file=sys.stderr)
        return 2
    print(f"[eval] {len(jobs)} pages over {len({s.name for s, _ in jobs})} repos, model {args.model}, prompt {PROMPT_VERSION}, reward {REWARD_VERSION}")
    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        pages = [page for page in pool.map(lambda job: evaluate_one(args, *job), jobs) if page]

    guard_counts: Dict[str, int] = {}
    for page in pages:
        for guard in page["guards"]:
            guard_counts[guard["name"]] = guard_counts.get(guard["name"], 0) + 1
    total = sum(p["citations"]["total"] for p in pages)
    valid = sum(p["citations"]["valid"] for p in pages)
    report = {
        "formatVersion": 1,
        "rewardVersion": REWARD_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "wikiDir": f"eval://{args.model}",
        "repoPath": args.repos_dir or args.repo_list or "",
        "arm": {"model": args.model, "baseUrl": None if args.dry_run else args.base_url, "promptVersion": PROMPT_VERSION, "temperature": args.temperature, "maxTokens": args.max_tokens, "contextLength": args.context_length, "repair": args.repair},
        "pages": pages,
        "links": {"total": 0, "broken": []},
        "coverage": {"sourceFiles": 0, "citedFiles": 0, "fraction": 0},
        "summary": {
            "pages": len(pages),
            "meanReward": round3(mean([p["reward"] for p in pages])),
            "components": {key: round3(mean([p["components"][key] for p in pages])) for key in WEIGHTS},
            "citations": {"total": total, "valid": valid, "validity": round3(valid / total) if total else 0,
                          "uncitedPages": sum(1 for p in pages if p["citations"]["total"] == 0),
                          "hallucinatedPathPages": guard_counts.get("hallucinated-paths", 0)},
            "diagrams": {"total": sum(p["diagrams"]["total"] for p in pages), "invalid": sum(p["diagrams"]["invalid"] for p in pages)},
            "brokenLinks": 0,
            "guardCounts": guard_counts,
            "repairedPages": sum(1 for p in pages if p["repaired"]),
            "truncatedPages": sum(1 for p in pages if p["stopReason"] != "end_turn"),
        },
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(report, indent=2) + "\n")
    print(f"[eval] mean reward {report['summary']['meanReward']} · validity {report['summary']['citations']['validity']} · components {report['summary']['components']}")
    print(f"[eval] wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
