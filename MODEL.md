# SemanticWiki model defaults

The default local writer is **SemanticWiki Coder 7B v2 Q4_K_M**, based on Qwen2.5-Coder-7B-Instruct:

[GhostScientist/semanticwiki-coder-7b-v2-gguf](https://huggingface.co/GhostScientist/semanticwiki-coder-7b-v2-gguf)

```bash
semanticwiki models prepare
semanticwiki models verify
semanticwiki generate -r ./project --provider local
```

The exact pinned revision, file size, SHA-256, runtime limits and cloud-provider defaults are documented in [docs/models.md](docs/models.md). Weights are shared under `~/.semanticwiki/models`; do not commit them into a repository. The runtime defaults to an 8,192-token context and automatic GPU offload.

For hardware setup, offline preparation, existing GGUF files and Ollama, see [docs/local-mode.md](docs/local-mode.md). The prior GPT-OSS model remains explicitly selectable; it is no longer the default.
