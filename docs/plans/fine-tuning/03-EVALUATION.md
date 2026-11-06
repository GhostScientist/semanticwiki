# Evaluation Plan

This document outlines the evaluation methodology to verify that the fine-tuned gpt-oss-20b model improves over the base model for architectural wiki generation in SemanticWiki.

## Overview

### Evaluation Goals

1. **Demonstrate improvement** over base gpt-oss-20b on wiki generation tasks
2. **Measure task-specific capabilities** (source traceability, diagram generation, etc.)
3. **Ensure no regression** on general capabilities
4. **Benchmark against alternatives** (Claude, Qwen 2.5 Coder, DeepWiki)

### Evaluation Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│                    Evaluation Pipeline                          │
├─────────────────────────────────────────────────────────────────┤
│  1. Automated Metrics    → BLEU, ROUGE, BERTScore, Custom       │
│  2. CodeWikiBench        → Standardized benchmark comparison    │
│  3. Task-Specific Evals  → Source refs, diagrams, tool use      │
│  4. End-to-End Testing   → Full wiki generation on real repos   │
│  5. Human Evaluation     → Expert review of generated wikis     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 1. Automated Metrics

### 1.1 Standard NLG Metrics

These metrics compare generated documentation against reference documentation.

```python
from evaluate import load
import numpy as np

# Load metrics
bleu = load("bleu")
rouge = load("rouge")
bertscore = load("bertscore")

def compute_standard_metrics(predictions: list[str], references: list[str]) -> dict:
    """
    Compute standard NLG metrics for documentation quality.
    """
    results = {}

    # BLEU (n-gram precision)
    bleu_result = bleu.compute(predictions=predictions, references=references)
    results["bleu"] = bleu_result["bleu"]

    # ROUGE (recall-oriented)
    rouge_result = rouge.compute(predictions=predictions, references=references)
    results["rouge1"] = rouge_result["rouge1"]
    results["rouge2"] = rouge_result["rouge2"]
    results["rougeL"] = rouge_result["rougeL"]

    # BERTScore (semantic similarity)
    bertscore_result = bertscore.compute(
        predictions=predictions,
        references=references,
        lang="en",
        model_type="microsoft/deberta-xlarge-mnli"
    )
    results["bertscore_f1"] = np.mean(bertscore_result["f1"])

    return results
```

### 1.2 Target Scores

| Metric | Base gpt-oss-20b | Target (Fine-tuned) | Improvement |
|--------|------------------|---------------------|-------------|
| BLEU | ~0.15 | >0.25 | +67% |
| ROUGE-L | ~0.35 | >0.50 | +43% |
| BERTScore F1 | ~0.70 | >0.80 | +14% |

### 1.3 Limitations of Standard Metrics

Standard metrics have known limitations for documentation:
- BLEU penalizes valid paraphrasing
- ROUGE doesn't capture semantic correctness
- BERTScore may miss structural quality

**Recommendation:** Use standard metrics as a baseline, but rely more heavily on task-specific and human evaluation.

---

## 2. CodeWikiBench Evaluation

### 2.1 Benchmark Overview

