"""The Python prompt builder must reproduce the harness prompt byte for byte."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from semanticwiki_reward import PROMPT_VERSION, SYSTEM_PROMPT, EvidenceWindow, build_page_prompt, build_repair_prompt  # noqa: E402

FIXTURE = os.path.join(os.path.dirname(__file__), "..", "..", "tests", "fixtures", "prompt-conformance.json")


def test_prompt_conformance():
    with open(FIXTURE, encoding="utf-8") as handle:
        fixture = json.load(handle)
    assert fixture["promptVersion"] == PROMPT_VERSION
    assert fixture["systemPrompt"] == SYSTEM_PROMPT
    windows = [EvidenceWindow(w["file"], w["start"], w["end"], w["fileLines"], w["lines"]) for w in fixture["windows"]]
    assert build_page_prompt("Auth", "component", "Token validation", "fixture", windows, "- [Index](./index.md)") == fixture["prompt"]
    assert build_repair_prompt([{"file": "src/c.ts", "start": 1, "end": 5, "status": "file-not-found"}, {"file": "src/a.ts", "start": 40, "end": 40, "status": "line-out-of-bounds"}], windows) == fixture["repair"]
    docs = [EvidenceWindow("README.md", 1, 2, 2, ["# Fixture", "Readme body"])]
    assert build_page_prompt("Auth", "component", "Token validation", "fixture", docs, "- [Index](./index.md)") == fixture["docsOnlyPrompt"]
    assert build_page_prompt("Auth", "component", "Token validation", "fixture", [], "- [Index](./index.md)") == fixture["emptyPrompt"]


if __name__ == "__main__":
    test_prompt_conformance()
    print("prompt conformance ok")
