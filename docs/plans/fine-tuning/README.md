# Fine-Tuning gpt-oss-20b for SemanticWiki

This directory contains planning documents for fine-tuning OpenAI's gpt-oss-20b to become a specialized architectural wiki agent for SemanticWiki in local-only mode.

## Quick Start (Tonight!)

**Want results in 3-4 hours?** See [QUICK-START.md](./QUICK-START.md) for a minimal, achievable plan.

```bash
pip install torch transformers peft trl datasets bitsandbytes
python prepare_data.py   # 30 min - downloads CodeWikiBench
python train.py          # 1-2 hrs - LoRA fine-tuning
python test.py           # 5 min - verify it works
```

---

## Project Goal

Create a fine-tuned version of gpt-oss-20b that excels at:
- Generating architectural documentation with source traceability
- Creating accurate Mermaid diagrams
- Using SemanticWiki tools effectively
- Producing complete, well-structured wiki pages

## Quick Start

```bash
# 1. Prepare dataset
python scripts/prepare_dataset.py

# 2. Fine-tune model
python scripts/train.py --config configs/train_config.yaml

# 3. Evaluate
python scripts/evaluate.py --model ./output/merged

# 4. Use with SemanticWiki
semanticwiki generate -r ./your-repo --full-local --model-path ./output/model.gguf
```

## Plan Documents

| Document | Description |
|----------|-------------|
| [01-DATASET-PREPARATION.md](./01-DATASET-PREPARATION.md) | Dataset collection, synthesis, and formatting |
| [02-FINE-TUNING-EXECUTION.md](./02-FINE-TUNING-EXECUTION.md) | Training procedure, hyperparameters, scripts |
| [03-EVALUATION.md](./03-EVALUATION.md) | Evaluation metrics, benchmarks, success criteria |

---

## Executive Summary

### Model Selection: gpt-oss-20b

| Property | Value |
|----------|-------|
| Parameters | 20.9B total, 3.6B active (MoE) |
| Architecture | Mixture-of-Experts Transformer |
| Context Length | 128K tokens |
| Quantization | MXFP4 (fits in 16GB VRAM) |
| License | Apache 2.0 |

**Why gpt-oss-20b?**
- Strong reasoning capabilities from OpenAI training
- Efficient MoE architecture for fast inference
- Runs on consumer hardware with quantization
- Apache 2.0 license allows commercial use

### Training Data Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│                     Training Data Mix                           │
├─────────────────────────────────────────────────────────────────┤
│  Real Data (40%)                                                │
│  ├─ CodeWikiBench: 22 repos, ~8K examples                       │
│  └─ DeepWiki crawl: 500+ repos, ~15K examples                   │
│                                                                 │
│  Synthetic Data (50%)                                           │
│  ├─ Claude-distilled: ~20K architecture docs                    │
│  ├─ Self-instruct: ~5K variations                               │
│  └─ Tool-use trajectories: ~5K examples                         │
│                                                                 │
│  SemanticWiki-Specific (10%)                                    │
│  ├─ Source traceability examples: ~3K                           │
│  └─ Multi-turn refinement: ~2K                                  │
├─────────────────────────────────────────────────────────────────┤
│  Total: 50,000+ high-quality examples                           │
└─────────────────────────────────────────────────────────────────┘
```

### Hardware Requirements

| Configuration | VRAM | Training Time (50K examples) | Estimated Cost |
|---------------|------|------------------------------|----------------|
| H100 80GB | 80GB | 1.5-2 hours | ~$8-12 |
| A100 80GB | 80GB | 2-3 hours | ~$10-15 |
| RTX 4090 (Unsloth) | 24GB | 4-6 hours | Consumer HW |

### Expected Improvements

| Metric | Base gpt-oss-20b | Fine-tuned Target |
|--------|------------------|-------------------|
| Source traceability | ~50% | >90% |
| Mermaid diagram validity | ~70% | >95% |
| Wiki completeness | ~60% | >90% |
| CodeWikiBench score | ~55% | >70% |
| Tool use accuracy | ~80% | >95% |
| Generation efficiency | Baseline | 2x faster |

---

## Timeline Overview

### Phase 1: Data Preparation (3-5 days)

| Task | Duration | Output |
|------|----------|--------|
| Download CodeWikiBench | 1 hour | Raw dataset |
| Crawl DeepWiki | 1-2 days | 15K+ examples |
| Generate synthetic data | 2-3 days | 30K+ examples |
| Quality filtering | 4-8 hours | Clean dataset |
| Format to Harmony | 1-2 hours | train.jsonl |

**Estimated cost:** $300-600 (synthetic generation API calls)

### Phase 2: Fine-Tuning (4-8 hours)

| Task | Duration | Output |
|------|----------|--------|
| Environment setup | 30 min | Ready to train |
| Training run | 1.5-3 hours | LoRA weights |
| Merge weights | 15 min | Merged model |
| Convert to GGUF | 30 min | Deployable model |

**Estimated cost:** $10-20 (cloud GPU)

### Phase 3: Evaluation (2-5 days)

| Task | Duration | Output |
|------|----------|--------|
| Automated metrics | 2-4 hours | Metric scores |
| CodeWikiBench | 4-8 hours | Benchmark results |
| End-to-end tests | 8-12 hours | Wiki samples |
| Human evaluation | 2-3 days | Expert ratings |

**Estimated cost:** $0-100 (compute + optional human eval)

### Total Timeline

- **Minimum:** 5-7 days
- **Recommended:** 10-14 days (including iteration)
- **Total estimated cost:** $350-750

---

## Key Technical Decisions

### 1. LoRA vs Full Fine-Tuning

**Decision:** Use LoRA (Low-Rank Adaptation)

- Reduces VRAM from 300GB+ to 14-44GB
- Preserves base model capabilities
- Enables consumer hardware training
- Faster training iterations

### 2. Data Format: Harmony

**Decision:** Use OpenAI's Harmony response format

```python
from openai_harmony import Renderer

