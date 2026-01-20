# Fine-Tuning Execution Plan

This document details the procedure for fine-tuning gpt-oss-20b to become a specialized architectural wiki agent for SemanticWiki.

## Overview

### Model Specifications

| Property | Value |
|----------|-------|
| Base Model | [openai/gpt-oss-20b](https://huggingface.co/openai/gpt-oss-20b) |
| Architecture | Mixture-of-Experts (MoE) Transformer |
| Total Parameters | 20.9B |
| Active Parameters | 3.6B per token |
| MoE Experts | 32 experts, Top-4 routing |
| Context Length | 128K tokens (native) |
| Quantization | MXFP4 (4.25 bits per parameter) |
| License | Apache 2.0 |

### Fine-Tuning Approach

We will use **LoRA (Low-Rank Adaptation)** for parameter-efficient fine-tuning:

- **Why LoRA:** Reduces memory from 65GB+ to 14-16GB VRAM
- **Target:** Attention and MoE expert layers
- **Expected improvement:** Task-specific optimization without catastrophic forgetting

---

## 1. Hardware Requirements

### Recommended Configurations

| Configuration | GPU | VRAM | Training Time (20K examples) | Cost Estimate |
|---------------|-----|------|------------------------------|---------------|
| **Optimal** | H100 SXM 80GB | 80GB | 17-20 minutes | ~$3-5/run |
| **Good** | A100 80GB | 80GB | 25-35 minutes | ~$4-6/run |
| **Acceptable** | RTX 4090 24GB | 24GB | 60-90 minutes | Consumer HW |
| **Budget** | RTX 3090 24GB | 24GB | 90-120 minutes | Consumer HW |

### Cloud GPU Options

```bash
# RunPod (recommended for quick experiments)
# H100 SXM: ~$3.89/hr
runpod create --gpu H100_SXM --template pytorch

# Lambda Labs
# H100: ~$2.49/hr (when available)

# AWS (SageMaker)
# ml.p5.xlarge (H100): ~$10.98/hr

# Google Cloud (Vertex AI)
# a3-highgpu-1g (H100): ~$5.07/hr
```

### Memory Requirements by Method

| Method | VRAM Required | Notes |
|--------|---------------|-------|
| Full Fine-tuning | 300GB+ | Multi-GPU required |
| BF16 LoRA | 44GB | Standard training |
| QLoRA (4-bit) | 14-16GB | Unsloth optimized |
| MXFP4 Native | 16GB | gpt-oss native format |

---

## 2. Environment Setup

### 2.1 Dependencies

```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate

# Core dependencies
pip install torch>=2.1.0 --index-url https://download.pytorch.org/whl/cu121
pip install transformers>=4.40.0
pip install accelerate>=0.27.0
pip install peft>=0.10.0
pip install trl>=0.8.0
pip install bitsandbytes>=0.43.0
pip install datasets>=2.18.0

# gpt-oss specific
pip install openai-harmony  # Harmony format support

# Optional: Unsloth for memory optimization
pip install unsloth
```

### 2.2 requirements.txt

```text
torch>=2.1.0
transformers>=4.40.0
accelerate>=0.27.0
peft>=0.10.0
trl>=0.8.0
bitsandbytes>=0.43.0
datasets>=2.18.0
openai-harmony>=1.0.0
wandb>=0.16.0
tensorboard>=2.16.0
einops>=0.7.0
flash-attn>=2.5.0
```

### 2.3 Model Download

```python
from transformers import AutoModelForCausalLM, AutoTokenizer

model_id = "openai/gpt-oss-20b"

# Download model (will use MXFP4 weights)
tokenizer = AutoTokenizer.from_pretrained(model_id)
model = AutoModelForCausalLM.from_pretrained(
    model_id,
    torch_dtype="auto",
    device_map="auto",
    trust_remote_code=True
)
```

---

## 3. LoRA Configuration

### 3.1 Target Modules

gpt-oss-20b uses MoE architecture. Target both attention and expert layers:

```python
from peft import LoraConfig, get_peft_model

lora_config = LoraConfig(
    r=16,                    # Rank (8, 16, 32, 64 common choices)
    lora_alpha=32,           # Scaling factor (typically 2x rank)
    lora_dropout=0.05,       # Dropout for regularization

    # Target modules for gpt-oss MoE
    target_modules=[
        # Attention layers
        "q_proj",
        "k_proj",
        "v_proj",
        "o_proj",

        # MoE expert layers (critical for task adaptation)
        "gate_proj",
        "up_proj",
        "down_proj",

        # Router (optional, for expert selection tuning)
        # "router",
    ],

    bias="none",
    task_type="CAUSAL_LM",
)

model = get_peft_model(model, lora_config)
model.print_trainable_parameters()
# Expected: trainable params: ~50M / 20.9B total (0.24%)
```

### 3.2 Rank Selection Guide

| LoRA Rank | Trainable Params | VRAM Impact | Use Case |
|-----------|------------------|-------------|----------|
| r=8 | ~25M | Minimal | Quick experiments |
| r=16 | ~50M | Low | **Recommended starting point** |
| r=32 | ~100M | Moderate | Complex task adaptation |
| r=64 | ~200M | Higher | Maximum expressiveness |

---

## 4. Training Configuration

### 4.1 Hyperparameters

```python
from trl import SFTConfig, SFTTrainer

training_args = SFTConfig(
    # Output
    output_dir="./output/semanticwiki-gpt-oss",
    run_name="semanticwiki-wiki-agent-v1",

    # Training duration
    num_train_epochs=3,
    max_steps=-1,  # -1 = use epochs

    # Batch size
    per_device_train_batch_size=1,      # Keep low for long sequences
    per_device_eval_batch_size=1,
    gradient_accumulation_steps=8,       # Effective batch = 8

    # Learning rate
    learning_rate=2e-4,                  # Higher for LoRA
    lr_scheduler_type="cosine_with_min_lr",
    lr_scheduler_kwargs={"min_lr": 1e-5},
    warmup_ratio=0.03,

    # Optimization
    optim="adamw_torch_fused",
    weight_decay=0.01,
    max_grad_norm=1.0,

    # Precision
    bf16=True,                           # Use bfloat16 (H100 optimal)
    tf32=True,                           # TensorFloat-32 for matmuls

    # Sequence length
    max_seq_length=8192,                 # Adjust based on VRAM

    # Logging
    logging_steps=10,
    logging_first_step=True,
    report_to=["wandb", "tensorboard"],

    # Evaluation
    eval_strategy="steps",
    eval_steps=100,

    # Checkpointing
    save_strategy="steps",
    save_steps=500,
    save_total_limit=3,
    load_best_model_at_end=True,
    metric_for_best_model="eval_loss",

    # Efficiency
    gradient_checkpointing=True,
    gradient_checkpointing_kwargs={"use_reentrant": False},

    # Dataset
    dataset_text_field="text",
    packing=True,                        # Pack sequences for efficiency
)
```

### 4.2 Hyperparameter Tuning Ranges

| Parameter | Range | Recommended Start |
|-----------|-------|-------------------|
| Learning Rate | 1e-5 to 5e-4 | 2e-4 |
| LoRA Rank | 8 to 64 | 16 |
| LoRA Alpha | 16 to 64 | 32 |
| Batch Size (effective) | 4 to 32 | 8 |
| Epochs | 1 to 5 | 3 |
| Warmup Ratio | 0.01 to 0.1 | 0.03 |
| Weight Decay | 0 to 0.1 | 0.01 |

---

## 5. Training Script

### 5.1 Full Training Script

```python
#!/usr/bin/env python3
"""
Fine-tune gpt-oss-20b for SemanticWiki architectural documentation.
"""

import torch
from datasets import load_dataset
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
)
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from trl import SFTConfig, SFTTrainer
import wandb

# Configuration
MODEL_ID = "openai/gpt-oss-20b"
DATASET_PATH = "./data/processed/train.jsonl"
OUTPUT_DIR = "./output/semanticwiki-gpt-oss"

def main():
    # Initialize wandb
    wandb.init(
        project="semanticwiki-finetuning",
        name="gpt-oss-20b-wiki-agent-v1",
        config={
            "model": MODEL_ID,
            "lora_r": 16,
            "learning_rate": 2e-4,
        }
    )

    # Load tokenizer
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
    tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"

    # Quantization config (for lower VRAM)
    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=True,
    )

    # Load model
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_ID,
        quantization_config=bnb_config,
        device_map="auto",
        trust_remote_code=True,
        attn_implementation="flash_attention_2",
    )

    # Prepare for training
    model = prepare_model_for_kbit_training(model)

    # LoRA configuration
    lora_config = LoraConfig(
        r=16,
        lora_alpha=32,
        lora_dropout=0.05,
        target_modules=[
            "q_proj", "k_proj", "v_proj", "o_proj",
            "gate_proj", "up_proj", "down_proj",
        ],
        bias="none",
        task_type="CAUSAL_LM",
    )

    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()

    # Load dataset
    dataset = load_dataset("json", data_files={
        "train": DATASET_PATH,
        "validation": DATASET_PATH.replace("train", "validation"),
    })

    # Training arguments
    training_args = SFTConfig(
        output_dir=OUTPUT_DIR,
        num_train_epochs=3,
        per_device_train_batch_size=1,
        gradient_accumulation_steps=8,
        learning_rate=2e-4,
        lr_scheduler_type="cosine_with_min_lr",
        warmup_ratio=0.03,
        bf16=True,
        logging_steps=10,
        eval_strategy="steps",
        eval_steps=100,
        save_strategy="steps",
        save_steps=500,
        save_total_limit=3,
        load_best_model_at_end=True,
        gradient_checkpointing=True,
        max_seq_length=8192,
        dataset_text_field="text",
        packing=True,
        report_to=["wandb"],
    )

    # Initialize trainer
    trainer = SFTTrainer(
        model=model,
        args=training_args,
        train_dataset=dataset["train"],
        eval_dataset=dataset["validation"],
        tokenizer=tokenizer,
    )

    # Train
    trainer.train()

    # Save final model
    trainer.save_model(f"{OUTPUT_DIR}/final")
    tokenizer.save_pretrained(f"{OUTPUT_DIR}/final")

    # Merge LoRA weights (optional, for deployment)
    merged_model = model.merge_and_unload()
    merged_model.save_pretrained(f"{OUTPUT_DIR}/merged")

    wandb.finish()

if __name__ == "__main__":
    main()
```

### 5.2 Unsloth Optimized Script (Lower VRAM)

```python
#!/usr/bin/env python3
"""
Fine-tune gpt-oss-20b with Unsloth for 80% memory reduction.
Runs on 14GB VRAM (RTX 4070, 3090, etc.)
"""

from unsloth import FastLanguageModel
from datasets import load_dataset
from trl import SFTTrainer, SFTConfig

# Configuration
MODEL_ID = "openai/gpt-oss-20b"
MAX_SEQ_LENGTH = 8192

def main():
    # Load model with Unsloth (native MXFP4 support)
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=MODEL_ID,
        max_seq_length=MAX_SEQ_LENGTH,
        dtype=None,  # Auto-detect
        load_in_4bit=True,
    )

    # Add LoRA adapters
    model = FastLanguageModel.get_peft_model(
        model,
        r=16,
        lora_alpha=32,
        lora_dropout=0.05,
        target_modules=[
            "q_proj", "k_proj", "v_proj", "o_proj",
            "gate_proj", "up_proj", "down_proj",
        ],
        bias="none",
        use_gradient_checkpointing="unsloth",  # 30% more memory efficient
        random_state=42,
    )

    # Load dataset
    dataset = load_dataset("json", data_files={
        "train": "./data/processed/train.jsonl"
    })

    # Training config
    training_args = SFTConfig(
        output_dir="./output/semanticwiki-gpt-oss-unsloth",
        num_train_epochs=3,
        per_device_train_batch_size=2,  # Can use larger batch with Unsloth
        gradient_accumulation_steps=4,
        learning_rate=2e-4,
        warmup_ratio=0.03,
        bf16=True,
        logging_steps=10,
        save_strategy="steps",
        save_steps=500,
        max_seq_length=MAX_SEQ_LENGTH,
        dataset_text_field="text",
        packing=True,
    )

    # Train
    trainer = SFTTrainer(
        model=model,
        args=training_args,
        train_dataset=dataset["train"],
        tokenizer=tokenizer,
    )

    trainer.train()

    # Save
    model.save_pretrained_merged(
        "./output/semanticwiki-gpt-oss-unsloth/merged",
        tokenizer,
        save_method="merged_16bit",
    )

if __name__ == "__main__":
    main()
```

---

## 6. Training Monitoring

### 6.1 Key Metrics to Track

| Metric | Target | Warning Signs |
|--------|--------|---------------|
| Training Loss | Decreasing steadily | Spikes, plateaus early |
| Validation Loss | Decreasing, close to train | Increasing (overfitting) |
| Learning Rate | Following schedule | N/A |
| GPU Memory | <95% utilization | OOM errors |
| Throughput | Consistent tokens/sec | Degradation |

### 6.2 Wandb Dashboard Setup

```python
# Log custom metrics during training
def compute_metrics(eval_preds):
    predictions, labels = eval_preds

    # Custom metrics for wiki quality
    metrics = {
        "has_source_refs": compute_source_ref_ratio(predictions),
        "valid_markdown": compute_markdown_validity(predictions),
        "mermaid_accuracy": compute_mermaid_accuracy(predictions),
    }

    return metrics
```

### 6.3 Early Stopping

```python
from transformers import EarlyStoppingCallback

trainer = SFTTrainer(
    # ... other args ...
    callbacks=[
        EarlyStoppingCallback(
            early_stopping_patience=3,
            early_stopping_threshold=0.001,
        )
    ],
)
```

---

## 7. Post-Training Processing

### 7.1 Merge LoRA Weights

```python
from peft import PeftModel

# Load base model
base_model = AutoModelForCausalLM.from_pretrained(MODEL_ID)

# Load LoRA adapter
model = PeftModel.from_pretrained(base_model, "./output/semanticwiki-gpt-oss/final")

# Merge weights
merged_model = model.merge_and_unload()

# Save merged model
merged_model.save_pretrained("./output/semanticwiki-gpt-oss-merged")
```

### 7.2 Convert to GGUF (for SemanticWiki local mode)

```bash
# Clone llama.cpp
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp

# Convert to GGUF
python convert_hf_to_gguf.py \
  ../output/semanticwiki-gpt-oss-merged \
  --outfile ../output/semanticwiki-wiki-agent.gguf \
  --outtype f16

# Quantize (optional, for smaller size)
./llama-quantize \
  ../output/semanticwiki-wiki-agent.gguf \
  ../output/semanticwiki-wiki-agent-q5_k_m.gguf \
  q5_k_m
```

### 7.3 Upload to Hub (Optional)

```python
from huggingface_hub import HfApi

api = HfApi()

# Upload merged model
api.upload_folder(
    folder_path="./output/semanticwiki-gpt-oss-merged",
    repo_id="your-org/semanticwiki-wiki-agent",
    repo_type="model",
)

# Upload GGUF
api.upload_file(
    path_or_fileobj="./output/semanticwiki-wiki-agent-q5_k_m.gguf",
    path_in_repo="semanticwiki-wiki-agent-q5_k_m.gguf",
    repo_id="your-org/semanticwiki-wiki-agent-gguf",
    repo_type="model",
)
```

---

## 8. Integration with SemanticWiki

### 8.1 Using Fine-Tuned Model

After training, use the model with SemanticWiki:

```bash
# Option 1: GGUF with local-llama-provider
semanticwiki generate -r ./my-project \
  --full-local \
  --model-path ~/.semanticwiki/models/semanticwiki-wiki-agent-q5_k_m.gguf

# Option 2: Via Ollama
ollama create semanticwiki-agent -f Modelfile
semanticwiki generate -r ./my-project \
  --full-local --use-ollama --local-model semanticwiki-agent
```

### 8.2 Modelfile for Ollama

```dockerfile
# Modelfile
FROM ./semanticwiki-wiki-agent-q5_k_m.gguf

TEMPLATE """{{ if .System }}<|start|>system<|channel|>final<|end|>
{{ .System }}<|start|>end<|end|>{{ end }}{{ if .Prompt }}<|start|>user<|channel|>final<|end|>
{{ .Prompt }}<|start|>end<|end|>{{ end }}<|start|>assistant<|channel|>final<|end|>
{{ .Response }}<|start|>end<|end|>"""

PARAMETER temperature 0.7
PARAMETER top_p 0.9
PARAMETER num_ctx 32768
PARAMETER stop "<|start|>end<|end|>"
```

---

## 9. Training Time Estimates

### By Dataset Size (H100 80GB)

| Examples | Epochs | Estimated Time | Tokens Processed |
|----------|--------|----------------|------------------|
| 5,000 | 3 | ~10 minutes | ~50M |
| 10,000 | 3 | ~17 minutes | ~100M |
| 20,000 | 3 | ~30 minutes | ~200M |
| 50,000 | 3 | ~75 minutes | ~500M |

### By Hardware (20K examples, 3 epochs)

| GPU | Time | Cost |
|-----|------|------|
| H100 80GB | 30 min | ~$2-3 |
| A100 80GB | 45 min | ~$3-4 |
| RTX 4090 24GB | 90 min | Consumer |
| RTX 3090 24GB | 120 min | Consumer |

---

## 10. Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| OOM Error | Batch too large | Reduce `per_device_train_batch_size`, increase `gradient_accumulation_steps` |
| Loss NaN | Learning rate too high | Reduce `learning_rate` to 1e-4 or 5e-5 |
| No improvement | Data quality issues | Review training data, check format |
| Slow training | No Flash Attention | Install `flash-attn`, use `attn_implementation="flash_attention_2"` |
| Harmony format errors | Incorrect tokenization | Use `openai-harmony` library for formatting |

### Memory Optimization Checklist

```python
# 1. Enable gradient checkpointing
gradient_checkpointing=True

# 2. Use 4-bit quantization
load_in_4bit=True

# 3. Use Unsloth (if available)
from unsloth import FastLanguageModel

# 4. Reduce sequence length
max_seq_length=4096  # Instead of 8192

# 5. Use smaller LoRA rank
r=8  # Instead of 16

# 6. Enable CPU offloading
device_map="auto"  # Offloads to CPU when needed
```

---

## 11. References

- [gpt-oss-20b on HuggingFace](https://huggingface.co/openai/gpt-oss-20b)
- [OpenAI Cookbook: Fine-tuning gpt-oss](https://cookbook.openai.com/articles/gpt-oss/fine-tune-transfomers)
- [Harmony Response Format](https://github.com/openai/harmony)
- [Unsloth Documentation](https://docs.unsloth.ai/models/gpt-oss-how-to-run-and-fine-tune)
- [TRL SFTTrainer](https://huggingface.co/docs/trl/sft_trainer)
- [PEFT LoRA](https://huggingface.co/docs/peft/conceptual_guides/lora)
- [Analytics Vidhya: Fine-tuning gpt-oss](https://www.analyticsvidhya.com/blog/2025/10/finetuning-gpt-oss/)
