# Launch validation — November 6, 2026

This records the consolidation pass for the prepared 2.0.0 source baseline. It is not an npm publication or a claim that generated prose has been independently verified.

| Check | Evidence |
| --- | --- |
| Supported runtime | Node 24.22.2: TypeScript build, 24 test files / 479 tests, and isolated compiled CLI contracts passed. GitHub CI covers Node 24 and 26, fresh dependency installation, package contents and dependency audit. |
| CLI isolation | Help, diagnostics, model listing, verification, search, export, and site preview work without keys or model downloads. Fixtures check nonzero failure statuses, conflicting flags, empty wikis, JSON output, and generated-directory exclusion. |
| Cloud writer | Live OpenAI Responses two-turn tool roundtrip passed. A full synthetic TypeScript repository produced five wiki pages, an OKF bundle, and a site through the real CLI; internal links passed verification. Only synthetic test source was sent. |
| Claude protocol | Mocked Messages requests test thinking/tool continuation and model-specific parameters. A live Anthropic check remains pending because no Anthropic key was configured. |
| Local model | The pinned 7B Q4_K_M download passed size/SHA-256 verification. On an Apple M1 Max with 64 GiB RAM, node-llama-cpp 3.22.3 at 8,192 context tokens passed two consecutive completions and two three-turn tool workflows (six more calls). The final real local CLI run produced six pages and six HTML files in about 68 seconds, plus working OKF, search, MCP, and a portable package that verified after extraction. |
| Site | Generated-page and DOM interaction tests cover search, navigation, accessibility behavior, source links, and opt-in chat. The live fixture's six HTML files had no broken local `href`/`src` targets. A real-browser visual review remains pending: no browser was connected and Computer Use was not approved for Chrome. |
| Agent integration | OKF export, provenance retention, managed-file protection, MCP client/server interaction, bounded reads, and portable package roundtrips pass fixture tests. Export does not label unreviewed claims as verified. |
| npm artifact | The 2.0.0 tarball contains compiled code and documentation, with no model weights or credentials. Its extracted CLI reports the expected version and rebuilds the live fixture site. This used the validated dependency installation, not a second fresh native install. |
| Dependencies | The final lockfile uses the public npm registry. `npm audit` reported zero vulnerabilities. |
| Older uncommitted draft | The separate RLVR worktree's nine changed/new files are preserved as a historical patch with SHA-256 hashes. Reconstruction verified eight exact originals plus the lockfile with private registry addresses normalized to public npm URLs. Its six helper tests/typecheck pass; it remains an unshipped research draft. |

## Native prose review and remaining limitation

The first native run invented technologies and API names. Removing prompt examples, adopting the model card's context/query format, and recording only validated context files corrected those observed cases. Discovery no longer treats ordinary `task`, TypeScript `export`, or `.map()` expressions as proof of batch processing, reporting, or a UI. All five final prose pages record the files actually provided; two copied code examples match the fixture source.

One factual error remains in the final synthetic fixture: the README-only Getting Started summary incorrectly claims the repository contains only README, although implementation source exists. Explicit partial-context instructions did not eliminate that error. This is a measured model-quality limitation; treat generated prose as unverified and review representative results before launch. Link checks, source-file provenance, and successful tool use do not validate every assertion.

The model also produced an index with no links to its planned pages. A new coverage guard replaces such output with a complete deterministic catalog. Replaying the exact captured native response without a model request proved that all five planned page links are retained. The final index guard has fixture/replay coverage; the full GPU run preceded that last guard.

## Before announcing the release

1. Run the synthetic Anthropic smoke check with an account that has access to the configured model.
2. Review the site in a real browser at desktop and mobile widths, including keyboard navigation and a hosted subpath.
3. Review generated explanations and citations against representative source code. Structural verification and model transport tests do not establish factual accuracy.
4. Confirm the merged commit's Node 24/26 CI, then use the documented release process when ready to publish.

During native loading, llama.cpp reported that token 128247 (`</s>`) was not marked as a control token and overrode its type. The completion, tool, and full-generation checks succeeded despite this metadata warning. Correct this in a future GGUF conversion; SemanticWiki does not modify the pinned weights.

See [contributing](../CONTRIBUTING.md), [provider smoke checks](models.md#verification), and the [baseline migration notes](LAUNCH_BASELINE.md).