# gpt-oss requires Harmony format for correct behavior
renderer = Renderer()
formatted = renderer.render(messages)
```

### 3. Quantization: MXFP4 → GGUF

**Decision:** Train in native format, export to GGUF

- Train with MXFP4 (gpt-oss native)
- Export to GGUF for llama.cpp / Ollama compatibility
- Enables SemanticWiki local-only mode

### 4. Evaluation: Multi-Modal Approach

**Decision:** Combine automated + human evaluation

- Standard metrics (BLEU, ROUGE) as baseline
- Task-specific metrics (source refs, diagrams) as primary
- CodeWikiBench for standardized comparison
- Human evaluation for quality assurance

---

## Integration with SemanticWiki

After training, the fine-tuned model integrates seamlessly:

```bash
# Option 1: Direct GGUF
semanticwiki generate -r ./my-repo \
  --full-local \
  --model-path ~/.semanticwiki/models/semanticwiki-wiki-agent.gguf

# Option 2: Via Ollama
ollama create semanticwiki-agent -f Modelfile
semanticwiki generate -r ./my-repo \
  --full-local --use-ollama --local-model semanticwiki-agent
```

The model will be loaded by `LocalLlamaProvider` or `OllamaProvider` in the SemanticWiki architecture:

```
CLI (--model-path)
     ↓
createLLMProvider() factory
     ↓
LocalLlamaProvider / OllamaProvider
     ↓
WikiAgent (uses fine-tuned model)
```

---

## Success Criteria

### Minimum Viable Product

- [ ] Source traceability accuracy >85%
- [ ] Mermaid diagram validity >90%
- [ ] Wiki completeness >85%
- [ ] No regression on general capabilities
- [ ] Works in SemanticWiki local mode

### Stretch Goals

- [ ] CodeWikiBench score >70% (beat DeepWiki)
- [ ] Human eval rating >4.3/5.0
- [ ] Generation speed 2x faster than base
- [ ] Support for 10+ programming languages

---

## References

### Primary Sources

- [gpt-oss-20b on HuggingFace](https://huggingface.co/openai/gpt-oss-20b)
- [OpenAI Cookbook: Fine-tuning gpt-oss](https://cookbook.openai.com/articles/gpt-oss/fine-tune-transfomers)
- [Harmony Response Format](https://github.com/openai/harmony)
- [Unsloth Documentation](https://docs.unsloth.ai/models/gpt-oss-how-to-run-and-fine-tune)

### Datasets

- [CodeWikiBench](https://huggingface.co/datasets/anhnh2002/codewikibench)
- [CodeWiki Paper](https://arxiv.org/abs/2510.24428)
- [DeepWiki](https://deepwiki.org/)
- [OpenDeepWiki](https://github.com/AIDotNet/OpenDeepWiki)

### Training Resources

- [TRL SFTTrainer](https://huggingface.co/docs/trl/sft_trainer)
- [PEFT LoRA Guide](https://huggingface.co/docs/peft/conceptual_guides/lora)
- [Synthetic Data Survey](https://arxiv.org/abs/2503.14023)

### Evaluation

- [LLM Evaluation Guide](https://www.confident-ai.com/blog/llm-evaluation-metrics-everything-you-need-for-llm-evaluation)
- [CodeWikiBench GitHub](https://github.com/FSoft-AI4Code/CodeWikiBench)

---

## Directory Structure

```
fine-tuning/
├── README.md                        # This file
├── 01-DATASET-PREPARATION.md        # Dataset plan
├── 02-FINE-TUNING-EXECUTION.md      # Training plan
├── 03-EVALUATION.md                 # Evaluation plan
├── configs/                         # Configuration files
│   ├── train_config.yaml
│   ├── data_config.yaml
│   └── eval_config.yaml
├── scripts/                         # Implementation scripts
│   ├── prepare_dataset.py
│   ├── train.py
│   ├── evaluate.py
│   └── convert_gguf.py
├── data/                            # Training data
│   ├── raw/
│   ├── processed/
│   └── quality_reports/
├── evaluation/                      # Evaluation resources
│   ├── test_repos/
│   ├── results/
│   └── reports/
└── output/                          # Training outputs
    ├── checkpoints/
    ├── merged/
    └── gguf/
```

---

## Next Steps

1. **Review plans** - Ensure all requirements are captured
2. **Set up environment** - Install dependencies, get GPU access
3. **Prepare data** - Run dataset preparation pipeline
4. **Train model** - Execute fine-tuning with monitoring
5. **Evaluate** - Run full evaluation suite
6. **Iterate** - Refine based on results
7. **Deploy** - Integrate with SemanticWiki

---

## Contact

For questions about this fine-tuning project, refer to the SemanticWiki documentation or open an issue in the repository.
