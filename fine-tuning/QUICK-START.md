# Tonight's Plan: Fine-Tune gpt-oss-20b (~1 hour)

Based on [OpenAI Cookbook guidance](https://cookbook.openai.com/articles/gpt-oss/fine-tune-transfomers):

> "This is a small dataset of 1,000 examples, but this is usually more than sufficient for models like openai/gpt-oss-20b which have undergone extensive post-training."

## Timeline

| Step | Time | Cost |
|------|------|------|
| Setup | 5 min | Free |
| Data prep | 15 min | Free |
| Synthetic gen (optional) | 15 min | ~$2 |
| Training (3 epochs) | 20-30 min | Free/local |
| Testing | 5 min | Free |
| **Total** | **~1 hour** | **~$2** |

## Use the Dedicated Repo

A complete toolkit has been set up at `../semanticwiki-finetune/`:

```bash
cd ../semanticwiki-finetune

# 1. Setup
pip install -r requirements.txt

# 2. Prepare ~1,000 high-quality examples from CodeWikiBench
python scripts/prepare_data.py

# 3. Optional: Add 200 synthetic examples for source traceability (~$2)
export ANTHROPIC_API_KEY=your_key
python scripts/generate_synthetic.py --num-examples 200

# 4. Train (3 epochs, ~25 min on RTX 4090)
python scripts/train.py

# 5. Test
python scripts/test.py
```

## What's in the Repo

```
semanticwiki-finetune/
├── scripts/
│   ├── prepare_data.py       # CodeWikiBench → training format
│   ├── generate_synthetic.py # Claude API for targeted examples
│   ├── train.py              # QLoRA fine-tuning
│   ├── test.py               # Validate output quality
│   ├── merge_and_export.py   # Merge weights, convert to GGUF
│   └── publish_dataset.py    # Upload to HuggingFace
├── requirements.txt
└── README.md                 # Full documentation
```

## Hardware

| GPU | Time (1.2K examples, 3 epochs) |
|-----|-------------------------------|
| RTX 4090 (24GB) | ~25 min |
| RTX 3090 (24GB) | ~30 min |
| A100 (80GB) | ~15 min |
| **Cloud (RunPod)** | ~25 min, ~$0.20 |

## Expected Results

| Metric | Base | After Fine-tuning |
|--------|------|-------------------|
| Source traceability | ~50% | ~85% |
| Mermaid validity | ~70% | ~90% |
| Wiki completeness | ~60% | ~85% |

## Publish Dataset to HuggingFace

After training, share your dataset:

```bash
huggingface-cli login
python scripts/publish_dataset.py --repo-id your-username/semanticwiki-data
```

## Use with SemanticWiki

```bash
# Export to GGUF
python scripts/merge_and_export.py --to-gguf --quantize q5_k_m

# Use with SemanticWiki
semanticwiki generate -r ./your-repo \
  --full-local \
  --model-path output/semanticwiki-wiki-agent-q5_k_m.gguf
```

---

**That's it!** ~1 hour from start to a fine-tuned wiki documentation agent.
