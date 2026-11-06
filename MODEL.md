# SemanticWiki 7B v2: quantization and CLI integration plan

Reviewed 2026-09-16. This is an implementation plan, not a report of completed quantization or measured model performance. Companion: [CLI_IMPROVEMENTS.md](CLI_IMPROVEMENTS.md).

## Recommendation

Merge `GhostScientist/semanticwiki-coder-7b-v2` into its Qwen2.5-Coder-7B-Instruct base, convert the merged checkpoint to a high-precision GGUF, and produce **Q4_K_M, Q5_K_M, and Q8_0** from that same intermediate. Make Q4_K_M the candidate default for local wiki writing, Q5_K_M the quality option, and Q8_0 a comparison/reference option. Promote a default only after evaluation against the merged model and the unfine-tuned base.

Keep `node-llama-cpp` as the primary CLI runtime and Ollama as an optional backend. GGUF fits both existing implementations; adding AWQ, GPTQ, or an MLX runtime would add another deployment path before the current one is reliable. Start with sequential page generation and an 8,192-token context on a 16 GB Apple Silicon test machine. These are proposed launch targets, not established minimum requirements.

The strongest product proposition is an installable, source-grounded documentation model that works on ordinary developer hardware. Quantization alone will not deliver it: fix sequence disposal, prompt compatibility, token budgeting, and failure reporting in the same release.

## 1. What is actually published

