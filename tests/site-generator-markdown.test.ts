import { describe, it, expect, beforeAll } from 'vitest';
import { marked } from 'marked';
import { SiteGenerator } from '../src/site-generator.js';

/**
 * The custom marked renderers use marked's object-argument API (v13+). These tests
 * pin the rendered HTML so a future marked upgrade cannot silently break the
 * generated site the way the v12 -> v18 signature change did.
 */
describe('SiteGenerator markdown renderers', () => {
  const render = (md: string) => marked.parse(md) as string;

  beforeAll(() => {
    const generator = new SiteGenerator({
      wikiDir: '/tmp/semanticwiki-test-wiki',
      outputDir: '/tmp/semanticwiki-test-site'
    });
    (generator as unknown as { configureMarked(): void }).configureMarked();
  });

  it('renders code blocks with a language label and copy button', () => {
    const html = render('```ts\nconst x = 1;\n```');

    expect(html).toContain('class="code-block"');
    expect(html).toContain('data-language="ts"');
    expect(html).toContain('class="code-language">ts<');
    expect(html).toContain('class="code-copy"');
    expect(html).toContain('<code class="language-ts">const x = 1;');
  });

  it('escapes HTML inside code blocks', () => {
    const html = render('```js\nconst tag = "<script>";\n```');

    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('falls back to a "text" language when the fence is untagged', () => {
    expect(render('```\nplain\n```')).toContain('data-language="text"');
  });

  it('extracts a source reference from a code block comment', () => {
    const html = render('```ts\n// Source: src/cli.ts:42\nconst x = 1;\n```');

    expect(html).toContain('class="code-source"');
    expect(html).toContain('data-source="src/cli.ts:42"');
  });

  it('renders headings with slugged anchor links at the right depth', () => {
    const html = render('## Getting Started Guide');

    expect(html).toContain('<h2 id="getting-started-guide"');
    expect(html).toContain('class="heading-anchor"');
    expect(html).toContain('href="#getting-started-guide"');
    expect(html).toContain('Getting Started Guide');
  });

  it('rewrites internal .md links to .html and preserves anchors', () => {
    expect(render('[Architecture](./architecture.md)')).toContain('href="./architecture.html"');
    expect(render('[Section](./architecture.md#overview)')).toContain(
      'href="./architecture.html#overview"'
    );
  });

  it('marks external links as external and opens them safely', () => {
    const html = render('[Anthropic](https://anthropic.com)');

    expect(html).toContain('class="external-link"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('renders file:line references as source links', () => {
    const html = render('[the agent](src/wiki-agent.ts:100)');

    expect(html).toContain('class="source-link"');
    expect(html).toContain('data-source="src/wiki-agent.ts:100"');
  });

  it('renders images inside a figure, using the title as a caption', () => {
    const html = render('![Diagram](./diagram.png "System overview")');

    expect(html).toContain('class="image-figure"');
    expect(html).toContain('src="./diagram.png"');
    expect(html).toContain('alt="Diagram"');
    expect(html).toContain('<figcaption>System overview</figcaption>');
  });

  it('omits the caption when an image has no title', () => {
    const html = render('![Diagram](./diagram.png)');

    expect(html).toContain('class="image-figure"');
    expect(html).not.toContain('<figcaption>');
  });

  it('renders a plain blockquote', () => {
    const html = render('> just a quote');

    expect(html).toContain('<blockquote>');
    expect(html).toContain('just a quote');
  });

  it.each([
    ['NOTE', 'note'],
    ['TIP', 'tip'],
    ['IMPORTANT', 'important'],
    ['WARNING', 'warning'],
    ['CAUTION', 'caution']
  ])('renders a [!%s] blockquote as a callout', (label, type) => {
    const html = render(`> [!${label}]\n> Mind this.`);

    expect(html).toContain(`class="callout callout-${type}"`);
    expect(html).toContain(`<div class="callout-title">${label}</div>`);
    expect(html).toContain('Mind this.');
    expect(html).not.toContain(`[!${label}]`);
    expect(html).not.toContain('<blockquote>');
  });

  it('accepts a lowercase callout marker and normalizes the label', () => {
    const html = render('> [!note]\n> Mind this.');

    expect(html).toContain('class="callout callout-note"');
    expect(html).toContain('<div class="callout-title">NOTE</div>');
  });

  it('renders inline markdown inside a callout body', () => {
    const html = render('> [!TIP]\n> Read the [guide](./guide.md) first.');

    // Links inside callouts must still go through the link renderer.
    expect(html).toContain('href="./guide.html"');
    expect(html).toContain('class="internal-link"');
  });

  it('does not treat an unknown marker as a callout', () => {
    const html = render('> [!SOMETHING]\n> Mind this.');

    expect(html).toContain('<blockquote>');
    expect(html).not.toContain('class="callout');
  });
});
