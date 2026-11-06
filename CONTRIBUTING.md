# Contributing

Use Node 24+ (`.node-version`), npm, and TypeScript ESM imports with `.js` suffixes. Keep documentation maintenance as the primary workflow. Read [AGENTS.md](AGENTS.md) for module ownership and conventions.

## Checks

```bash
npm ci --ignore-scripts
npm run check
npm run test:coverage
npm pack --dry-run --ignore-scripts
```

`check` builds, runs the fixture/provider/MCP/site tests, then exercises the compiled CLI from an unrelated temporary directory. It must not require cloud keys or download weights. CI runs Node 24 and 26, checks package contents, and rejects high/critical dependency advisories.

Add behavioral tests for changes to provider request/response handling, page paths, generation completion, export contracts and cache compatibility. Tests should cover outcomes and failure modes, not only check that a source string exists.

## Live smoke tests

Live tests are separate from the default suite because they incur costs or download models. Use your own credentials in the environment; never print, commit, or add them to fixtures.

1. Cloud: send a tiny synthetic request and a tool-result follow-up through each provider. Confirm the selected model, continuation state and usage. Do not send a private repository as a connectivity test.
2. Local: `semanticwiki models prepare`, `semanticwiki models verify`, then a short completion and repeated calls. Record hardware, model identity, context and runtime version.
3. Embeddings: index a tiny fixture repo and query it. Confirm model/version metadata and cache location. Re-index after changing a source file.
4. Site: build a multi-page fixture, inspect desktop/mobile and dark/light views, exercise search, keyboard focus, links, raw Markdown and agent exports. Check both HTTP subpaths and `file://`.
5. Package: create/extract a fixture package, run `verify` and `search`, and inspect it for accidental model weights or credentials.

## Releasing

The source version is prepared for the next major launch; merging does not publish to npm. Review [launch baseline notes](docs/LAUNCH_BASELINE.md), update release evidence, and require the complete check suite before release. `scripts/release.sh` performs checks and asks explicitly before tagging, pushing a release and publishing. Test the packed artifact on a supported Node version first.

Historical plans live under `docs/plans/`. Keep current user instructions in the README and guides; don't present proposed features as shipped behavior.
