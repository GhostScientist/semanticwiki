# Local Mode Guide

`--full-local` runs SemanticWiki entirely on your machine: no API key, no cloud calls, no per-token cost. Embeddings already run locally in every mode — local mode additionally replaces the cloud LLM with a local one.

```bash
semanticwiki generate -r ./my-project --full-local
```

There are two local backends:

1. **Bundled inference (default)** — in-process llama.cpp via `node-llama-cpp`. No extra software; the model is downloaded automatically on first run.
2. **Ollama** (`--use-ollama`) — use an [Ollama](https://ollama.com) server you already run, with any model it hosts.

## Bundled Inference (default)

On first run, SemanticWiki detects your hardware and downloads the bundled model:

| | |
|---|---|
| Model | `gpt-oss-20b-semanticwiki` — a GPT-OSS 20B fine-tune for architectural wiki generation |
| Format / size | Q8 GGUF, ~22.3 GB (one-time download) |
| Recommended hardware | 24 GB VRAM (GPU) or 32 GB RAM (CPU/Apple Silicon unified memory) |
| Context window | 32,768 tokens |
| Cache location | `~/.semanticwiki/models/` |

GPU support (CUDA, Metal, Vulkan) is auto-detected. Check what local mode will do before committing to a run:

```bash
semanticwiki generate -r ./my-project --full-local --estimate
```

This prints detected hardware, the recommended model, whether it's already downloaded, and estimated indexing/generation time and disk usage.

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--local-model <model>` | Model ID from the registry | auto-selected for your hardware |
| `--model-path <path>` | Use a specific GGUF file instead of the registry | — |
| `--gpu-layers <n>` | Layers to offload to GPU | auto |
| `--context-size <n>` | Context window size | `32768` |
| `--threads <n>` | CPU threads for inference | auto |

## Ollama Backend

If you already run Ollama and prefer managing models yourself:

```bash
ollama pull qwen2.5-coder:14b
semanticwiki generate -r ./my-project --full-local --use-ollama

# Custom host and model
semanticwiki generate -r ./my-project --full-local --use-ollama \
  --ollama-host http://192.168.1.50:11434 --local-model codestral:22b
```

The default Ollama model is `qwen2.5-coder:14b`. Any Ollama model with tool-calling support should work; coder-tuned models give the best results.

## Expectations vs Cloud Modes

Local generation is slower than the cloud modes and quality depends on the model and hardware. Rough guidance:

| | Cloud (`--direct-api`) | Local (GPU) | Local (CPU) |
|---|---|---|---|
| Small repo (<500 files) | minutes | ~10–20 min | ~30–60 min |
| Large repo (2000+ files) | ~30 min | hours | many hours |
| Cost | API charges | free | free |
| Privacy | cloud | 100% local | 100% local |

For large repos, combine local mode with `--max-chunks` and `-p/--path` to bound the work.

## Troubleshooting

**Model download fails or is interrupted** — re-run the command (the download restarts), or download manually:

```bash
mkdir -p ~/.semanticwiki/models
wget -O ~/.semanticwiki/models/gpt-oss-20b-semanticwiki-q8_0.gguf \
  "https://huggingface.co/GhostScientist/gpt-oss-20b-semanticwiki-gguf/resolve/main/gpt-oss-20b-semanticwiki-q8_0.gguf"
```

**Out of memory** — reduce the context window or GPU offload, or limit indexing:

```bash
semanticwiki generate -r <repo> --full-local --context-size 16384
semanticwiki generate -r <repo> --full-local --gpu-layers 20
semanticwiki generate -r <repo> --full-local --max-chunks 2000
```

If your machine can't fit the bundled 20B model, use `--use-ollama` with a smaller model (e.g. `qwen2.5-coder:7b`).

**Slow performance** — run with `--verbose` to confirm the GPU is being used; try forcing more GPU layers with `--gpu-layers 40`.

**Cannot connect to Ollama** — make sure `ollama serve` is running, or drop `--use-ollama` to use bundled inference instead.

## See Also

- [Local mode test repositories](./LOCAL_ONLY_TESTING.md) — repos of varying sizes/stacks for exercising local mode (maintainer testing guide)
- [Original design plan](./plans/LOCAL_MODE_PLAN.md) — historical
