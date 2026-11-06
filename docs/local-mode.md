# Local generation

SemanticWiki uses the fine-tuned [SemanticWiki Coder 7B v2 GGUF](https://huggingface.co/GhostScientist/semanticwiki-coder-7b-v2-gguf), based on Qwen2.5-Coder-7B. The default Q4_K_M file is 4,683,073,920 bytes. The exact revision and checksum are in the model registry and [model guide](models.md).

## Prepare and run

Use Node 24 or newer. Install normally (`npm install -g semanticwiki`) for native inference. Maintainer installs with `--ignore-scripts` are suitable for unit tests; native inference may need its runtime installed or rebuilt separately.

```bash
semanticwiki doctor
semanticwiki models list
semanticwiki models prepare
semanticwiki models verify
semanticwiki generate -r ./project --provider local --site
```

Preparation uses a temporary partial file, verifies the expected size and SHA-256, then atomically renames it. Reuse the same weight file across repositories. It lives in `~/.semanticwiki/models/`, not the source repository.

The 8,192-token default context is a conservative starting point. Allow at least 8 GB of system memory, with additional headroom for embeddings and the OS; available hardware and input size determine practical limits. Apple Metal, CUDA and CPU execution depend on node-llama-cpp's available backend. Automatic GPU-layer selection is the default. `--gpu-layers 0` selects CPU execution.

```bash
semanticwiki generate -r . --provider local --context-size 8192 --max-chunks 3000
semanticwiki generate -r . --provider local --model-path /absolute/path/custom.gguf
```

Local generation processes pages separately. The runtime releases its context sequence between requests and preserves conversation history in the tool loop. More memory does not guarantee documentation quality: review source citations, relationships and diagrams.

## Storage and offline use

`SEMANTICWIKI_HOME=/absolute/path` moves all shared state. `SEMANTICWIKI_MODELS_DIR=/absolute/path` overrides only GGUF storage. Embedding models are downloaded separately under the shared embedding cache. The default retrieval model is EmbeddingGemma 2 via Transformers.js.

Preparing GGUF weights alone does not make the entire workflow offline-ready. Run indexing once with network access to populate the embedding cache, then test the intended command offline. `--skip-index` uses an existing index; `search --code --mode keyword` uses its cached text without embedding inference. Optional reranking, contextual retrieval and browser AI each have separate model requirements.

Local providers never silently invoke a cloud writer. `--contextual` deliberately uses Anthropic and is rejected with a local provider unless `--contextual-local` is selected. Browser chat is separate from the CLI writer.

## Ollama

```bash
semanticwiki generate -r . --provider ollama --local-model your-installed-model
```

SemanticWiki connects to `http://localhost:11434` by default; override with `--ollama-host`. It does not imply that the official GGUF has already been imported into Ollama. Install/import the model there first and use its Ollama name. `--full-local --use-ollama` is retained as an alias.

## Troubleshooting

- **Download interrupted or hash mismatch:** rerun `models prepare`. Incomplete downloads are not accepted as weights.
- **Not enough memory:** close other applications, reduce `--context-size` / `--max-chunks`, or choose CPU offload settings that fit your hardware.
- **Native runtime unavailable:** check Node version and platform compatibility, reinstall with scripts enabled, then run `doctor` and a small generation.
- **Old weights in a repository:** `doctor` reports legacy directories. Move an intentionally retained GGUF to shared storage and use `--model-path`, or prepare the new default. Never rename old weights to the new model filename.
- **Incomplete wiki:** inspect generated files and `verify`, then use `continue --provider local --yes`. A successful link check is not a semantic-quality evaluation.
