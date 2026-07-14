# Local Mode Testing Guide

Maintainer guide: public GitHub repositories of varying sizes and tech stacks for testing `--full-local` mode. For user-facing local mode documentation, see [local-mode.md](./local-mode.md).

## Test Repositories

### Small (~100–500 files)

| Repo | Language | Test command |
|------|----------|--------------|
| [jq](https://github.com/jqlang/jq) (~300 files) | C | `semanticwiki generate -r https://github.com/jqlang/jq --full-local -o ./wiki-jq` |
| [httpie](https://github.com/httpie/cli) (~200 files) | Python | `semanticwiki generate -r https://github.com/httpie/cli --full-local -o ./wiki-httpie` |
| [bat](https://github.com/sharkdp/bat) (~150 files) | Rust | `semanticwiki generate -r https://github.com/sharkdp/bat --full-local -o ./wiki-bat` |

### Medium (~500–2,000 files)

| Repo | Language | Test command |
|------|----------|--------------|
| [GnuCOBOL](https://github.com/OCamlPro/gnucobol) (~1,200 files) | COBOL/C | `semanticwiki generate -r https://github.com/OCamlPro/gnucobol --full-local -o ./wiki-gnucobol` |
| [ripgrep](https://github.com/BurntSushi/ripgrep) (~800 files) | Rust | `semanticwiki generate -r https://github.com/BurntSushi/ripgrep --full-local -o ./wiki-ripgrep` |
| [FastAPI](https://github.com/tiangolo/fastapi) (~600 files) | Python | `semanticwiki generate -r https://github.com/tiangolo/fastapi --full-local -o ./wiki-fastapi` |
| [esbuild](https://github.com/evanw/esbuild) (~1,500 files) | Go | `semanticwiki generate -r https://github.com/evanw/esbuild --full-local -o ./wiki-esbuild` |

GnuCOBOL is notable for exercising the COBOL chunking capability.

### Large (2,000+ files)

Use `--max-chunks` and/or `-p/--path` to bound the work.

| Repo | Language | Test command |
|------|----------|--------------|
| [rust-lang/rust](https://github.com/rust-lang/rust) (30,000+ files) | Rust | `semanticwiki generate -r https://github.com/rust-lang/rust --full-local -o ./wiki-rust-std -p library/std` |
| [Deno](https://github.com/denoland/deno) (~5,000 files) | Rust/TS | `semanticwiki generate -r https://github.com/denoland/deno --full-local -o ./wiki-deno --max-chunks 5000` |
| [Neovim](https://github.com/neovim/neovim) (~4,000 files) | C/Lua | `semanticwiki generate -r https://github.com/neovim/neovim --full-local -o ./wiki-neovim --max-chunks 4000` |

### Enterprise / Mainframe (COBOL/JCL)

| Repo | Language | Test command |
|------|----------|--------------|
| [AWS CardDemo](https://github.com/aws-samples/aws-mainframe-modernization-carddemo) (~100 files) | COBOL/JCL | `semanticwiki generate -r https://github.com/aws-samples/aws-mainframe-modernization-carddemo --full-local -o ./wiki-carddemo` |
| [COBOL Programming Course](https://github.com/openmainframeproject/cobol-programming-course) (~200 files) | COBOL/JCL | `semanticwiki generate -r https://github.com/openmainframeproject/cobol-programming-course --full-local -o ./wiki-cobol-course` |

CardDemo contains realistic production-like COBOL/CICS patterns.

## Expected Runtimes

With the bundled `gpt-oss-20b-semanticwiki` model on recommended hardware (24 GB VRAM GPU or Apple Silicon with 32 GB+ unified memory):

| Repo size | Expected time |
|-----------|---------------|
| Small | ~15–30 min |
| Medium | ~30–60 min |
| Large (chunk-capped) | ~2–3 hours |

CPU-only inference is 3–5x slower. Smaller Ollama models (e.g. `qwen2.5-coder:7b`) are faster but lower quality.

## Testing Checklist

### Basic functionality
- [ ] Model auto-download works on first run (with progress bar)
- [ ] Hardware detection identifies GPU correctly
- [ ] `--estimate` reports hardware, model status, and time estimates
- [ ] Wiki pages are generated with source references

### Quality
- [ ] Generated Mermaid diagrams render correctly
- [ ] Source `file:line` references are accurate
- [ ] Cross-references between pages resolve (`semanticwiki verify`)
- [ ] Index page lists all generated pages

### Error handling
- [ ] Graceful handling of insufficient memory
- [ ] Recovery from network errors during model download
- [ ] Proper cleanup on Ctrl+C interrupt

### Ollama backend
```bash
ollama pull qwen2.5-coder:14b
semanticwiki generate -r https://github.com/jqlang/jq --full-local --use-ollama -o ./wiki-jq-ollama
```

## Comparing Local vs Cloud Quality

```bash
semanticwiki generate -r https://github.com/httpie/cli --full-local -o ./wiki-local
semanticwiki generate -r https://github.com/httpie/cli --direct-api -o ./wiki-cloud
diff -r ./wiki-local ./wiki-cloud
```

## Troubleshooting

See the [Local Mode Guide troubleshooting section](./local-mode.md#troubleshooting) for model download, out-of-memory, and performance fixes.
