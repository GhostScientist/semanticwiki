# Generated documentation sites

Generate a wiki and its site together with `semanticwiki generate -r ./project --site`, or rebuild an existing wiki with `semanticwiki generate --site-only -o ./wiki`. Open `wiki/site/index.html` directly or use `semanticwiki preview -o ./wiki` to serve it locally. The output can also be hosted under any static hosting subpath.

## Reading and navigation

The reader includes full-text search (Cmd/Ctrl K or `/`), keyboard navigation, light and dark themes, a heading outline, previous/next links, mobile navigation, and reduced-motion support. Search indexes the complete page content and travels with the site, so reading, search, and navigation work from disk. Mermaid rendering and enhanced syntax highlighting load optional CDN assets; plain code and diagram definitions remain readable when these assets are unavailable.

Every page offers **Copy page** and a **Markdown** download. The **For agents** link opens `llms.txt`, which leads to the generated knowledge bundle. Agent exports are copied without being duplicated in the reader's navigation.

Source citations link to the repository when a remote is known. Local citations open a source location panel with a **Copy location** action. The site does not bundle repository source files. Raw HTML in documentation is displayed as text, and executable link schemes are omitted.

## Optional browser chat

Pass `--ai-chat` to add the browser assistant. Its initial model and embedding downloads require a connection. Model inference then runs in the reader's browser; this is separate from the cloud or local provider used to generate the wiki. Chat is disabled by default, and ordinary site generation does not download chat models.

## Verification

`tests/site-generation.test.ts` verifies generated files, headings, links, assets, exports, and safe rendering. `tests/site-browser.test.ts` executes the emitted application in a DOM simulation to cover search, keyboard focus, navigation/history, Markdown copying, source citations, file URLs, and unavailable browser storage. These checks complement a visual review at desktop and mobile sizes; they do not simulate browser layout or model inference.
