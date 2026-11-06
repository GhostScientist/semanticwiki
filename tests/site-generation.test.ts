import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Script, runInNewContext } from 'node:vm';
import { load } from 'cheerio';
import { SiteGenerator } from '../src/site-generator.js';
import { getClientScripts } from '../src/site/scripts.js';

let root: string;
let wiki: string;
let output: string;
const write = (name: string, contents: string) => {
  const target = path.join(wiki, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
};
const generate = (options: Partial<ConstructorParameters<typeof SiteGenerator>[0]> = {}) =>
  new SiteGenerator({ wikiDir: wiki, outputDir: output, ...options }).generate();
const read = (name: string) => fs.readFileSync(path.join(output, name), 'utf8');

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'semanticwiki-site-'));
  wiki = path.join(root, 'wiki');
  output = path.join(wiki, 'site');
  fs.mkdirSync(wiki);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('portable generated documentation', () => {
  it('works from any site root with nested pages, existing directory indexes, and Markdown downloads', async () => {
    write('README.md', '# Example\n\n[Architecture](architecture/overview.md#data-flow)\n');
    write('architecture/overview.md', '# Architecture\n\n## Data flow\n\n[Home](../README.md)\n\n## Storage\n\n[Module](modules/parser.md)');
    write('architecture/modules/parser.md', '# Parser\n\n## Input\n\nA parser.\n\n## Output\n\nAn AST.');
    await generate({ title: 'Example' });
    const $ = load(read('architecture/overview.html'));
    expect($('link[rel="stylesheet"]').first().attr('href')).toBe('../assets/styles.css');
    expect($('.page-content a').filter((_, element) => $(element).text() === 'Home').attr('href')).toBe('../README.html');
    expect($('.page-content a').filter((_, element) => $(element).text() === 'Module').attr('href')).toBe('../architecture/modules/parser.html');
    expect($('.breadcrumbs a').length).toBe(1); // No broken link to an invented architecture/index.html.
    expect($('a[aria-current="page"]').text().trim()).toBe('Architecture');
    expect($('a[download]').attr('href')).toBe('../source/architecture/overview.md');
    expect(read('source/architecture/overview.md')).toBe(fs.readFileSync(path.join(wiki, 'architecture/overview.md'), 'utf8'));
    expect(JSON.parse($('.page-markdown').text())).toContain('# Architecture');
    expect(load(read('index.html'))('h1').text()).toBe('Example');
    expect($('.page-pagination-link.next').text()).toContain('Parser');
    expect(read('architecture/overview.html')).not.toContain('/site/assets');
  });

  it('preserves an authored index.md as the homepage', async () => {
    write('README.md', '# Read me');
    write('index.md', '# Custom home\n\nWelcome.');
    await generate();
    expect(load(read('index.html'))('h1').text()).toBe('Custom home');
    expect(read('index.html')).not.toContain('http-equiv="refresh"');
  });

  it('embeds the complete search catalog for file:// and keeps model downloads opt-in', async () => {
    write('README.md', '# Documentation\n\n' + 'Long introduction. '.repeat(400) + '\n\nNeedleBeyondFiveThousand');
    await generate();
    const context: { window: Record<string, any> } = { window: {} };
    runInNewContext(read('assets/manifest.js'), context);
    expect(context.window.WIKI_MANIFEST.searchIndex[0].content).toContain('NeedleBeyondFiveThousand');
    expect(read('README.html')).toContain('assets/manifest.js');
    expect(read('README.html')).not.toContain('class="chat-panel"');
    expect(fs.existsSync(path.join(output, 'embeddings-index.json'))).toBe(false);
  });

  it('makes unique anchors from rendered headings and ignores headings inside code fences', async () => {
    write('README.md', '# Home\n\n## Using `tokens`\n\n## Using tokens\n\n```md\n## Not a heading\n```\n\n## Café & tea');
    await generate();
    const $ = load(read('README.html'));
    expect($('.heading-anchor').map((_, element) => $(element).attr('id')).get()).toEqual(['using-tokens', 'using-tokens-1', 'caf-tea']);
    expect($('.toc-list a').map((_, element) => $(element).attr('href')).get()).toEqual(['#using-tokens', '#using-tokens-1', '#caf-tea']);
    expect($('.toc-list').text()).not.toContain('Not a heading');
  });

  it('isolates Markdown renderers between instances and resets repeated generation', async () => {
    write('README.md', '# Home\n\n## First\n\n[Guide](guide.md)');
    write('guide.md', '# Guide');
    const generator = new SiteGenerator({ wikiDir: wiki, outputDir: output });
    new SiteGenerator({ wikiDir: wiki, outputDir: path.join(root, 'other') });
    await generator.generate();
    await generator.generate();
    expect(JSON.parse(read('manifest.json')).pages).toHaveLength(2);
    expect(load(read('README.html'))('.heading-anchor').attr('id')).toBe('first');
  });

  it('copies images and agent exports without indexing them as reader pages or following symlinks', async () => {
    write('README.md', '# Home\n\n![Diagram](images/diagram.svg)');
    write('images/diagram.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    write('knowledge/index.md', '# Agent navigation');
    write('knowledge/concepts/home.concept.md', '# Machine-readable home');
    write('knowledge/manifest.json', '{"version":"1"}');
    write('knowledge/.semanticwiki-knowledge.json', '{}');
    write('llms.txt', '# Example\n\n- [Knowledge](knowledge/index.md)');
    write('site/source/stale.md', '# Old exported Markdown');
    fs.symlinkSync(path.join(root, 'outside'), path.join(wiki, 'external.md'));
    await generate();
    expect(JSON.parse(read('manifest.json')).pages).toHaveLength(1);
    expect(read('images/diagram.svg')).toContain('<svg');
    expect(read('knowledge/index.md')).toBe('# Agent navigation');
    expect(read('llms.txt')).toContain('knowledge/index.md');
    expect(load(read('README.html'))('.agent-entry').attr('href')).toBe('./llms.txt');
    expect(fs.existsSync(path.join(output, 'knowledge/.semanticwiki-knowledge.json'))).toBe(false);
  });

  it('recognizes absolute code and repository README citations before rewriting wiki links', async () => {
    const repository = path.join(root, 'repository');
    fs.mkdirSync(path.join(repository, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repository, 'src/index.ts'), 'export const value = 1;');
    fs.writeFileSync(path.join(repository, 'README.md'), '# Repository');
    write('README.md', `# Home\n\n[Code](${repository}/src/index.ts#L1-L3)\n\n[Repository README](${repository}/README.md#L2)\n\n[Wiki](guide.md)`);
    write('guide.md', '# Guide');
    await generate({ repoPath: repository });
    const $ = load(read('README.html'));
    expect($('.source-link').map((_, element) => $(element).attr('data-source')).get()).toEqual(['src/index.ts:1-3', 'README.md:2']);
    expect($('.source-link').map((_, element) => $(element).attr('href')).get()).toEqual(['#', '#']);
    expect($('.page-content a').filter((_, element) => $(element).text() === 'Wiki').attr('href')).toBe('./guide.html');
    expect($('.page-content a').filter((_, element) => ($(element).attr('href') || '').includes('/repository/')).length).toBe(0);
    expect(fs.existsSync(path.join(output, 'src/index.ts'))).toBe(false);
    expect($('.copy-source-reference').text()).toBe('Copy location');
  });

  it('links local source citations to a known remote without including remote credentials', async () => {
    const repository = path.join(root, 'repository');
    fs.mkdirSync(repository);
    write('README.md', `# Home\n\n[Code](${repository}/src/index.ts#L1-L3)\n\n[Repository README](${repository}/README.md#L2)`);
    await generate({ repoPath: repository, repoUrl: 'https://user:secret@github.com/example/project.git' });
    const $ = load(read('README.html'));
    expect($('.external-link').map((_, element) => $(element).attr('href')).get()).toEqual([
      'https://github.com/example/project/blob/HEAD/src/index.ts#L1-L3',
      'https://github.com/example/project/blob/HEAD/README.md#L2'
    ]);
    expect(read('README.html')).not.toContain('user:secret');
  });

  it('fails with an actionable error for an empty wiki and rejects outputs that would overwrite source', async () => {
    await expect(generate()).rejects.toThrow('No Markdown pages found');
    expect(() => new SiteGenerator({ wikiDir: wiki, outputDir: wiki })).toThrow('separate directory');
    expect(() => new SiteGenerator({ wikiDir: wiki, outputDir: root })).toThrow('separate directory');
  });
});

describe('reader-safe content', () => {
  it('keeps generated and raw HTML inert and serializes paths and Markdown safely', async () => {
    write("O'Brien.md", `---\ntitle: '<img src=x onerror=alert(1)>'\n---\n# Home\n\n## One\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert)\n\n![unsafe](data:text/html,test)\n\n[quote](https://example.com '" onmouseover="alert(1)')\n\n\`\`\`mermaid\ngraph LR\nA[</div><script>alert(1)</script>] --> B[End]\n\`\`\``);
    await generate();
    const $ = load(read("O'Brien.html"));
    expect($('img[onerror], [onmouseover], a[href^="javascript:"], img[src^="data:"]').length).toBe(0);
    expect($('script').filter((_, element) => !$(element).attr('src') && $(element).attr('type') !== 'application/json').length).toBe(0);
    expect(JSON.parse($('#wiki-config').text()).currentPath).toBe("O'Brien.html");
    expect(JSON.parse($('.page-markdown').text())).toContain('<script>alert(1)</script>');
  });

  it.each([{}, { search: true }, { aiChat: true }, { search: true, aiChat: true, keyboardNav: true, guidedTour: true, codeExplorer: true, progressTracking: true }])('emits parseable browser JavaScript for %j', features => {
    expect(() => new Script(getClientScripts(features))).not.toThrow();
  });
});
