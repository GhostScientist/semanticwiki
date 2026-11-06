# Launch validation — November 6, 2026

This records the consolidation pass for the prepared 2.0.0 source baseline. It is not an npm publication or a claim that generated prose has been independently verified.

| Check | Evidence |
| --- | --- |
| Supported runtime | Node 24.22.2: TypeScript build, 23 test files / 474 tests, and isolated compiled CLI contracts passed. An earlier checkpoint also passed on Node 26.13.0; CI repeats the final checks on Node 24 and 26. |
| CLI isolation | Help, diagnostics, model listing, verification, search, export, and site preview work without keys or model downloads. Fixtures check nonzero failure statuses, conflicting flags, empty wikis, JSON output, and generated-directory exclusion. |
| Cloud writer | Live OpenAI Responses two-turn tool roundtrip passed. A full synthetic TypeScript repository produced five wiki pages, an OKF bundle, and a site through the real CLI; internal links passed verification. Only synthetic test source was sent. |
| Claude protocol | Mocked Messages requests test thinking/tool continuation and model-specific parameters. A live Anthropic check remains pending because no Anthropic key was configured. |
| Local model | Pinned revision, size and checksum, shared storage, awaited native sequence reclamation, and full-history behavior have regression tests. Real 7B validation is in progress after resolving a disk-space limit. Failed download partials were cleaned up; the model requires 4.36 GiB plus working space. |
| Site | Generated-page and DOM interaction tests cover search, navigation, accessibility behavior, source links, and opt-in chat. The live fixture's six HTML files had no broken local `href`/`src` targets. A real-browser visual review remains pending: no browser was connected and Computer Use was not approved for Chrome. |
| Agent integration | OKF export, provenance retention, managed-file protection, MCP client/server interaction, bounded reads, and portable package roundtrips pass fixture tests. Export does not label unreviewed claims as verified. |
| npm artifact | The 2.0.0 tarball contains compiled code and documentation, with no model weights or credentials. Its extracted CLI reports the expected version and rebuilds the live fixture site. This used the validated dependency installation, not a second fresh native install. |
| Dependencies | The final lockfile uses the public npm registry. `npm audit` reported zero vulnerabilities. |

## Before announcing the release

1. Complete a real native 7B run with sufficient disk and memory, including repeated tool use on a representative small repository.
2. Run the synthetic Anthropic smoke check with an account that has access to the configured model.
3. Review the site in a real browser at desktop and mobile widths, including keyboard navigation and a hosted subpath.
4. Review generated explanations and citations against their source code. Structural verification and model transport tests do not establish factual accuracy.
5. Confirm the merged commit's Node 24/26 CI, then use the documented release process when ready to publish.

See [contributing](../CONTRIBUTING.md), [provider smoke checks](models.md#verification), and the [baseline migration notes](LAUNCH_BASELINE.md).
