# Contributing to SemanticWiki

SemanticWiki is a TypeScript CLI whose primary product loop is:

```text
discover repository → retrieve evidence → generate pages → verify → update
```

Keep changes aligned with that loop. A new model, command, or UI feature is only
valuable if it preserves source traceability, resumability, and a truthful result
for both humans and scripts.

## Fast paths

Use the smallest loop that gives useful confidence:

| Available time | Good contribution | Suggested command |
| --- | --- | --- |
| 10–20 minutes | Documentation correction, test, isolated bug fix | `npm test -- --run tests/<file>.test.ts` |
| 30–90 minutes | Small behavior change with a focused regression test | `npm run build && npm test` |
| Half a day | CLI contract or service change | `npm run check` plus a compiled CLI smoke test |
| Several days | New workflow, provider, or model path | Add a fixture, failure-path tests, and a documented acceptance gate |

The default maintainer loop is:

```bash
npm ci
npm run check
node dist/cli.js --version
node dist/cli.js --help
```

`npm run check` is intentionally small and deterministic: it builds the CLI and
runs the test suite. Add heavier model, browser, network, or GPU checks as
explicit opt-in commands rather than making every edit wait for them.

## Change boundaries

- Prefer a user-visible contract plus a regression test over a broad refactor.
- Keep provider-specific behavior behind a shared generation/configuration result.
- Preserve existing flags while introducing replacements; mark aliases in help and
  the changelog before removing them.
- Do not treat an exhausted async generator as success. A completed run must have
  an explicit result and verification status.
- Keep secrets, model binaries, generated wikis, and local caches out of commits.
- When changing generated output, update a fixture or snapshot that explains the
  compatibility impact.

## Test tiers

1. **Unit tests** — pure parsing, planning, retrieval, formatting, and state logic.
2. **CLI contract tests** — compiled help/version, validation, exit codes, and
   site-only behavior without a model or API key.
3. **Workflow fixtures** — a tiny repository and fake provider exercising
   generate → verify → update/resume.
4. **Opt-in evaluations** — real API/local-model, browser, native-runtime, and
   hardware tests. These should record model, prompt, retrieval, and runtime
   versions so results can be reproduced.

The first three tiers should be cheap enough to run for every change. A green unit
suite alone is not evidence that a published CLI workflow works.

## Working in small or large chunks

For a small session, choose one observable outcome: one flag, one error path, one
verification rule, or one documentation page. Write the acceptance command before
editing.

For a large effort, split the work into vertical slices that leave the repository
usable after each slice:

1. define the contract and compatibility behavior;
2. add a fixture or fake boundary;
3. implement the smallest service change;
4. wire the CLI renderer and exit status;
5. test interruption, invalid input, and partial output;
6. update the changelog and migration note.

Avoid branches that only move code for days without adding a testable capability.

## Releases

Before a release:

```bash
npm run check
npm pack --dry-run
node dist/cli.js --version
```

The version shown by the compiled CLI is read from the package manifest. Release
notes must call out new commands, changed defaults, output/schema changes, removed
aliases, model/runtime requirements, and any migration action for generated wikis.

Use semantic versioning as a user-facing compatibility promise:

- **Patch**: fixes that preserve output and command contracts.
- **Minor**: additive commands/options, new providers, or opt-in output features.
- **Major**: removed flags, changed defaults that alter generated artifacts, package
  or cache schema changes without automatic migration, or changed exit semantics.

See [Product direction and compatibility](docs/PRODUCT_DIRECTION.md) for the
long-term interface and migration policy.