| Item | Verified finding | Consequence |
| --- | --- | --- |
| Repository | [semanticwiki-coder-7b-v2](https://huggingface.co/GhostScientist/semanticwiki-coder-7b-v2) | Use this ID; the card's usage example still names `deepwiki-coder-7b-v2`. |
| Artifact type | [Files](https://huggingface.co/GhostScientist/semanticwiki-coder-7b-v2/tree/4936b61e5029cf32a7c4ff8122f4b50640522862) contain `adapter_model.safetensors` (~646 MB), adapter config, tokenizer files, and a chat template; no full base weights or GGUF. | This is a LoRA adapter, not a standalone 7B checkpoint. |
| Adapter configuration | [Config](https://huggingface.co/GhostScientist/semanticwiki-coder-7b-v2/blob/4936b61e5029cf32a7c4ff8122f4b50640522862/adapter_config.json): Qwen2.5-Coder-7B-Instruct base, causal LM, rank 64, alpha 128, seven attention/MLP projections, base `revision: null`. | Merge into that exact model family. Recover the training base revision if possible. |
| Training scope | Card reports 28 examples, four epochs, 12,288-token training sequences, and wiki-page formatting supervision. | Evaluate generalization and planning separately; training loss/accuracy are not held-out quality results. |
| Context | [Base config](https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct/blob/main/config.json) and adapter tokenizer config specify 32,768. | Architectural capacity is not evidence of fine-tuned quality at that length. Start smaller. |
| Prompt template | [Published template](https://huggingface.co/GhostScientist/semanticwiki-coder-7b-v2/blob/4936b61e5029cf32a7c4ff8122f4b50640522862/chat_template.jinja) uses Qwen chat markers and a distinct tool-call format. | Preserve tokenizer/template metadata; do not apply the old GPT-OSS prompt wrapper. |

The observed repository revision is `4936b61e5029cf32a7c4ff8122f4b50640522862`. Pin it for the first experiment; record a new revision explicitly if weights change. The current card has stale DeepWiki naming and does not establish a complete redistribution/provenance record. Before publishing merged weights, document the base and adapter licenses, required notices, training-data provenance, and allowed redistribution. The CLI's MIT license does not itself license the model or dataset.

## 2. Existing integration and blockers

The current path is `generate --full-local` → `generateWikiLocalPageByPage()` → `createLLMProvider()` → `LocalLlamaProvider` or `OllamaProvider`. The 7B writer fits this design: the CLI retrieves source context, the model writes one page, and the CLI saves it. It need not become a general tool-using agent to ship a useful first version.

| Priority | Evidence in this checkout | Required change |
| --- | --- | --- |
| P0 | [model-manager.ts](src/llm/model-manager.ts), `MODEL_REGISTRY`, contains only the 22.3 GB GPT-OSS 20B Q8 artifact; family types/defaults are `gpt-oss`. | Add versioned 7B entries, new family/identity, real sizes and checksums. Keep the old ID loadable for explicit users. |
| P0 | [local-llama-provider.ts](src/llm/local-llama-provider.ts), `initialize()` allocates 20 sequences; `chat()` gets a fresh sequence and calls `session.dispose()` without sequence disposal. Installed/locked `node-llama-cpp` 3.18.1 defaults `autoDisposeSequence` to false. | Use one reusable sequence or explicitly dispose each sequence. Wrap the complete lifecycle in `try/finally`. Add a >30-call test; the current code can exhaust its 20-sequence pool even though the comment says disposal releases it. This is source-confirmed; GPU reproduction was not run. |
| P0 | [wiki-agent.ts](src/wiki-agent.ts), `generateSinglePage()` uses a different page prompt and citation format from the fine-tune. `makeSourceReferencesClickable()` does not cover the card's `Sources: [path:line]()` form. | Add a versioned writer prompt using the training context/query delimiters and normalize citations into one tested representation. |
| P0 | Source context is truncated by character counts; planning requests up to 8,192 output tokens and page writing requests 4,096, independently of context size. | Budget all prompts using the actual tokenizer, including the system prompt, chat template, retrieved code, and output allowance. |
| P0 | Provider initialization can yield an error and return; [cli.ts](src/cli.ts) prints a final generated-path message afterward. Failed pages also need not prevent `complete`. | Typed failure/partial/success results; nonzero status on failed generation; validate the final index and required pages. |
| P1 | `ensureModel()` accepts files within a size tolerance; downloads write directly to the final path, use mutable `main`, and lack digest verification/resume. | Immutable manifest, SHA-256, `.part` download, validated resume, lock, atomic rename, and offline cache checks. |
| P1 | `--context-size` reaches bundled inference, but the Ollama provider doesn't pass `num_ctx`; its model info reports a hard-coded context. | Pass and verify Ollama context settings and report the actual effective limit. |
| P1 | Hardware detection estimates memory from GPU names; old family suggestions and a LiquidAI banner remain. | Query runtime memory where supported, distinguish total/free/unified memory, reserve headroom, and display the actual selected artifact/backend. |

Also address [llm/types.ts](src/llm/types.ts), [llm/index.ts](src/llm/index.ts), `WikiGenerationOptions`, and CLI help as one integration change. Adding a registry row alone leaves stale defaults and misleading output.

The bundled provider currently retains only the last user text, dropping earlier turns and tool-result blocks. That is a provider-contract limitation, but it does not block the current one-shot page writer. Do not advertise multi-turn local tools until history conversion, schema validation, and error semantics are implemented and tested. Planning JSON is another capability to evaluate independently; retain a deterministic page-plan fallback and generate navigation/index pages deterministically from successful page records.

## 3. Reproducible quantization workflow

### A. Freeze inputs and establish an unquantized baseline

Create a model build manifest containing:

- Base repository and immutable revision, adapter repository and revision, tokenizer/template hashes, and all input-file SHA-256 values.
- Python, PyTorch, Transformers, PEFT, safetensors, and conversion dependency versions; pinned llama.cpp commit; build flags and host hardware.
- Prompt version, evaluation-set version, output filenames/checksums, and the compatible CLI/runtime version.

Recover the original base revision from training records if available. If it cannot be recovered, choose and record a specific compatible base revision and label this as a reconstruction; `revision: null` does not establish exact training provenance. Avoid downloading or deserializing `training_args.bin` merely to inspect configuration.

Use a separate model-build environment. The card's framework versions are metadata to verify, not a ready-made dependency lock. Pin a compatible stack after a small adapter-load test; the conversion environment may need a different Transformers version from the merge environment. Download model inputs once into explicit staging directories.

First run a small frozen prompt set with the base plus active adapter in BF16 (or FP16 if the chosen host requires it). Save completions and scores before merging. This makes it possible to distinguish an export error from a bad fine-tune or prompt mismatch.

### B. Merge once at high precision

Implement `scripts/model/merge_adapter.py` with explicit input/output arguments. Its core should follow the [PEFT merge workflow](https://huggingface.co/docs/peft/developer_guides/lora#merge-lora-weights-into-the-base-model):

```python
# Proposed script core; paths point to previously pinned local snapshots.
base = AutoModelForCausalLM.from_pretrained(
    base_dir, dtype=torch.bfloat16, device_map="cpu",
    local_files_only=True, trust_remote_code=False,
)
adapted = PeftModel.from_pretrained(
    base, adapter_dir, local_files_only=True,
)
merged = adapted.merge_and_unload(safe_merge=True)
merged.save_pretrained(output_dir, safe_serialization=True)
tokenizer = AutoTokenizer.from_pretrained(
    adapter_dir, local_files_only=True, trust_remote_code=False,
)
tokenizer.save_pretrained(output_dir)
```

Check vocabulary size/token IDs against the base before merging. Confirm that saving the tokenizer preserves `chat_template.jinja`, EOS/PAD behavior, and added tokens; do not silently substitute the base tokenizer if the adapter export differs. Run the saved merged model against the same prompts and compare scores/logits within dtype-appropriate tolerance. The output must load without PEFT and contain full model weights plus config/tokenizer files.

Plan for a 64 GB RAM build host and roughly 80–100 GB free staging space when retaining the base, merged checkpoint, high-precision GGUF, and all candidates. These are conservative planning allowances, not measured peak requirements. CPU merging/quantization is viable; GPU access is most valuable for baseline evaluation. An existing machine or a one-off build job is sufficient; no standing inference service is required.

### C. Convert to GGUF, then quantize each candidate

Build a pinned llama.cpp checkout and record its commit. From that checkout, after creating `artifacts/`, the proposed commands are:

```bash
python convert_hf_to_gguf.py ./merged-semanticwiki-coder-7b-v2 \
  --outfile ./artifacts/semanticwiki-coder-7b-v2-F16.gguf \
  --outtype f16

./build/bin/llama-quantize \
  ./artifacts/semanticwiki-coder-7b-v2-F16.gguf \
  ./artifacts/semanticwiki-coder-7b-v2-Q4_K_M.gguf Q4_K_M
./build/bin/llama-quantize \
  ./artifacts/semanticwiki-coder-7b-v2-F16.gguf \
  ./artifacts/semanticwiki-coder-7b-v2-Q5_K_M.gguf Q5_K_M
./build/bin/llama-quantize \
  ./artifacts/semanticwiki-coder-7b-v2-F16.gguf \
  ./artifacts/semanticwiki-coder-7b-v2-Q8_0.gguf Q8_0
```

This follows the current [llama.cpp quantizer documentation](https://github.com/ggml-org/llama.cpp/tree/master/tools/quantize). The checkout, dependencies, merge script, and directories above are proposed build assets, not files created by this review. Confirm flags against the pinned revision before turning this into automation. Convert/load F16 successfully before quantization; always derive each quant from that high-precision intermediate, never Q8 → Q5 → Q4.

Inspect GGUF architecture, tokenizer, template, EOS, and context metadata. Load every candidate through **the CLI's exact `node-llama-cpp` version**, not just the conversion tool's runtime. Do not manually double-wrap prompts: verify which chat wrapper the runtime resolves and compare rendered token sequences against the Hugging Face template.

Start with ordinary K-quants. If Q4 misses the quality gate, compare Q5 and optionally an importance-matrix Q4 build. Use a separate representative calibration set containing source code, line references, wiki text, and diagrams; keep evaluation examples and private customer code out of calibration. Record calibration hashes and quantizer options. Importance matrices are a follow-up experiment, not a first-release dependency.

### D. Candidate artifacts and memory

| Artifact | Estimated disk size, decimal GB | Intended use |
| --- | --- | --- |
| F16 GGUF | ~15–16 | Conversion baseline; keep out of the normal CLI download path. |
| Q8_0 | ~8–8.5 | High-quality comparison and larger machines. |
| Q5_K_M | ~5.3–5.6 | Quality option if it materially beats Q4 on grounded writing. |
| Q4_K_M | ~4.5–4.9 | Candidate default for 16 GB developer laptops. |

These are estimates from the [base model's 7.61B parameters and supported GGUF formats](https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF), not measured sizes of this fine-tune. Replace them with artifact byte counts before registering downloads. A 4.7 GB file is approximately a 79% smaller download than the current 22.3 GB artifact; that is an illustrative size comparison, not a speed claim.

Weights are only part of inference memory. From the base config, an unquantized FP16 KV cache is approximately `2 × 28 layers × 4 KV heads × 128 head dimension × 2 bytes = 56 KiB/token` per sequence: roughly 448 MiB at 8K, 672 MiB at 12K, and 1.75 GiB at 32K. This calculation excludes runtime buffers, embeddings, FAISS, OS memory, and backend-specific allocations. Measure actual process and GPU peaks. Twenty sequences add substantial memory pressure and serve no purpose in a sequential writer.

Proposed validation matrix:

- Apple Silicon, 16 GB unified memory: Q4, 8K context, one sequence; primary launch target.
- Apple Silicon, 24/32 GB: Q4/Q5 at 8K and 12K; assess Q8 separately.
- NVIDIA, 8 GB VRAM with sufficient host RAM: Q4 at 8K; verify offload and peak memory rather than promising a fit.
- CPU-only Linux/Windows, 16 GB RAM: Q4 at 4K/8K; report latency explicitly.
- 8 GB total system RAM: experimental until measured; do not auto-recommend it based only on file size.

## 4. Adapt the writer to the fine-tune

Use a versioned prompt with the card's `<START_OF_CONTEXT>`, `<END_OF_CONTEXT>`, and `<query>` delimiters. Supply repository-relative paths and explicitly numbered source lines. Preserve the model's useful page structure, but require diagrams/tables only when they explain the topic. A training-format requirement is not a reason to invent a diagram or facts for a trivial page.

Enforce the budget before inference:

```text
system + template + question + retrieved source + output reserve + safety margin
    <= effective runtime context
```

At 8,192 tokens, initially reserve up to 3,072 for the page and a small explicit safety margin; retrieve only what fits in the remainder. Tune those values with evaluation. Planning has a separate, smaller output budget and must summarize very large file lists. Report omitted context rather than silently claiming complete repository coverage.

Parse citations into `{path, startLine, endLine, sourceCommit}`. Validate that the file and range exist and that supplied excerpts support the referenced material. Render repository-host links pinned to the source commit when available; offer a local source viewer/link resolver when offline. Support nested wiki directories and non-JS languages. Merely turning a string into a clickable URL is not source grounding.

For this release, use a constrained planner or deterministic fallback and a deterministic index. Treat page-writing quality, plan-schema reliability, and any later tool-calling quality as separate evaluations. Keep model ID and prompt version in generation metadata so failures and regressions are reproducible.

## 5. Evaluation and promotion gates

Build a frozen, repository-disjoint evaluation set: at least 8 repositories and 40 page tasks, initially TypeScript/JavaScript, Python, Go, Rust, and COBOL if legacy documentation remains part of the offering. Pin repository commits and manually specify the expected files, facts, and line ranges for a small core subset. Check overlap against the 28 training examples before calling the set held-out. Add missing-context, long-input, rename/deletion, and nested-page cases.

Compare the unfine-tuned base, base+adapter, merged high precision, F16 GGUF, Q8, Q5, and Q4. Separate **fixed-context writer evaluation** from **end-to-end retrieval + planning + writing evaluation**, so a retrieval change cannot masquerade as a quantization regression. Use the same prompts/context/sampling policy and repeat a subset to estimate variation. Optional cloud/competitor baselines require explicit model/tool versions and equal task scope; no paid comparison runs were performed here.

Proposed gates, to calibrate once baseline results exist:

| Dimension | Candidate release gate |
| --- | --- |
| Export fidelity | Merged and F16 exports show no unexplained score/logit regression from base+adapter. |
| Structural output | All evaluated files parse as Markdown; valid expected page paths; no empty required pages; final cross-links resolve. |
| Citations | ≥98% references resolve to valid source ranges; ≥95% sampled factual claims are supported by their cited evidence, adjudicated against source. |
| Quantization quality | No more than 2 percentage points below high precision on grounding and required-fact coverage; inspect every new severe error. Q5 wins by default if Q4 fails. |
| Visual output | All emitted Mermaid diagrams parse; semantic diagram correctness is reviewed on a sample. |
| Runtime | A 30+ generation-call soak succeeds without sequence exhaustion; repeat runs release memory; OOM/interruption produces actionable failure and resumable state. |
| Offline | After explicit preparation, local-repository generation, verification, and static viewing succeed with networking disabled. |
| Performance | Record cold/warm load, prompt/decode tokens/sec, p50/p95 page latency, end-to-end time, peak RAM/VRAM, and download bytes per machine. No invented speed target. |

Report counts and confidence/variation alongside percentages. Automated source checks cannot prove semantic correctness; use human review and a calibrated rubric, with LLM judging only as supporting evidence. Compare v2 against the base to establish whether the fine-tune improves the actual product, not just formatting.

## 6. Distribution and CLI experience

Proposed separate artifact repository: `GhostScientist/semanticwiki-coder-7b-v2-GGUF` (not verified to exist). Publish only after the gates above, with model card, license/notices, prompt examples, benchmark results, SHA-256 sums, and build manifest. Keep model binaries out of npm. Release CLI and model independently but record a tested compatibility pair.

Use immutable resolve URLs and manifest entries containing at least model ID, source revision, filename, exact bytes, SHA-256, quantization, base architecture, prompt/template version, supported context, and measured hardware profiles. Cache under a configurable SemanticWiki data directory, with separate model, embedding, and repository caches. Preserve a previous working artifact for rollback; changing the default must not silently replace an explicitly selected model.

The existing CLI can load a manually produced candidate before registry work:

```bash
semanticwiki generate -r ./my-project --full-local \
  --model-path /absolute/path/semanticwiki-coder-7b-v2-Q4_K_M.gguf \
  --context-size 8192 -o ./wiki-v2
```

This command uses existing flags, but the runtime defects above must be fixed before treating it as a validated user recipe.

For Ollama, import the same GGUF using a `Modelfile` with `FROM /absolute/path/to/model.gguf` and a measured `PARAMETER num_ctx 8192`, then `ollama create semanticwiki-coder:7b-v2-q4 -f Modelfile`. Verify the imported chat template before evaluation. The [Ollama import documentation](https://docs.ollama.com/import) confirms GGUF import; it does not establish this model's quality or compatibility. Existing CLI invocation:

```bash
semanticwiki generate -r ./my-project --full-local --use-ollama \
  --local-model semanticwiki-coder:7b-v2-q4 -o ./wiki-v2-ollama
```

Proposed new commands: `models list`, `models pull`, `models inspect`, `models verify`, and `doctor`. A `models prepare`/offline preparation flow should fetch the writer, embedding model, and required runtime assets, show total disk requirements, and verify completeness. `--offline` must forbid opportunistic downloads; `--full-local` currently selects local inference but does not itself establish network isolation. The browser chat model is a separate runtime/artifact and will not automatically use this GGUF.

## 7. Execution order and deliverables

Effort assumes one maintainer and access to test hardware; evaluation runtime and account setup are additional elapsed time.

| Milestone | Deliverables | Estimate | Exit criterion |
| --- | --- | --- | --- |
| M1: reproducible baseline | Input/build manifests, corrected model-card draft, merge script, fixed prompt tasks. | 1–2 days | Adapter and merged model agree; provenance gaps documented. |
| M2: candidate quants | Pinned conversion script, F16/Q8/Q5/Q4 artifacts, checksums, load smoke tests. | 1–2 days | All artifacts load in the selected CLI runtime. |
| M3: usable runtime | Sequence ownership, token budgets, prompt/citation adapter, accurate terminal status, registry/download handling. | 3–5 days | 30+ call soak, failure tests, and representative wiki generation pass. |
| M4: evidence | Writer and end-to-end evaluation reports, hardware measurements, offline test. | 2–4 days plus runs | Select Q4/Q5 using published gates. |
| M5: release | GGUF repository, candidate npm compatibility release, installation guide, rollback procedure. | 1–2 days | Fresh-machine install → generation → verification succeeds. |

First work should be M1 plus the P0 CLI fixes in [CLI_IMPROVEMENTS.md](CLI_IMPROVEMENTS.md). Do not wait for a broad CLI redesign to evaluate the model. Do not announce a laptop-ready local offering until the packaged installation, memory behavior, grounded output, and offline path have all been demonstrated.
