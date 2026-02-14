# Dataset Preparation Plan

This document outlines the strategy for preparing training data to fine-tune gpt-oss-20b as an architectural wiki agent for SemanticWiki in local-only mode.

## Overview

The training dataset will combine three sources:
1. **Real examples** from CodeWikiBench and DeepWiki
2. **Synthetic data** generated via LLM distillation
3. **SemanticWiki-specific examples** from existing wiki generations

Target dataset size: **10,000-50,000 high-quality examples**

---

## 1. Real Data Sources

### 1.1 CodeWikiBench Dataset

**Source:** [HuggingFace - anhnh2002/codewikibench](https://huggingface.co/datasets/anhnh2002/codewikibench)

CodeWikiBench provides repository-level documentation examples across 22 open-source projects in 6 languages.

#### Dataset Structure
```python
from datasets import load_dataset

dataset = load_dataset("anhnh2002/codewikibench")
# Each entry contains:
# - repo_name: Repository identifier
# - commit_id: Specific commit hash
# - docs_tree: Original documentation structure
# - structured_docs: Parsed documentation content
# - rubrics: Quality evaluation criteria
```

#### Extraction Strategy
```python
# Extract high-quality documentation examples
for repo in dataset['train']:
    examples = []

    # Extract architecture documentation
    arch_docs = extract_architecture_sections(repo['structured_docs'])

    # Extract component documentation with source refs
    component_docs = extract_component_docs(repo['structured_docs'])

    # Create training pairs: (code_context, documentation)
    for doc in arch_docs + component_docs:
        examples.append({
            "instruction": generate_instruction(doc),
            "input": extract_code_context(repo, doc),
            "output": doc['content']
        })
```

#### Languages Covered
| Language | Repositories | Examples |
|----------|-------------|----------|
| JavaScript/TypeScript | Chart.js, puppeteer, mermaid, svelte, marktext, storybook | ~3,000 |
| Python | graphrag, rasa, OpenHands | ~1,500 |
| C/C++ | electron, qmk_firmware, libsql, json, x64dbg | ~2,000 |
| C# | FluentValidation, ml-agents, git-credential-manager | ~1,000 |
| Java | logstash, trino, material-components-android | ~1,000 |

### 1.2 DeepWiki Crawled Data

**Source:** [DeepWiki](https://deepwiki.org/) - AI-generated documentation for 30,000+ GitHub repositories

#### Crawling Strategy
```python
import requests
from bs4 import BeautifulSoup

def crawl_deepwiki(repo_owner: str, repo_name: str) -> dict:
    """
    Crawl DeepWiki documentation for a repository.
    Replace 'github.com' with 'deepwiki.com' in URL.
    """
    base_url = f"https://deepwiki.com/{repo_owner}/{repo_name}"

    # Fetch main documentation
    response = requests.get(base_url)
    soup = BeautifulSoup(response.text, 'html.parser')

    return {
        "overview": extract_section(soup, "overview"),
        "architecture": extract_section(soup, "architecture"),
        "components": extract_section(soup, "components"),
        "data_flow": extract_section(soup, "data-flow")
    }

# Target repositories (popular, well-structured projects)
TARGET_REPOS = [
    ("facebook", "react"),
    ("vuejs", "vue"),
    ("microsoft", "vscode"),
    ("tensorflow", "tensorflow"),
    # ... 500+ curated repositories
]
```

#### Data Quality Filters
- Minimum 1,000 lines of code in repository
- Documentation must include architecture diagrams
- Must have source code references
- Exclude auto-generated API docs (focus on conceptual docs)

### 1.3 OpenDeepWiki (Open Source Alternative)

**Source:** [GitHub - AIDotNet/OpenDeepWiki](https://github.com/AIDotNet/OpenDeepWiki)

For repositories where DeepWiki access is limited, use OpenDeepWiki to generate documentation locally.

---

## 2. Synthetic Data Generation

### 2.1 Distillation from Claude/GPT-4

Use a stronger model to generate high-quality documentation examples.

#### Generation Pipeline
```python
from anthropic import Anthropic

client = Anthropic()

def generate_synthetic_example(code_files: list[str], repo_metadata: dict) -> dict:
    """
    Generate synthetic architectural documentation using Claude.
    """
    prompt = f"""
    You are an expert software architect creating documentation for a wiki.

    Repository: {repo_metadata['name']}
    Language: {repo_metadata['language']}

    Code files:
    {format_code_files(code_files)}

    Generate comprehensive architectural documentation including:
    1. System overview with file:line references
    2. Component descriptions with source traceability
    3. Data flow explanation
    4. Mermaid diagram for architecture

    Format as markdown with `file:line` references for every concept.
    """

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=8000,
        messages=[{"role": "user", "content": prompt}]
    )

    return {
        "instruction": "Generate architectural wiki documentation for this codebase",
        "input": format_code_files(code_files),
        "output": response.content[0].text
    }
```

#### Synthetic Data Categories

| Category | Description | Target Count |
|----------|-------------|--------------|
| Architecture Overview | High-level system design docs | 5,000 |
| Component Documentation | Individual module docs | 10,000 |
| Data Flow Documentation | Request/data lifecycle docs | 3,000 |
| Getting Started Guides | Onboarding documentation | 2,000 |
| Business Domain Mapping | Technical-to-business docs | 2,000 |
| Mermaid Diagram Generation | Architecture diagrams | 5,000 |
| Source Traceability Examples | `file:line` reference patterns | 3,000 |

### 2.2 Self-Instruct Method

Generate instruction-following examples by:
1. Seeding with 100 manually-crafted high-quality examples
2. Using gpt-oss-20b (base) to generate variations
3. Filtering with Claude for quality

```python
def self_instruct_generation(seed_examples: list, num_generate: int = 1000):
    """
    Self-instruct style data augmentation.
    """
    generated = []

    for _ in range(num_generate):
        # Sample seed examples for context
        context_examples = random.sample(seed_examples, k=3)

        # Generate new instruction
        new_instruction = generate_instruction_variation(context_examples)

        # Generate response
        response = base_model.generate(new_instruction)

        # Quality filter with teacher model
        if quality_check(new_instruction, response):
            generated.append({
                "instruction": new_instruction,
                "output": response
            })

    return generated
```

### 2.3 Code-to-Documentation Pairs

Extract from existing well-documented repositories:

```python
def extract_code_doc_pairs(repo_path: str) -> list[dict]:
    """
    Extract code-documentation pairs from repositories
    with inline documentation or adjacent .md files.
    """
    pairs = []

    # Find code files with documentation
    for code_file in glob.glob(f"{repo_path}/**/*.ts", recursive=True):
        doc_file = code_file.replace('.ts', '.md')

        if os.path.exists(doc_file):
            pairs.append({
                "code": read_file(code_file),
                "documentation": read_file(doc_file),
                "file_path": code_file
            })

    return pairs
```

---

## 3. SemanticWiki-Specific Data

### 3.1 Tool Use Trajectories

Capture successful wiki generation sessions:

```python
# Format: instruction -> tool calls -> final documentation

TOOL_USE_EXAMPLE = {
    "instruction": "Generate architecture documentation for the authentication module",
    "trajectory": [
        {"tool": "search_codebase", "input": "authentication login", "output": "[results]"},
        {"tool": "read_file", "input": "src/auth/provider.ts", "output": "[code]"},
        {"tool": "analyze_code_structure", "input": "src/auth/", "output": "[analysis]"},
        {"tool": "write_wiki_page", "input": {"path": "auth/overview.md", "content": "..."}}
    ],
    "final_output": "# Authentication Module\n\n..."
}
```

### 3.2 Multi-Turn Conversations

Document iterative refinement patterns:

```python
MULTI_TURN_EXAMPLE = {
    "turns": [
        {"user": "Document the payment processing flow", "assistant": "[initial doc]"},
        {"user": "Add more detail about error handling", "assistant": "[refined doc]"},
        {"user": "Include sequence diagram", "assistant": "[doc with mermaid]"}
    ]
}
```

### 3.3 Source Traceability Training

Explicit training on `file:line` reference generation:

```python
TRACEABILITY_EXAMPLE = {
    "instruction": "Add source references to this documentation",
    "input": """
    The UserService handles user authentication by validating credentials
    against the database and generating JWT tokens.
    """,
    "output": """
    The `UserService` handles user authentication by validating credentials
    against the database ([`src/services/user.ts:45-67`](../src/services/user.ts#L45-L67))
    and generating JWT tokens ([`src/auth/jwt.ts:23-41`](../src/auth/jwt.ts#L23-L41)).
    """
}
```

---

## 4. Data Format

### 4.1 Harmony Format for gpt-oss

gpt-oss models require the [Harmony response format](https://github.com/openai/harmony).

```python
from openai_harmony import Renderer

renderer = Renderer()

def format_for_harmony(example: dict) -> str:
    """
    Convert example to Harmony format for gpt-oss training.
    """
    messages = [
        {
            "role": "system",
            "content": WIKI_AGENT_SYSTEM_PROMPT,
            "channel": "final"
        },
        {
            "role": "user",
            "content": example["instruction"],
            "channel": "final"
        }
    ]

    # Add tool calls if present
    if "trajectory" in example:
        for step in example["trajectory"]:
            messages.append({
                "role": "assistant",
                "content": json.dumps(step),
                "channel": "tool_call"
            })

    # Final response
    messages.append({
        "role": "assistant",
        "content": example["output"],
        "channel": "final"
    })

    return renderer.render(messages)
```

### 4.2 Alternative: ChatML Format (for Ollama/vLLM)

```python
def format_chatml(example: dict) -> str:
    """
    Standard ChatML format for broader compatibility.
    """
    return f"""<|im_start|>system
{WIKI_AGENT_SYSTEM_PROMPT}
<|im_end|>
<|im_start|>user
{example["instruction"]}

{example.get("input", "")}
<|im_end|>
<|im_start|>assistant
{example["output"]}
<|im_end|>"""
```

### 4.3 JSONL Output Format

Final training data format:

```jsonl
{"text": "<harmony formatted conversation>", "source": "codewikibench", "category": "architecture"}
{"text": "<harmony formatted conversation>", "source": "synthetic", "category": "component"}
{"text": "<harmony formatted conversation>", "source": "deepwiki", "category": "data_flow"}
```

---

## 5. Data Quality Assurance

### 5.1 Automated Quality Checks

```python
def quality_check(example: dict) -> bool:
    """
    Validate training example quality.
    """
    checks = [
        # Must have source references
        has_source_references(example["output"]),

        # Minimum content length
        len(example["output"]) >= 500,

        # Valid markdown
        is_valid_markdown(example["output"]),

        # No hallucinated file paths
        validate_file_references(example),

        # Proper mermaid syntax (if diagrams present)
        validate_mermaid_diagrams(example["output"]),
    ]

    return all(checks)

def has_source_references(text: str) -> bool:
    """Check for file:line reference patterns."""
    pattern = r'`[a-zA-Z0-9/_.-]+:\d+(-\d+)?`'
    return bool(re.search(pattern, text))
```

### 5.2 Human Review Sample

- Review 5% of synthetic data manually
- Use LLM-as-judge for automated quality scoring
- Track quality metrics per data source

### 5.3 Deduplication

```python
from datasketch import MinHash, MinHashLSH

def deduplicate_dataset(examples: list[dict]) -> list[dict]:
    """
    Remove near-duplicate examples using MinHash LSH.
    """
    lsh = MinHashLSH(threshold=0.8, num_perm=128)
    unique_examples = []

    for i, example in enumerate(examples):
        minhash = compute_minhash(example["output"])

        if not lsh.query(minhash):
            lsh.insert(f"doc_{i}", minhash)
            unique_examples.append(example)

    return unique_examples
```

---

## 6. Dataset Splits

| Split | Percentage | Purpose |
|-------|------------|---------|
| Train | 90% | Fine-tuning |
| Validation | 5% | Hyperparameter tuning |
| Test | 5% | Final evaluation |

### Stratification

Ensure balanced representation across:
- Programming languages (TypeScript, Python, Java, C++, etc.)
- Documentation types (architecture, component, data flow, guides)
- Repository sizes (small <10K LOC, medium 10-100K, large >100K)
- Data sources (real vs synthetic)

---

## 7. Data Pipeline Implementation

### 7.1 Directory Structure

```
fine-tuning/
├── data/
│   ├── raw/
│   │   ├── codewikibench/
│   │   ├── deepwiki/
│   │   └── synthetic/
│   ├── processed/
│   │   ├── train.jsonl
│   │   ├── validation.jsonl
│   │   └── test.jsonl
│   └── quality_reports/
├── scripts/
│   ├── crawl_deepwiki.py
│   ├── process_codewikibench.py
│   ├── generate_synthetic.py
│   ├── format_harmony.py
│   └── quality_check.py
└── configs/
    └── data_config.yaml
```

### 7.2 Pipeline Commands

```bash
# Step 1: Download CodeWikiBench
python scripts/process_codewikibench.py --output data/raw/codewikibench/

# Step 2: Crawl DeepWiki (respect rate limits)
python scripts/crawl_deepwiki.py --repos repos.txt --output data/raw/deepwiki/

# Step 3: Generate synthetic data
python scripts/generate_synthetic.py \
  --source-repos /path/to/repos \
  --num-examples 20000 \
  --output data/raw/synthetic/

# Step 4: Format for Harmony
python scripts/format_harmony.py \
  --input data/raw/ \
  --output data/processed/

# Step 5: Quality check and split
python scripts/quality_check.py \
  --input data/processed/ \
  --output data/processed/ \
  --train-ratio 0.9 \
  --val-ratio 0.05
```

---

## 8. Estimated Timeline & Resources

| Phase | Duration | Compute Required |
|-------|----------|------------------|
| CodeWikiBench processing | 2-4 hours | CPU only |
| DeepWiki crawling | 1-2 days | CPU + network |
| Synthetic generation | 2-3 days | API calls (~$200-500) |
| Quality filtering | 4-8 hours | CPU/GPU for embeddings |
| Formatting & splitting | 1-2 hours | CPU only |

**Total estimated cost:** $300-600 (primarily synthetic generation API costs)

---

## 9. References

- [CodeWikiBench Dataset](https://huggingface.co/datasets/anhnh2002/codewikibench)
- [CodeWiki Paper (arXiv:2510.24428)](https://arxiv.org/abs/2510.24428)
- [DeepWiki](https://deepwiki.org/)
- [OpenDeepWiki](https://github.com/AIDotNet/OpenDeepWiki)
- [Harmony Response Format](https://github.com/openai/harmony)
- [Synthetic Data Generation Survey](https://arxiv.org/abs/2503.14023)
- [LLM-Synthetic-Data Reading List](https://github.com/pengr/LLM-Synthetic-Data)
