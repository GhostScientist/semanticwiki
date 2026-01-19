# Tonight's Plan: Quick Fine-Tune gpt-oss-20b

A minimal, achievable plan to fine-tune gpt-oss-20b for SemanticWiki in one evening (~3-4 hours).

## Prerequisites

- [ ] GPU with 24GB+ VRAM (RTX 3090/4090) OR cloud GPU access (RunPod/Lambda)
- [ ] Python 3.10+
- [ ] ~$5-10 for cloud GPU (if not using local)

## Timeline

| Phase | Time | Task |
|-------|------|------|
| Setup | 20 min | Install deps, download model |
| Data | 30 min | Download CodeWikiBench, format |
| Train | 1-2 hrs | Run LoRA fine-tuning |
| Test | 30 min | Generate wiki, check quality |

---

## Step 1: Environment Setup (20 min)

```bash
# Create environment
python -m venv venv
source venv/bin/activate

# Install dependencies
pip install torch transformers accelerate peft trl datasets bitsandbytes

# Optional: Unsloth for 2x speed (recommended)
pip install unsloth
```

## Step 2: Download & Format Data (30 min)

Create `prepare_data.py`:

```python
#!/usr/bin/env python3
"""Quick data prep using CodeWikiBench only."""

from datasets import load_dataset
import json

# Load CodeWikiBench
print("Downloading CodeWikiBench...")
dataset = load_dataset("anhnh2002/codewikibench")

# Simple formatting - just use the docs as-is
examples = []
for item in dataset["train"]:
    # Create instruction-response pairs from structured docs
    if item.get("structured_docs"):
        examples.append({
            "text": f"""<|im_start|>system
You are an expert software architect who creates documentation wikis with source code traceability.
<|im_end|>
<|im_start|>user
Generate architectural documentation for the {item['repo_name']} repository.
<|im_end|>
<|im_start|>assistant
{json.dumps(item['structured_docs'], indent=2)[:8000]}
<|im_end|>"""
        })

print(f"Created {len(examples)} examples")

# Save
with open("train_data.jsonl", "w") as f:
    for ex in examples[:5000]:  # Limit to 5K for quick training
        f.write(json.dumps(ex) + "\n")

print("Saved to train_data.jsonl")
```

Run it:
```bash
python prepare_data.py
```

## Step 3: Train (1-2 hours)

Create `train.py`:

```python
#!/usr/bin/env python3
"""Quick LoRA fine-tuning of gpt-oss-20b."""

from datasets import load_dataset
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from trl import SFTConfig, SFTTrainer
import torch

MODEL_ID = "openai/gpt-oss-20b"

def main():
    print("Loading tokenizer...")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
    tokenizer.pad_token = tokenizer.eos_token

    print("Loading model (4-bit quantized)...")
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_ID,
        quantization_config=BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16,
        ),
        device_map="auto",
        trust_remote_code=True,
    )

    model = prepare_model_for_kbit_training(model)

    print("Adding LoRA adapters...")
    model = get_peft_model(model, LoraConfig(
        r=16,
        lora_alpha=32,
        lora_dropout=0.05,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                       "gate_proj", "up_proj", "down_proj"],
        bias="none",
        task_type="CAUSAL_LM",
    ))
    model.print_trainable_parameters()

    print("Loading dataset...")
    dataset = load_dataset("json", data_files="train_data.jsonl", split="train")

    print("Starting training...")
    trainer = SFTTrainer(
        model=model,
        args=SFTConfig(
            output_dir="./output",
            num_train_epochs=1,  # Just 1 epoch for tonight
            per_device_train_batch_size=1,
            gradient_accumulation_steps=4,
            learning_rate=2e-4,
            bf16=True,
            logging_steps=10,
            save_steps=500,
            max_seq_length=4096,
            dataset_text_field="text",
        ),
        train_dataset=dataset,
        tokenizer=tokenizer,
    )

    trainer.train()
    trainer.save_model("./output/final")
    print("Done! Model saved to ./output/final")

if __name__ == "__main__":
    main()
```

Run it:
```bash
python train.py
```

**Expected output:**
```
Loading tokenizer...
Loading model (4-bit quantized)...
Adding LoRA adapters...
trainable params: 50,331,648 || all params: 20,900,000,000 || trainable%: 0.24%
Loading dataset...
Starting training...
{'loss': 2.1, 'step': 10}
{'loss': 1.8, 'step': 20}
...
Done! Model saved to ./output/final
```

## Step 4: Quick Test (30 min)

Create `test.py`:

```python
#!/usr/bin/env python3
"""Quick test of fine-tuned model."""

from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel
import torch

MODEL_ID = "openai/gpt-oss-20b"
ADAPTER_PATH = "./output/final"

# Load
tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
base_model = AutoModelForCausalLM.from_pretrained(
    MODEL_ID,
    torch_dtype=torch.bfloat16,
    device_map="auto",
    trust_remote_code=True,
)
model = PeftModel.from_pretrained(base_model, ADAPTER_PATH)

# Test prompt
prompt = """<|im_start|>system
You are an expert software architect who creates documentation wikis with source code traceability.
<|im_end|>
<|im_start|>user
Generate an architecture overview for a Node.js Express API with user authentication and a PostgreSQL database.
<|im_end|>
<|im_start|>assistant
"""

inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
outputs = model.generate(**inputs, max_new_tokens=1000, temperature=0.7)
print(tokenizer.decode(outputs[0], skip_special_tokens=True))
```

Run:
```bash
python test.py
```

---

## Cloud GPU Option (If No Local GPU)

### RunPod (~$2-3 for tonight)

1. Go to [runpod.io](https://runpod.io)
2. Launch "RTX 4090" template (~$0.44/hr)
3. Select PyTorch template
4. SSH in and run the steps above

### Google Colab (Free but slower)

Use this notebook structure:
```python
# Cell 1: Install
!pip install torch transformers accelerate peft trl datasets bitsandbytes

# Cell 2: Prepare data (copy prepare_data.py)

# Cell 3: Train (copy train.py, reduce to 1000 examples)

# Cell 4: Test (copy test.py)
```

---

## What You'll Have by Tonight

1. **LoRA adapter** (`./output/final/`) - ~100MB of fine-tuned weights
2. **Basic validation** - Model generates wiki-style documentation
3. **Foundation to iterate** - Can improve data/training tomorrow

## Tomorrow's Improvements (Optional)

- [ ] Add synthetic data for source traceability (`file:line` refs)
- [ ] Train for 3 epochs instead of 1
- [ ] Run proper evaluation
- [ ] Convert to GGUF for SemanticWiki integration

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| OOM error | Reduce `max_seq_length` to 2048 |
| Slow download | Model is ~40GB, use fast connection |
| CUDA error | Update: `pip install torch --upgrade` |
| Import error | Install missing: `pip install einops` |

## Quick Sanity Check

Before training, verify setup:
```bash
python -c "import torch; print(f'CUDA: {torch.cuda.is_available()}, GPU: {torch.cuda.get_device_name(0)}')"
python -c "from transformers import AutoTokenizer; t = AutoTokenizer.from_pretrained('openai/gpt-oss-20b'); print('Tokenizer OK')"
```

---

That's it! ~3 hours from start to a working fine-tuned model.