[CodeWikiBench](https://github.com/FSoft-AI4Code/CodeWikiBench) is the first benchmark for repository-level documentation quality.

- **Repositories:** 22 projects across 6 languages
- **Rubrics:** Hierarchical quality assessment criteria
- **Baseline:** DeepWiki achieves 68.79% with proprietary models

### 2.2 Running CodeWikiBench

```bash
# Clone benchmark
git clone https://github.com/FSoft-AI4Code/CodeWikiBench
cd CodeWikiBench

# Install dependencies
pip install -r requirements.txt

# Load dataset
python -c "
from datasets import load_dataset
dataset = load_dataset('anhnh2002/codewikibench')
print(f'Loaded {len(dataset[\"train\"])} repositories')
"
```

### 2.3 Evaluation Script

```python
from datasets import load_dataset
from codewikibench import evaluate_documentation

def evaluate_on_codewikibench(model, tokenizer, num_repos: int = 5):
    """
    Evaluate model on CodeWikiBench subset.
    """
    dataset = load_dataset("anhnh2002/codewikibench")

    results = []
    for repo in dataset["train"][:num_repos]:
        # Generate documentation
        generated_docs = generate_wiki_for_repo(
            model, tokenizer,
            repo_name=repo["repo_name"],
            commit_id=repo["commit_id"]
        )

        # Evaluate against rubrics
        scores = evaluate_documentation(
            generated=generated_docs,
            reference=repo["structured_docs"],
            rubrics=repo["rubrics"]
        )

        results.append({
            "repo": repo["repo_name"],
            "scores": scores
        })

    return aggregate_results(results)
```

### 2.4 Target Performance

| Model | CodeWikiBench Score | Notes |
|-------|---------------------|-------|
| DeepWiki (baseline) | 68.79% | Proprietary |
| CodeWiki (open) | 64.80% | Open-source |
| gpt-oss-20b (base) | ~55-60% | Estimated |
| **gpt-oss-20b (fine-tuned)** | **>70%** | **Target** |

---

## 3. Task-Specific Evaluation

### 3.1 Source Traceability Score

Measures the model's ability to generate accurate `file:line` references.

```python
import re
from pathlib import Path

def evaluate_source_traceability(
    generated_doc: str,
    repo_path: str
) -> dict:
    """
    Evaluate source reference accuracy.
    """
    # Extract file:line references
    pattern = r'`([a-zA-Z0-9/_.-]+):(\d+)(?:-(\d+))?`'
    references = re.findall(pattern, generated_doc)

    total_refs = len(references)
    valid_refs = 0
    invalid_refs = []

    for file_path, start_line, end_line in references:
        full_path = Path(repo_path) / file_path

        if full_path.exists():
            lines = full_path.read_text().split('\n')
            start = int(start_line)
            end = int(end_line) if end_line else start

            # Check line numbers are valid
            if 1 <= start <= len(lines) and 1 <= end <= len(lines):
                valid_refs += 1
            else:
                invalid_refs.append(f"{file_path}:{start_line} (line out of range)")
        else:
            invalid_refs.append(f"{file_path} (file not found)")

    return {
        "total_references": total_refs,
        "valid_references": valid_refs,
        "accuracy": valid_refs / total_refs if total_refs > 0 else 0,
        "invalid_refs": invalid_refs,
        "has_references": total_refs > 0
    }
```

**Target Scores:**

| Metric | Base | Target |
|--------|------|--------|
| Reference Accuracy | <50% | >90% |
| References per 1K words | ~2 | >10 |
| File existence accuracy | ~60% | >95% |

### 3.2 Mermaid Diagram Quality

Evaluate generated architecture diagrams.

```python
import subprocess
import tempfile

def evaluate_mermaid_diagrams(generated_doc: str) -> dict:
    """
    Extract and validate Mermaid diagrams.
    """
    # Extract mermaid blocks
    mermaid_pattern = r'```mermaid\n(.*?)```'
    diagrams = re.findall(mermaid_pattern, generated_doc, re.DOTALL)

    results = {
        "total_diagrams": len(diagrams),
        "valid_syntax": 0,
        "renders_successfully": 0,
        "diagram_types": [],
    }

    for diagram in diagrams:
        # Check syntax validity
        if validate_mermaid_syntax(diagram):
            results["valid_syntax"] += 1

        # Check rendering
        if render_mermaid(diagram):
            results["renders_successfully"] += 1

        # Identify diagram type
        diagram_type = identify_diagram_type(diagram)
        results["diagram_types"].append(diagram_type)

    results["syntax_accuracy"] = (
        results["valid_syntax"] / results["total_diagrams"]
        if results["total_diagrams"] > 0 else 0
    )

    return results

def validate_mermaid_syntax(diagram: str) -> bool:
    """Validate Mermaid diagram syntax using mmdc CLI."""
    try:
        with tempfile.NamedTemporaryFile(mode='w', suffix='.mmd') as f:
            f.write(diagram)
            f.flush()
            result = subprocess.run(
                ['mmdc', '-i', f.name, '-o', '/dev/null', '--quiet'],
                capture_output=True,
                timeout=10
            )
            return result.returncode == 0
    except Exception:
        return False

def identify_diagram_type(diagram: str) -> str:
    """Identify the type of Mermaid diagram."""
    first_line = diagram.strip().split('\n')[0].lower()
    if 'flowchart' in first_line or 'graph' in first_line:
        return 'flowchart'
    elif 'sequencediagram' in first_line or 'sequence' in first_line:
        return 'sequence'
    elif 'classdiagram' in first_line or 'class' in first_line:
        return 'class'
    elif 'erdiagram' in first_line or 'er' in first_line:
        return 'er'
    elif 'statediagram' in first_line or 'state' in first_line:
        return 'state'
    else:
        return 'unknown'
```

**Target Scores:**

| Metric | Base | Target |
|--------|------|--------|
| Diagrams per wiki | ~0.5 | >3 |
| Syntax validity | ~70% | >95% |
| Renders successfully | ~60% | >90% |

### 3.3 Tool Use Accuracy

Evaluate the model's ability to use SemanticWiki tools correctly.

```python
def evaluate_tool_use(
    model_outputs: list[dict],
    expected_tools: list[str]
) -> dict:
    """
    Evaluate tool calling accuracy.
    """
    results = {
        "total_tool_calls": 0,
        "valid_tool_calls": 0,
        "invalid_tool_calls": [],
        "tools_used": set(),
        "expected_tools_used": 0,
    }

    for output in model_outputs:
        if "tool_calls" in output:
            for call in output["tool_calls"]:
                results["total_tool_calls"] += 1
                results["tools_used"].add(call["name"])

                if validate_tool_call(call):
                    results["valid_tool_calls"] += 1
                else:
                    results["invalid_tool_calls"].append(call)

    # Check expected tools were used
    for expected in expected_tools:
        if expected in results["tools_used"]:
            results["expected_tools_used"] += 1

    results["tool_accuracy"] = (
        results["valid_tool_calls"] / results["total_tool_calls"]
        if results["total_tool_calls"] > 0 else 0
    )

    results["expected_coverage"] = (
        results["expected_tools_used"] / len(expected_tools)
        if expected_tools else 1
    )

    return results

EXPECTED_WIKI_TOOLS = [
    "search_codebase",
    "read_file",
    "analyze_code_structure",
    "write_wiki_page",
    "verify_wiki_completeness"
]
```

**Target Scores:**

| Metric | Base | Target |
|--------|------|--------|
| Tool call validity | ~80% | >95% |
| Expected tools used | ~60% | >90% |
| Tool call efficiency | N/A | <20 calls per page |

### 3.4 Documentation Completeness

Check that generated wikis cover all required sections.

```python
def evaluate_completeness(wiki_output: dict) -> dict:
    """
    Evaluate wiki completeness against expected structure.
    """
    expected_sections = {
        "architecture_overview": False,
        "component_docs": False,
        "data_flow": False,
        "getting_started": False,
        "mermaid_diagrams": False,
        "source_references": False,
        "internal_links": False,
    }

    # Check each section
    for page in wiki_output.get("pages", []):
        content = page.get("content", "")

        if "architecture" in page["path"].lower():
            expected_sections["architecture_overview"] = True

        if "component" in page["path"].lower() or "/components/" in page["path"]:
            expected_sections["component_docs"] = True

        if "data" in content.lower() and "flow" in content.lower():
            expected_sections["data_flow"] = True

        if "getting started" in content.lower() or "quickstart" in content.lower():
            expected_sections["getting_started"] = True

        if "```mermaid" in content:
            expected_sections["mermaid_diagrams"] = True

        if re.search(r'`[a-zA-Z0-9/_.-]+:\d+', content):
            expected_sections["source_references"] = True

        if re.search(r'\[.*?\]\(\.\./.*?\.md\)', content):
            expected_sections["internal_links"] = True

    completeness_score = sum(expected_sections.values()) / len(expected_sections)

    return {
        "sections": expected_sections,
        "completeness_score": completeness_score,
        "missing": [k for k, v in expected_sections.items() if not v]
    }
```

**Target Scores:**

| Metric | Base | Target |
|--------|------|--------|
| Section completeness | ~60% | >90% |
| All required sections | No | Yes |

---

## 4. End-to-End Evaluation

### 4.1 Test Repository Suite

Create a diverse set of test repositories:

| Repository | Language | Size | Complexity | Purpose |
|------------|----------|------|------------|---------|
| simple-api | TypeScript | 2K LOC | Low | Baseline test |
| react-dashboard | TypeScript | 15K LOC | Medium | Frontend patterns |
| fastapi-backend | Python | 10K LOC | Medium | Backend patterns |
| microservices-demo | Go | 25K LOC | High | Distributed systems |
| monorepo-example | Mixed | 50K LOC | High | Large codebase |

### 4.2 End-to-End Test Script

```python
import subprocess
import time
from pathlib import Path

def run_e2e_evaluation(
    model_path: str,
    test_repos: list[str],
    output_dir: str
) -> dict:
    """
    Run end-to-end wiki generation evaluation.
    """
    results = []

    for repo_path in test_repos:
        repo_name = Path(repo_path).name
        wiki_output = Path(output_dir) / repo_name

        # Time the generation
        start_time = time.time()

        # Run SemanticWiki with fine-tuned model
        result = subprocess.run([
            "semanticwiki", "generate",
            "-r", repo_path,
            "--full-local",
            "--model-path", model_path,
            "--output", str(wiki_output)
        ], capture_output=True, text=True)

        generation_time = time.time() - start_time

        # Evaluate output
        if result.returncode == 0:
            wiki_quality = evaluate_wiki_output(wiki_output, repo_path)
        else:
            wiki_quality = {"error": result.stderr}

        results.append({
            "repo": repo_name,
            "success": result.returncode == 0,
            "generation_time": generation_time,
            "quality": wiki_quality
        })

    return aggregate_e2e_results(results)

def evaluate_wiki_output(wiki_path: Path, repo_path: str) -> dict:
    """
    Comprehensive evaluation of generated wiki.
    """
    wiki_content = load_wiki(wiki_path)

    return {
        "traceability": evaluate_source_traceability(
            wiki_content["full_text"], repo_path
        ),
        "diagrams": evaluate_mermaid_diagrams(wiki_content["full_text"]),
        "completeness": evaluate_completeness(wiki_content),
        "broken_links": check_broken_links(wiki_path),
        "word_count": count_words(wiki_content["full_text"]),
        "page_count": len(wiki_content["pages"]),
    }
```

### 4.3 Performance Benchmarks

| Metric | Base gpt-oss-20b | Target (Fine-tuned) |
|--------|------------------|---------------------|
| Generation time (10K LOC) | ~15 min | <10 min |
| Token efficiency | ~50K tokens | <30K tokens |
| Retry rate | ~30% | <10% |
| Success rate | ~80% | >95% |

---

## 5. Human Evaluation

### 5.1 Evaluation Rubric

Expert reviewers rate generated documentation on:

| Criterion | Weight | Description |
|-----------|--------|-------------|
| **Accuracy** | 25% | Technical correctness of descriptions |
| **Completeness** | 20% | Coverage of system architecture |
| **Traceability** | 20% | Quality of source code references |
| **Clarity** | 15% | Readability and organization |
| **Diagrams** | 10% | Quality of visual representations |
| **Usefulness** | 10% | Would a developer find this helpful? |

### 5.2 Evaluation Protocol

```markdown
## Human Evaluation Instructions

For each generated wiki, evaluate on a scale of 1-5:

### 1. Accuracy (1-5)
- Does the documentation correctly describe the code?
- Are technical details accurate?
- Are there any factual errors?

### 2. Completeness (1-5)
- Are all major components documented?
- Is the architecture overview comprehensive?
- Are data flows explained?

### 3. Traceability (1-5)
- Are source references provided?
- Do file:line references point to correct locations?
- Can you navigate from docs to code easily?

### 4. Clarity (1-5)
- Is the writing clear and professional?
- Is the structure logical?
- Is technical jargon explained?

### 5. Diagrams (1-5)
- Are diagrams relevant and accurate?
- Do they aid understanding?
- Are they properly formatted?

### 6. Usefulness (1-5)
- Would this help a new developer onboard?
- Does it explain the "why" not just the "what"?
- Would you recommend this documentation?
```

### 5.3 Sample Size

- **Minimum:** 20 wiki generations (4 reviewers × 5 repos)
- **Recommended:** 50 wiki generations (5 reviewers × 10 repos)
- **Statistical power:** Detect 0.5 point improvement with 95% confidence

### 5.4 Inter-Rater Reliability

Calculate Krippendorff's alpha to ensure reviewer agreement:

```python
import krippendorff

def calculate_inter_rater_reliability(ratings: list[list[float]]) -> float:
    """
    Calculate inter-rater reliability using Krippendorff's alpha.
    """
    alpha = krippendorff.alpha(
        reliability_data=ratings,
        level_of_measurement="interval"
    )
    return alpha

# Target: α > 0.7 (acceptable agreement)
```

---

## 6. Comparison Baselines

### 6.1 Models to Compare

| Model | Type | Purpose |
|-------|------|---------|
| gpt-oss-20b (base) | Open | Primary baseline |
| gpt-oss-20b (fine-tuned) | Open | Our model |
| Claude Sonnet | Proprietary | Quality ceiling |
| Qwen 2.5 Coder 14B | Open | Current SemanticWiki local |
| DeepWiki | Proprietary | Specialized baseline |

### 6.2 Comparison Script

```python
def compare_models(
    test_repos: list[str],
    models: dict[str, callable]
) -> dict:
    """
    Compare multiple models on the same test set.
    """
    results = {model_name: [] for model_name in models}

    for repo in test_repos:
        for model_name, generate_fn in models.items():
            # Generate wiki
            wiki = generate_fn(repo)

            # Evaluate
            scores = {
                "traceability": evaluate_source_traceability(wiki, repo),
                "diagrams": evaluate_mermaid_diagrams(wiki),
                "completeness": evaluate_completeness(wiki),
                "standard_metrics": compute_standard_metrics([wiki], [reference])
            }

            results[model_name].append(scores)

    return aggregate_comparison(results)
```

### 6.3 Expected Results

| Model | Source Refs | Diagrams | Completeness | Overall |
|-------|-------------|----------|--------------|---------|
| gpt-oss-20b (base) | 50% | 70% | 60% | 58% |
| **gpt-oss-20b (fine-tuned)** | **92%** | **95%** | **90%** | **85%** |
| Claude Sonnet | 85% | 90% | 88% | 87% |
| Qwen 2.5 Coder 14B | 65% | 75% | 70% | 68% |

---

## 7. Regression Testing

### 7.1 General Capability Tests

Ensure fine-tuning doesn't harm general capabilities:

```python
def test_general_capabilities(model, tokenizer) -> dict:
    """
    Test that general capabilities are preserved.
    """
    tests = {
        "code_completion": test_code_completion(model, tokenizer),
        "code_explanation": test_code_explanation(model, tokenizer),
        "bug_detection": test_bug_detection(model, tokenizer),
        "refactoring": test_refactoring(model, tokenizer),
    }

    return tests

def test_code_completion(model, tokenizer) -> float:
    """
    Test code completion on HumanEval-style problems.
    """
    from human_eval import evaluate_functional_correctness

    # Generate completions
    completions = generate_completions(model, tokenizer, HUMANEVAL_PROBLEMS)

    # Evaluate
    results = evaluate_functional_correctness(completions)

    return results["pass@1"]
```

### 7.2 Regression Thresholds

| Capability | Base Score | Min Acceptable |
|------------|------------|----------------|
| HumanEval pass@1 | 45% | >40% |
| MBPP pass@1 | 55% | >50% |
| Code explanation | 80% | >75% |

---

## 8. Evaluation Pipeline

### 8.1 Directory Structure

```
fine-tuning/
├── evaluation/
│   ├── scripts/
│   │   ├── run_standard_metrics.py
│   │   ├── run_codewikibench.py
│   │   ├── run_task_specific.py
│   │   ├── run_e2e.py
│   │   └── run_human_eval.py
│   ├── test_repos/
│   │   ├── simple-api/
│   │   ├── react-dashboard/
│   │   └── ...
│   ├── results/
│   │   ├── base_model/
│   │   └── finetuned_model/
│   └── reports/
│       └── evaluation_report.md
└── configs/
    └── eval_config.yaml
```

### 8.2 Full Evaluation Command

```bash
# Run complete evaluation pipeline
python evaluation/scripts/run_all_evaluations.py \
  --base-model openai/gpt-oss-20b \
  --finetuned-model ./output/semanticwiki-gpt-oss-merged \
  --test-repos ./evaluation/test_repos \
  --output ./evaluation/results \
  --report ./evaluation/reports/evaluation_report.md
```

### 8.3 Evaluation Timeline

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Standard metrics | 1-2 hours | Test set ready |
| CodeWikiBench | 2-4 hours | Benchmark setup |
| Task-specific | 2-3 hours | Test repos ready |
| End-to-end | 4-8 hours | Full pipeline |
| Human evaluation | 2-3 days | Evaluators recruited |

---

## 9. Success Criteria

### 9.1 Minimum Viable Improvement

The fine-tuned model must demonstrate:

| Metric | Requirement |
|--------|-------------|
| Source traceability | >85% accuracy |
| Mermaid validity | >90% |
| Wiki completeness | >85% |
| CodeWikiBench score | >65% |
| Human eval (overall) | >4.0/5.0 |
| No capability regression | >90% of base |

### 9.2 Target Goals

| Metric | Target |
|--------|--------|
| Source traceability | >92% accuracy |
| Mermaid validity | >95% |
| Wiki completeness | >90% |
| CodeWikiBench score | >70% |
| Human eval (overall) | >4.3/5.0 |
| Generation speed | 50% faster than base |

---

## 10. References

- [CodeWikiBench](https://github.com/FSoft-AI4Code/CodeWikiBench)
- [CodeWiki Paper](https://arxiv.org/abs/2510.24428)
- [LLM Evaluation Guide](https://www.confident-ai.com/blog/llm-evaluation-metrics-everything-you-need-for-llm-evaluation)
- [BERTScore](https://github.com/Tiiiger/bert_score)
- [HumanEval](https://github.com/openai/human-eval)
- [Krippendorff's Alpha](https://github.com/pln-fing-udelar/fast-krippendorff)
