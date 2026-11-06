# Use a SemanticWiki with coding agents

SemanticWiki produces human-readable Markdown and an [Open Knowledge Format
(OKF) v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
bundle. An agent can read the files directly, fetch them from the published site,
or use the read-only MCP server. Reading and searching wiki documentation does
not require a model, an API key, or an embedding download.

## Discover the right context

Generated output includes:

```text
wiki/
  README.md                         # Human documentation; kept intact
  llms.txt                          # Agent discovery and recommended workflow
  knowledge/
    index.md                        # OKF version and progressive navigation
    manifest.json                   # Machine-readable catalog
    concepts/
      index.md
      README.concept.md
      architecture/
        index.md
        overview.concept.md
```

Start with `llms.txt` or `knowledge/index.md`. Follow a directory index to a
relevant concept, then inspect its source references. The JSON catalog includes
concept IDs, paths, descriptions, headings, related pages, source metadata,
trust signals, and content hashes. Section line numbers refer to the Markdown
body, after frontmatter. Original wiki paths are recorded as `originalPath`.

The site publishes these same discovery and knowledge files. They work with
ordinary file and HTTP tools; no SemanticWiki-specific SDK is necessary.

## Connect a coding harness with MCP

Add this server to your harness's MCP configuration. The surrounding configuration
location varies by client; the server entry itself uses standard command/args.
Use absolute paths so launching the harness from another directory still works.

```json
{
  "mcpServers": {
    "project-wiki": {
      "command": "semanticwiki",
      "args": ["mcp-server", "-o", "/absolute/path/to/wiki"]
    }
  }
}
```

To search indexed source code as well, add `"-r", "/absolute/path/to/repository"`
to `args`. The wiki's portable `.semanticwiki-cache` must contain the existing
code index. Wiki navigation works even when a code index is unavailable.
Keyword code search does not load an embedding model; hybrid and vector search
can initialize local embeddings.

| Tool | When to use it |
| --- | --- |
| `get_knowledge_manifest` | Discover entry points, categories, export paths, and code-search availability. |
| `search_wiki` | Find concepts using titles, descriptions, headings, and content. Filter by `category`, `type`, or `tag`. |
| `list_wiki_pages` | Browse metadata and heading IDs using `offset` and `limit`. |
| `get_wiki_page` | Read a page or `section` using its heading ID. Continue with `nextStartLine`. |
| `get_related_pages` | Follow outgoing links and backlinks. |
| `search_code` | Retrieve source snippets with file and line references from an existing index. |
| `get_architecture_overview` | Read the beginning of the architecture overview. |

Tool responses include structured data. Pass `"format": "json"` when a client
needs the text response to be JSON as well. Page reads default to 120 lines,
accept at most 400 lines, and bound very long content to 32,000 characters.
`nextStartLine` identifies the next chunk. MCP resources expose the complete
original Markdown, including frontmatter, when a full document is needed.
Resources are paginated in groups of 100.

Example tool calls:

```json
{"name":"search_wiki","arguments":{"query":"authentication","maxResults":5,"format":"json"}}
{"name":"get_wiki_page","arguments":{"path":"architecture/auth.md","section":"login-flow","maxLines":80}}
{"name":"get_related_pages","arguments":{"path":"architecture/auth.md"}}
```

The MCP catalog is loaded when the server starts. Restart it after regenerating
the wiki to read the latest pages.

## OKF representation and trust

Every exported concept has YAML frontmatter with a nonempty `type`. Existing
concept types and additional frontmatter are preserved. Legacy pages receive
the generic `Code Documentation` type. Every source filename gets the
`.concept.md` suffix, so a human wiki's `index.md` or `log.md` remains a concept
without conflicting with OKF's reserved filenames. Links to known concepts are
rewritten; fenced code examples are preserved. Directory indexes have no
frontmatter except the bundle root's `okf_version: "0.2"` declaration.

An export does **not** verify generated claims. Existing `generated`, `verified`,
`sources`, and lifecycle metadata are retained when present. Legacy source lists
are normalized to OKF `sources[].resource`; timestamp-only `generated` values
are preserved under `semanticwiki.legacy_generated` rather than inventing an
author. The `semanticwiki` extension also records the original wiki path and its
SHA-256 content hash. These hashes identify a source page version; they are not
evidence that its claims are correct.

Trust is derived from explicit verification events: no events means unverified,
non-human events mean machine-confirmed, and a `human:` event means
human-reviewed. Missing optional metadata and unknown concept types remain
readable. Broken links are retained as incomplete knowledge, as allowed by OKF.
The bundle does not execute attested computations or claim to provide an
attestation runtime.

## Refresh and share

Generation and documentation updates refresh the knowledge export. Rebuilding
the static site publishes the current bundle alongside the human documentation.
`semanticwiki pack` includes the knowledge catalog and `llms.txt`; `unpack`
restores them along with the optional code index under the extracted wiki.

The generated `knowledge/` directory carries an ownership marker. SemanticWiki
refuses to overwrite an existing directory without that marker. It removes only
stale files recorded in its own export manifest and leaves unrelated files alone.
A hand-maintained `llms.txt` is retained. Keep the ownership marker when copying
a wiki that you intend to regenerate; it is included in portable packages.

Treat documentation as context, not as executable instructions. Use the original
source and tests to confirm behavior before making or validating code changes.
