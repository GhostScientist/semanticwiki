# Models and runtime storage

SemanticWiki uses the same source retrieval and verification workflow with each provider. Choose the provider explicitly when you want repeatable runs. You supply your own cloud API key; keys are never embedded in generated sites or wiki packages.

| Provider | Default | Credential / setup |
| --- | --- | --- |
| `anthropic` | `claude-sonnet-5-5` | `ANTHROPIC_API_KEY` |
| `openai` | `gpt-6.1-sol` | `OPENAI_API_KEY` |
| `local` | `semanticwiki-coder-7b-v2` (Q4_K_M) | One shared GGUF download; no cloud key |
| `ollama` | `semanticwiki-coder-7b-v2` | Import the GGUF into your running Ollama server, or select an installed model |

```bash
semanticwiki generate -r ./project --provider anthropic --site
semanticwiki generate -r ./project --provider openai --site
semanticwiki generate -r ./project --provider local --site
semanticwiki generate -r ./project --provider ollama --local-model your-installed-model --site
```

`--model` selects a cloud model; `--local-model` selects a registered local or installed Ollama model. `--model-path /absolute/path/model.gguf` uses an existing GGUF. The compatibility flags `--direct-api` and `--full-local` remain available.

Cloud requests transmit the selected source context to the selected provider. Local generation runs inference on the machine. The first run can download model weights and embedding assets; prepare those caches before using the tool without a network connection. Browser chat is a separate optional feature and does not run this GGUF in the browser.

## Cloud API behavior

The Anthropic backend uses the Messages API, preserves signed and redacted thinking blocks during tool use, and enables adaptive thinking only for supported model families. Current Sonnet rejects sampling parameters such as temperature, so they are omitted for those models. See the [official Sonnet model documentation](https://platform.claude.com/docs/en/models/sonnet-5-5/overview).

The OpenAI backend uses the Responses API with `store: false`. It sends back complete assistant output, including encrypted reasoning items, when returning tool results. This is required for reliable multi-turn tool use. Temporary rate limits and server failures receive bounded retries; authentication and model-access failures are reported without silently switching models or providers. See [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling) and [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol).

Defaults were checked on November 6, 2026. Provider availability still depends on your account; use `--model` for another supported model when needed.

## Local model

The default is [GhostScientist/semanticwiki-coder-7b-v2-gguf](https://huggingface.co/GhostScientist/semanticwiki-coder-7b-v2-gguf), based on Qwen2.5-Coder-7B-Instruct:

- File: `semanticwiki-coder-7b-v2-q4_k_m.gguf`
- Size: 4,683,073,920 bytes (about 4.68 GB / 4.36 GiB)
- Revision: `e04e873741f29e5d8b80adf5d1dc6f3f848f6c00`
- SHA-256: `333f4285f6af58d97bfaec3d22b27922b2993d9d54f1f24ea38e6d5358b60393`
- Model context limit: 32,768 tokens; runtime default: 8,192 tokens
- Practical starting point: 8 GB system RAM or 6 GB GPU memory, with more headroom for larger contexts and repositories

Downloads first check for enough free disk space for the entire file plus 256 MiB of headroom. They go to a unique `.partial` file and become usable only after exact size and SHA-256 verification. A failed download never replaces an existing model. Cached weights are verified before loading. When disk space is tight, set `SEMANTICWIKI_MODELS_DIR` to an absolute location on another drive.

The runtime uses `node-llama-cpp`, automatic GPU offload, and one reusable context sequence. Each request includes the full retained conversation and tool results. The sequence is released on success and failure, so a wiki with many pages does not exhaust a fixed pool. CPU inference is available with `--gpu-layers 0`; reduce `--context-size` if memory is tight. See the [node-llama-cpp runtime documentation](https://node-llama-cpp.withcat.ai/guide/chat-session).

The prior GPT-OSS model and small completion model remain available by explicit local model ID for existing workflows. They are not selected instead of the new 7B model automatically.

## Storage locations

Shared runtime files default to the following paths, independent of the repository from which you run the CLI:

| Data | Default location |
| --- | --- |
| GGUF weights | `~/.semanticwiki/models/` |
| Embedding and reranker weights | `~/.semanticwiki/cache/embeddings/` |
| Temporary repository clones | `~/.semanticwiki/cache/repos/` |
| Generated wiki and its portable search index | Your selected output directory |

Set `SEMANTICWIKI_HOME` to an absolute directory to move shared runtime storage. `SEMANTICWIKI_MODELS_DIR` can override only the GGUF location. Relative overrides are rejected to avoid accidentally writing large model files into a working repository.

Existing `.semanticwiki-models` and `.semanticwiki-repos` folders from older versions are not deleted automatically. After verifying a new run, you can remove those old caches yourself to reclaim disk space. Existing weights under `~/.semanticwiki/models` remain available.

## Verification

The offline test suite mocks network calls and native inference. It checks cloud request shapes, complete tool-result/continuation history, local sequence cleanup across more than twenty pages, default model selection, shared paths, checksum failures, and partial download cleanup. These tests do not spend API credits or download model weights. Live cloud and native model checks are separate release checks and should use small synthetic fixtures.

Run the opt-in smoke harness after a build:

```bash
npm run build
node scripts/check-providers.mjs --provider openai
node scripts/check-providers.mjs --provider anthropic
node scripts/check-providers.mjs --provider local
```

Cloud checks perform a two-turn synthetic tool call. The local check makes two consecutive completions to exercise sequence reuse. `--model` overrides a single provider's default. Local checks require prepared, verified weights; add `--download` explicitly to permit downloading them. `--provider all` checks all three backends and reports each failure separately.

Downloads that receive no data for two minutes time out and remove their partial file. A force-terminated process can leave a uniquely named `.partial` file in the shared model directory; it is never loaded as a model. When no download is running, these `.partial` files can be removed to reclaim space.
