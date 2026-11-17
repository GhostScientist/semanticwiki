"""The Python reward must reproduce the TypeScript reward on the shared fixture."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from semanticwiki_reward import InMemoryRepository, extract_citations, score_page, verify_citations  # noqa: E402

FIXTURE = os.path.join(os.path.dirname(__file__), "..", "..", "tests", "fixtures", "reward-conformance.json")


def load_cases():
    with open(FIXTURE, encoding="utf-8") as handle:
        return json.load(handle)["cases"]


def test_conformance():
    failures = []
    for case in load_cases():
        citations = verify_citations(extract_citations(case["page"]), InMemoryRepository(case["repo"]), case.get("context"))
        score = score_page(case["page"], citations, case.get("stopReason"))
        got = {"components": score.components, "reward": score.reward, "guards": score.guard_names, "citations": score.citations,
               "structure": score.structure["checks"], "diagrams": {"total": score.diagrams["total"], "valid": score.diagrams["valid"]}}
        expected = case["expected"]
        if got != expected:
            failures.append((case["name"], got, expected))
    assert not failures, "\n".join(f"{name}\n  got      {got}\n  expected {expected}" for name, got, expected in failures)


if __name__ == "__main__":
    test_conformance()
    print(f"conformance ok ({len(load_cases())} cases)")
