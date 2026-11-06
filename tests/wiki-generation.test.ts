import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import matter from 'gray-matter';

const mocked = vi.hoisted(() => ({ chat: vi.fn(), shutdown: vi.fn(), create: vi.fn(), search: vi.fn() }));
vi.mock('../src/llm/index.js', async importOriginal => ({
  ...await importOriginal<any>(),
  createLLMProvider: mocked.create,
}));
vi.mock('../src/rag/index.js', () => ({
  RAGSystem: class {
    async indexRepository() {}
    async loadMetadataOnly() {}
    getDocumentCount() { return 1; }
    async search(...args: unknown[]) { return mocked.search(...args); }
  },
}));

import { ArchitecturalWikiAgent } from '../src/wiki-agent.js';
import { containedPath, wikiPagePath } from '../src/safe-path.js';

describe('wiki generation contracts', () => {
  let root: string;
  let repo: string;
  let wiki: string;
  let agent: ArchitecturalWikiAgent;
  const response = (overrides = {}) => ({ content: '', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 20, outputTokens: 10 }, ...overrides });
  const collect = async (stream: AsyncGenerator<any>) => { const events = []; for await (const e of stream) events.push(e); return events; };
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.search.mockResolvedValue([]);
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'semanticwiki-generation-'));
    repo = path.join(root, 'repo'); wiki = path.join(root, 'wiki');
    fs.mkdirSync(repo); fs.mkdirSync(wiki);
    fs.writeFileSync(path.join(repo, 'index.ts'), 'export const greeting = "hello";');
    agent = new ArchitecturalWikiAgent({ openaiApiKey: 'test-openai-key' });
    mocked.create.mockResolvedValue({ chat: mocked.chat, shutdown: mocked.shutdown, getModelInfo: () => ({ name: 'fake', contextLength: 32000, isLocal: false }) });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); vi.restoreAllMocks(); });
  it.each(['tool_use', 'max_tokens'])('runs a real tool loop after %s, preserves provider state and verifies the output', async stopReason => {
    const state = { provider: 'openai', output: [{ type: 'reasoning', encrypted_content: 'opaque' }] };
    mocked.chat.mockResolvedValueOnce(response({ stopReason, providerState: state, toolCalls: [{ id: 'write-1', name: 'write_wiki_page', arguments: { pagePath: 'README.md', title: 'Example', content: 'Source: `index.ts:1`', sources: ['index.ts:1'] } }] })).mockResolvedValueOnce(response({ content: 'Done.' }));
    const events = await collect(agent.generateWikiDirectApi({ repoUrl: repo, outputDir: wiki, provider: 'openai', maxTurns: 3 }));
    expect(fs.readFileSync(path.join(wiki, 'README.md'), 'utf8')).toContain('Source: `index.ts:1`');
    expect(mocked.create).toHaveBeenCalledWith(expect.objectContaining({ provider: 'openai', apiKey: 'test-openai-key' }));
    expect(mocked.chat.mock.calls[1][0][1].providerState).toEqual(state);
    expect(mocked.chat.mock.calls[1][0][2].content).toEqual([expect.objectContaining({ type: 'tool_result', tool_use_id: 'write-1' })]);
    expect(events.at(-1).type).toBe('complete');
    expect(mocked.shutdown).toHaveBeenCalledOnce();
  });
  it.each([false, true])('continues token-limited replies with a user turn while preserving assistant state (repair: %s)', async repair => {
    const assistantContent = [
      { type: 'thinking', thinking: '', signature: 'opaque-signature' },
      { type: 'text', text: 'Still preparing the page' },
    ];
    const providerState = { provider: 'openai', output: [{ type: 'reasoning', encrypted_content: 'opaque' }] };
    const truncated = response({ stopReason: 'max_tokens', assistantContent, providerState });
    const writePage = (pagePath: string, content: string) => response({ stopReason: 'tool_use', toolCalls: [{ id: pagePath, name: 'write_wiki_page', arguments: { pagePath, title: pagePath, content, sources: ['index.ts:1'] } }] });
    const replies = repair
      ? [writePage('README.md', '[Details](details.md)'), response(), truncated, writePage('details.md', 'Source: `index.ts:1`'), response()]
      : [truncated, writePage('README.md', 'Source: `index.ts:1`'), response()];
    const requests: any[][] = [];
    mocked.chat.mockImplementation(async messages => {
      requests.push(structuredClone(messages));
      if (messages.at(-1)?.role !== 'user') throw new Error('This model does not support assistant message prefill.');
      return replies.shift()!;
    });
    const events = await collect(agent.generateWikiDirectApi({ repoUrl: repo, outputDir: wiki, provider: 'anthropic', maxTurns: repair ? 5 : 3 }));
    const continued = requests[repair ? 3 : 1];
    expect(continued.at(-2)).toEqual({ role: 'assistant', content: assistantContent, providerState });
    expect(continued.at(-1)).toMatchObject({ role: 'user', content: expect.stringContaining('Continue from where you left off') });
    expect(mocked.chat).toHaveBeenCalledTimes(repair ? 5 : 3);
    expect(events.at(-1).type).toBe('complete');
    expect(mocked.shutdown).toHaveBeenCalledOnce();
  });
  it('does not report success when the provider cannot initialize', async () => {
    mocked.create.mockRejectedValue(new Error('invalid model'));
    await expect(collect(agent.generateWikiDirectApi({ repoUrl: repo, outputDir: wiki }))).rejects.toThrow('invalid model');
  });
  it('fails at a turn limit and releases the provider', async () => {
    mocked.chat.mockResolvedValue(response({ stopReason: 'max_tokens' }));
    await expect(collect(agent.generateWikiDirectApi({ repoUrl: repo, outputDir: wiki, maxTurns: 1 }))).rejects.toThrow('maximum turns');
    expect(mocked.shutdown).toHaveBeenCalledOnce();
  });
  it('releases resources if a caller cancels iteration', async () => {
    const iterator = agent.generateWikiDirectApi({ repoUrl: repo, outputDir: wiki });
    while (true) { const event = await iterator.next(); if (event.done || event.value.message?.startsWith('Turn ')) break; }
    await iterator.return(undefined);
    expect(mocked.shutdown).toHaveBeenCalledOnce();
  });
  it('fails empty output instead of certifying an empty directory', async () => {
    mocked.chat.mockResolvedValue(response());
    await expect(collect(agent.generateWikiDirectApi({ repoUrl: repo, outputDir: wiki, maxTurns: 2 }))).rejects.toThrow('incomplete');
    expect((await agent.verifyWikiCompleteness(wiki)).isComplete).toBe(false);
    expect(mocked.shutdown).toHaveBeenCalledOnce();
  });
  it('excludes agent exports and site copies from verification', async () => {
    fs.writeFileSync(path.join(wiki, 'README.md'), '# Wiki');
    for (const name of ['knowledge', 'site']) { fs.mkdirSync(path.join(wiki, name)); fs.writeFileSync(path.join(wiki, name, 'copy.md'), '[missing](missing.md)'); }
    expect(await agent.verifyWikiCompleteness(wiki)).toMatchObject({ totalPages: 1, isComplete: true });
  });
  it('verifies real Markdown links without treating code examples as missing pages', async () => {
    fs.mkdirSync(path.join(wiki, 'nested'));
    fs.writeFileSync(path.join(wiki, 'README.md'), '# Wiki\n\n[Root](/nested/Page%20Name.md#details)\n\n[Reference][page]\n\n[page]: nested/Page%20Name.md\n\n```md\n[Example](not-a-real-page.md)\n[[Also not real]]\n```\n\n`[Inline example](also-not-real.md)`\n');
    fs.writeFileSync(path.join(wiki, 'nested/Page Name.md'), '# Details\n\n[Home](../README.md)');
    expect(await agent.verifyWikiCompleteness(wiki)).toMatchObject({ totalPages: 2, isComplete: true, brokenLinks: [] });
    fs.appendFileSync(path.join(wiki, 'nested/Page Name.md'), '\n\n[Missing][ref]\n\n[ref]: ../missing.md\n\n[[Other missing]]');
    const result = await agent.verifyWikiCompleteness(wiki);
    expect(result.isComplete).toBe(false);
    expect(result.missingPages.sort()).toEqual(['missing.md', 'nested/Other missing.md']);
    expect(result.brokenLinks.find(link => link.target === '../missing.md')?.resolvedTarget).toBe('missing.md');
  });
  it('restores persisted repository identity in a fresh verifier without hiding real missing wiki pages', async () => {
    fs.writeFileSync(path.join(repo, 'README.md'), '# Source repository');
    fs.writeFileSync(path.join(wiki, 'README.md'), `# Wiki\n\n[Source](${repo}/README.md#L1)\n\n[Code](${repo}/index.ts#L1)\n\n[Missing](/missing.md)`);
    fs.writeFileSync(path.join(wiki, '.semanticwiki-run.json'), JSON.stringify({ formatVersion: 1, status: 'complete', sourcePath: repo, output: wiki }));
    const fresh = new ArchitecturalWikiAgent({});
    expect(await fresh.verifyWikiCompleteness(wiki)).toMatchObject({ totalPages: 1, missingPages: ['missing.md'] });
    fs.writeFileSync(path.join(wiki, 'missing.md'), '# Missing page now exists');
    expect((await fresh.verifyWikiCompleteness(wiki)).isComplete).toBe(true);
    // Moving an export to another computer should not require the original repository.
    fs.rmSync(repo, { recursive: true });
    expect((await fresh.verifyWikiCompleteness(wiki)).isComplete).toBe(true);
  });
  it('recognizes legacy absolute Markdown source citations from line-qualified labels', async () => {
    fs.writeFileSync(path.join(wiki, 'README.md'), `# Wiki\n\n[Repository purpose, README.md:1–2](${repo}/README.md#L1-L2)\n\n[Missing guide](/missing.md#L1)`);
    expect((await agent.verifyWikiCompleteness(wiki)).missingPages).toEqual(['missing.md']);
  });
  it('verifies moved or unpacked Markdown without run metadata or the original repository', async () => {
    fs.writeFileSync(path.join(wiki, 'README.md'), `# Portable wiki\n\n[Repository README.md:1](${repo}/README.md#L1)\n\n[Wiki root](/README.md)`);
    const movedWiki = path.join(root, 'unpacked-wiki');
    fs.renameSync(wiki, movedWiki);
    fs.rmSync(repo, { recursive: true });
    const fresh = new ArchitecturalWikiAgent({});
    expect(await fresh.verifyWikiCompleteness(movedWiki)).toMatchObject({ totalPages: 1, brokenLinks: [], isComplete: true });
  });
  it('uses the explicit continuation repository instead of stale run metadata', async () => {
    fs.writeFileSync(path.join(wiki, 'README.md'), `# Wiki\n\n[Source](${repo}/README.md#L1)`);
    fs.writeFileSync(path.join(wiki, '.semanticwiki-run.json'), JSON.stringify({ formatVersion: 1, sourcePath: path.join(root, 'old-repo') }));
    expect((await agent.verifyWikiCompleteness(wiki, { repoPath: repo })).isComplete).toBe(true);
  });
  it('does not trust relative or filesystem-root source identities in run metadata', async () => {
    fs.writeFileSync(path.join(wiki, 'README.md'), '# Wiki\n\n[Missing](/missing.md)');
    for (const sourcePath of ['.', '/']) {
      fs.writeFileSync(path.join(wiki, '.semanticwiki-run.json'), JSON.stringify({ formatVersion: 1, sourcePath }));
      expect((await agent.verifyWikiCompleteness(wiki)).missingPages).toEqual(['missing.md']);
    }
  });
  it('allows wiki writes while denying source-file mutations in the Claude Code backend', () => {
    const options = (agent as any).buildAgentOptions({ repoUrl: repo, outputDir: wiki });
    expect(options.allowedTools).toContain('mcp__semanticwiki__write_wiki_page');
    expect(options.allowedTools).not.toContain('mcp__filesystem__write_file');
    expect(options.disallowedTools).toEqual(expect.arrayContaining(['Write', 'Edit', 'Bash', 'mcp__filesystem__write_file', 'mcp__filesystem__move_file']));
  });
  it('contains model-provided paths and blocks symlink escapes', () => {
    expect(() => wikiPagePath(wiki, '../outside.md')).toThrow();
    expect(() => wikiPagePath(wiki, 'knowledge/index.md')).toThrow();
    fs.symlinkSync(repo, path.join(wiki, 'escape'));
    expect(() => wikiPagePath(wiki, 'escape/overwrite.md')).toThrow('Symlink');
    expect(() => containedPath(repo, '../../secret')).toThrow();
    expect(wikiPagePath(wiki, 'architecture/new.md')).toBe(path.join(fs.realpathSync(wiki), 'architecture/new.md'));
  });
  it('contains the local generated index and forwards an explicit Ollama model', async () => {
    const source = path.join(repo, 'index.ts');
    const original = fs.readFileSync(source, 'utf8');
    fs.symlinkSync(source, path.join(wiki, 'index.md'));
    vi.spyOn(agent as any, 'planPagesFromDiscovery').mockResolvedValue([]);
    vi.spyOn(agent as any, 'generateEnhancedIndex').mockReturnValue('# Generated index');
    await expect(collect(agent.generateWikiLocalPageByPage({ repoUrl: repo, outputDir: wiki, fullLocal: true, useOllama: true, model: 'custom-ollama-model' }))).rejects.toThrow('Symlink');
    expect(fs.readFileSync(source, 'utf8')).toBe(original);
    expect(mocked.create).toHaveBeenCalledWith(expect.objectContaining({ useOllama: true, model: 'custom-ollama-model' }));
    expect(mocked.shutdown).toHaveBeenCalledOnce();
  });
  it('retries a truncated local page and replaces a truncated final index with a complete catalog', async () => {
    const truncated = response({ content: '# Truncated draft\n' + 'Unfinished prose '.repeat(30), stopReason: 'max_tokens' });
    const completePage = '# Greeting\n\n' + 'The index.ts module exports a greeting string for callers. '.repeat(8);
    vi.spyOn(agent as any, 'planPagesFromDiscovery').mockResolvedValue([{ title: 'Greeting', filename: 'greeting.md', type: 'module', context: 'Exported greeting', sourceFiles: ['index.ts'] }]);
    mocked.chat.mockResolvedValueOnce(truncated).mockResolvedValueOnce(response({ content: completePage })).mockResolvedValueOnce(truncated);
    const events = await collect(agent.generateWikiLocalPageByPage({ repoUrl: repo, outputDir: wiki, fullLocal: true }));
    expect(mocked.chat).toHaveBeenCalledTimes(3);
    const page = fs.readFileSync(path.join(wiki, 'greeting.md'), 'utf8');
    expect(matter(page).content).toContain(completePage.trimEnd());
    expect(matter(page).data.sources).toEqual([{ resource: 'index.ts' }]);
    expect(page).toContain('## Sources');
    const index = fs.readFileSync(path.join(wiki, 'index.md'), 'utf8');
    expect(index).toContain('[Greeting](./greeting.md)');
    expect(index).not.toContain('Truncated draft');
    expect(events.at(-1).type).toBe('complete');
    expect(mocked.shutdown).toHaveBeenCalledOnce();
  });
  it('fails local generation after two truncated drafts without writing either as a completed page', async () => {
    vi.spyOn(agent as any, 'planPagesFromDiscovery').mockResolvedValue([{ title: 'Greeting', filename: 'greeting.md', type: 'module', context: 'Exported greeting', sourceFiles: ['index.ts'] }]);
    mocked.chat.mockResolvedValue(response({ content: '# Truncated draft\n' + 'Unfinished prose '.repeat(30), stopReason: 'max_tokens' }));
    await expect(collect(agent.generateWikiLocalPageByPage({ repoUrl: repo, outputDir: wiki, fullLocal: true }))).rejects.toThrow('Local generation incomplete: 1 failed pages');
    // Two bounded page attempts and one final index attempt, with no unbounded retries.
    expect(mocked.chat).toHaveBeenCalledTimes(3);
    expect(fs.existsSync(path.join(wiki, 'greeting.md'))).toBe(false);
    expect(fs.readFileSync(path.join(wiki, 'index.md'), 'utf8')).not.toContain('Truncated draft');
    expect(mocked.shutdown).toHaveBeenCalledOnce();
  });
  it('grounds documentation-only prompts and provenance in validated files actually supplied as context', async () => {
    const readme = '# Fixture\n' + 'An in-memory task store with no persistence or network access. '.repeat(12);
    fs.writeFileSync(path.join(repo, 'README.md'), readme);
    fs.writeFileSync(path.join(root, 'outside.ts'), 'SECRET_OUTSIDE_REPOSITORY');
    fs.symlinkSync(path.join(root, 'outside.ts'), path.join(repo, 'escape.ts'));
    mocked.search.mockResolvedValue([
      { filePath: 'README.md', startLine: 1, endLine: 2, content: readme },
      { filePath: '../outside.ts', startLine: 1, endLine: 1, content: 'SECRET_OUTSIDE_REPOSITORY' },
      { filePath: 'escape.ts', startLine: 1, endLine: 1, content: 'SECRET_OUTSIDE_REPOSITORY' },
      { filePath: 'missing.ts', startLine: 1, endLine: 1, content: 'MISSING_FILE_EVIDENCE' },
    ]);
    vi.spyOn(agent as any, 'planPagesFromDiscovery').mockResolvedValue([{ title: 'Documentation', filename: 'documentation.md', type: 'guide', context: 'Readme claims', sourceFiles: ['README.md', '../outside.ts', 'escape.ts'] }]);
    mocked.chat.mockResolvedValueOnce(response({ content: '---\nsources: [invented.ts]\n---\n# Documentation\n\n' + 'The README describes an in-memory task store without persistence or network access. '.repeat(4) })).mockResolvedValueOnce(response({ content: '# Index\n\n[Documentation](./documentation.md)' }));
    const events = await collect(agent.generateWikiLocalPageByPage({ repoUrl: repo, outputDir: wiki, fullLocal: true }));
    const prompt = mocked.chat.mock.calls[0][0][0].content;
    expect(prompt).toContain(`<START_OF_CONTEXT>\n`);
    expect(prompt).toContain('<END_OF_CONTEXT>\n\n<query>');
    expect(prompt).toContain('documentation only, not implementation code');
    expect(prompt).toContain('missing code in this page context does not mean the repository contains only documentation');
    expect(prompt).toContain('Do not invent illustrative implementations, APIs, method names');
    expect(prompt).toContain(readme);
    expect(prompt).not.toMatch(/React|useAuth|SECRET_OUTSIDE_REPOSITORY|MISSING_FILE_EVIDENCE/);
    const page = fs.readFileSync(path.join(wiki, 'documentation.md'), 'utf8');
    expect(matter(page).data.sources).toEqual([{ resource: 'README.md' }]);
    expect(page).toContain('- `README.md`');
    expect(page).not.toContain('invented.ts');
    expect(page).not.toContain('#L');
    expect(events.at(-1).type).toBe('complete');
  });
  it.each([
    '# Fixture Documentation\n\n## Overview\n- **Architecture Overview**: Understand the design.\n\n## Guides\n- **Getting Started**: A comprehensive guide.',
    '# Fixture Documentation\n\n[Architecture Overview](./architecture.md)\n\n```markdown\n[Getting Started](./getting-started.md)\n```',
  ])('replaces a native-style index without complete navigable page links', async indexDraft => {
    const pages = [
      { title: 'Architecture Overview', filename: 'architecture.md', type: 'overview', context: 'Architecture', sourceFiles: ['index.ts'] },
      { title: 'Getting Started', filename: 'getting-started.md', type: 'guide', context: 'Setup', sourceFiles: ['index.ts'] },
    ];
    vi.spyOn(agent as any, 'planPagesFromDiscovery').mockResolvedValue(pages);
    const content = '# Fixture\n\n' + 'The supplied source exports the greeting string. '.repeat(6);
    mocked.chat.mockResolvedValueOnce(response({ content })).mockResolvedValueOnce(response({ content })).mockResolvedValueOnce(response({ content: indexDraft }));
    const events = await collect(agent.generateWikiLocalPageByPage({ repoUrl: repo, outputDir: wiki, fullLocal: true }));
    const index = fs.readFileSync(path.join(wiki, 'index.md'), 'utf8');
    expect(index).toContain('[Architecture Overview](./architecture.md)');
    expect(index).toContain('[Getting Started](./getting-started.md)');
    expect(index).not.toContain('```');
    expect(index).not.toBe(indexDraft);
    expect(events.at(-1).type).toBe('complete');
  });
});
