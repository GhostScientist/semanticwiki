# Testing local generation

Use the [local setup guide](local-mode.md) to prepare SemanticWiki Coder 7B v2. The default automated suite does not download models:

```bash
npm run check
```

A maintainer's native check should record model revision/checksum, runtime version, hardware/backend, context size, output and error/cleanup behavior. Run a short completion twice on the same provider to catch sequence lifetime errors. Then generate a small fixture wiki, verify its links, export OKF, build the site and query the content through the CLI/MCP.

```bash
semanticwiki doctor --json
semanticwiki models verify
semanticwiki generate -r ./tiny-fixture --provider local -o ./fixture-wiki --max-chunks 20 --site
semanticwiki verify -o ./fixture-wiki --json
semanticwiki search "entry point" -o ./fixture-wiki --json
```

First-use indexing may download embedding assets when native vector search is available. Keep fixture output outside the source tree and set an absolute `SEMANTICWIKI_HOME` if the check needs isolated storage. Verify that no `.semanticwiki-models` or `.semanticwiki-repos` directory appears in the fixture repository.

Document real measurements; old GPT-OSS timing estimates are not evidence for the 7B model. A structural pass is not an assessment of citation accuracy or prose quality. The historical evaluation rubric remains in [plans/EVAL_PLAN.md](plans/EVAL_PLAN.md).
