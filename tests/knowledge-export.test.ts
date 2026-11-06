import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import matter from 'gray-matter';
import { marked } from 'marked';
import { execFileSync } from 'node:child_process';
import { exportKnowledgeBundle } from '../src/knowledge-export.js';
import { loadWikiCatalog, trustTier } from '../src/wiki-catalog.js';
import { createPackage, extractPackage, listPackageFiles } from '../src/package-format.js';

describe('OKF knowledge export', () => {
  let root: string;
  let wikiDir: string;
  const write = (name: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(wikiDir, name)), { recursive: true });
    fs.writeFileSync(path.join(wikiDir, name), content);
  };
  const read = (name: string) => fs.readFileSync(path.join(wikiDir, name), 'utf8');

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'semanticwiki-okf-'));
    wikiDir = path.join(root, 'wiki');
    write('README.md', '# Project\n\nRead [architecture](architecture/index.md#design) and [log](log.md).\n');
    write('architecture/index.md', '---\ntitle: Architecture\ndescription: How the modules fit together.\ncategory: Architecture\ncustom: retained\n---\n\n# Architecture\n\n## Design\n\nSee [home](/README.md), [missing](future.md), and [a reference][home].\n\n[home]: ../README.md\n\n```md\n[example](../README.md)\n```\n');
    write('log.md', '# An existing human wiki page\n\nThis is a concept, not an OKF history file.\n');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('produces conformant concepts and reserved indexes without altering human pages', async () => {
    const original = read('architecture/index.md');
    const result = await exportKnowledgeBundle({ wikiDir });
    expect(result.pageCount).toBe(3);
    expect(read('architecture/index.md')).toBe(original);
    expect(matter(read('knowledge/index.md')).data).toEqual({ okf_version: '0.2' });
    expect(matter(read('knowledge/concepts/index.md')).data).toEqual({});
    expect(matter(read('knowledge/concepts/architecture/index.md')).data).toEqual({});
    const concept = matter(read('knowledge/concepts/architecture/index.concept.md'));
    expect(concept.data).toMatchObject({ type: 'Code Documentation', title: 'Architecture', custom: 'retained' });
    expect(concept.data.verified).toBeUndefined();
    expect(concept.data.generated).toBeUndefined();
    expect(matter(read('knowledge/concepts/log.concept.md')).data.type).toBe('Code Documentation');
    expect(read('knowledge/concepts/architecture/index.md')).toContain('How the modules fit together.');
    const manifest = JSON.parse(read('knowledge/manifest.json'));
    expect(manifest.pages).toHaveLength(3);
    expect(manifest.pages.every((page: any) => page.trust === 'unverified')).toBe(true);
    expect(manifest.pages[0].contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(read('llms.txt')).toContain('knowledge/index.md');
    expect(loadWikiCatalog(wikiDir)).toHaveLength(3);
  });

  it('rewrites real concept links and reference links while preserving examples and incomplete links', async () => {
    await exportKnowledgeBundle({ wikiDir });
    const body = matter(read('knowledge/concepts/architecture/index.concept.md')).content;
    const hrefs: string[] = [];
    marked.walkTokens(marked.lexer(body), token => { if (token.type === 'link') hrefs.push(token.href); });
    expect(hrefs).toEqual(['../README.concept.md', 'future.md', '../README.concept.md']);
    expect(body).toContain('```md\n[example](../README.md)\n```');
    expect(read('knowledge/concepts/README.concept.md')).toContain('architecture/index.concept.md#design');
  });

  it('keeps source provenance and explicit verification instead of declaring exports verified', async () => {
    write('source.md', '---\ntype: API Endpoint\ntitle: API\nsources:\n  - resource: https://example.com/spec\n    id: spec\ngenerated:\n  by: semanticwiki/model\n  at: 2026-06-20T22:53:05Z\nverified:\n  by: human:reviewer\n  at: 2026-06-25T09:00:00Z\n---\n\n# API\n');
    await exportKnowledgeBundle({ wikiDir });
    const page = matter(read('knowledge/concepts/source.concept.md'));
    expect(page.data.type).toBe('API Endpoint');
    expect(page.data.sources).toEqual([{ resource: 'https://example.com/spec', id: 'spec' }]);
    expect(page.data.generated.by).toBe('semanticwiki/model');
    expect(trustTier(page.data)).toBe('human-reviewed');
    expect(trustTier({ verified: [{ by: 'process:check', at: '2026-06-25T09:00:00Z' }] })).toBe('machine-confirmed');
    expect(trustTier({ verified: [] })).toBe('unverified');
  });

  it('copies local diagram assets and maps source links to the supplied repository revision', async () => {
    write('diagram.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    write('code.md', '# Code\n\n![Diagram](diagram.svg)\n\n[Source](../src/api.ts#L4-L9)\n');
    await exportKnowledgeBundle({ wikiDir, repoPath: root, sourceRepo: 'https://github.com/example/project.git', sourceCommit: 'abc123' });
    expect(read('knowledge/assets/diagram.svg')).toContain('<svg');
    expect(read('knowledge/concepts/code.concept.md')).toContain('../assets/diagram.svg');
    expect(read('knowledge/concepts/code.concept.md')).toContain('https://github.com/example/project/blob/abc123/src/api.ts#L4-L9');
  });

  it('derives source revision and a credential-free repository URL from local Git', async () => {
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=SemanticWiki Test', '-c', 'user.email=test@example.invalid', ...args], { cwd: root, encoding: 'utf8' });
    git('init', '-q');
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src/api.ts'), 'export const api = true;');
    git('add', 'src/api.ts');
    git('commit', '-qm', 'Source fixture');
    git('remote', 'add', 'origin', 'https://example-user:example-secret@github.com/example/project.git');
    write('code.md', '---\nsources: ["src/api.ts:1-3"]\ngenerated: 2026-06-25T09:00:00Z\n---\n\n# Code\n');
    await exportKnowledgeBundle({ wikiDir, repoPath: root });
    const manifest = JSON.parse(read('knowledge/manifest.json'));
    expect(manifest.sourceRepository).toBe('https://github.com/example/project');
    expect(manifest.sourceCommit).toBe(git('rev-parse', 'HEAD').trim());
    expect(JSON.stringify(manifest)).not.toContain('example-secret');
    const source = matter(read('knowledge/concepts/code.concept.md'));
    expect(source.data.sources[0].resource).toBe(`https://github.com/example/project/blob/${manifest.sourceCommit}/src/api.ts#L1-L3`);
    expect(source.data.generated).toBeUndefined();
    expect(source.data.semanticwiki.legacy_generated).toBeDefined();
  });

  it('publishes absolute source citations as repository links while retaining wiki-root navigation', async () => {
    const source = path.join(root, 'src/api.ts');
    write('code.md', matter.stringify(`# Code\n\n[Absolute source](${source}#L2-L4)\n\n[Source readme](${path.join(root, 'README.md')}#L1)\n\n[Wiki home](/README.md)\n`, { sources: [`${source}:2-4`] }));
    await exportKnowledgeBundle({ wikiDir, repoPath: root, sourceRepo: 'https://github.com/example/project', sourceCommit: 'abc123' });
    const page = matter(read('knowledge/concepts/code.concept.md'));
    expect(page.data.sources[0].resource).toBe('https://github.com/example/project/blob/abc123/src/api.ts#L2-L4');
    expect(page.content).toContain('https://github.com/example/project/blob/abc123/src/api.ts#L2-L4');
    expect(page.content).toContain('https://github.com/example/project/blob/abc123/README.md#L1');
    expect(page.content).toContain('[Wiki home](<README.concept.md>)');
    expect(page.content).not.toContain(root);
  });

  it('refreshes managed pages, removes stale concepts, and preserves unrelated files and custom discovery', async () => {
    await exportKnowledgeBundle({ wikiDir });
    const first = read('knowledge/concepts/README.concept.md');
    write('knowledge/user-note.txt', 'Keep this.');
    write('llms.txt', '# A hand-maintained discovery file');
    fs.unlinkSync(path.join(wikiDir, 'log.md'));
    const result = await exportKnowledgeBundle({ wikiDir });
    expect(result.pageCount).toBe(2);
    expect(result.discoveryWritten).toBe(false);
    expect(read('knowledge/concepts/README.concept.md')).toBe(first.replace('<log.concept.md>', 'log.md'));
    expect(fs.existsSync(path.join(wikiDir, 'knowledge/concepts/log.concept.md'))).toBe(false);
    expect(read('knowledge/user-note.txt')).toBe('Keep this.');
    expect(read('llms.txt')).toBe('# A hand-maintained discovery file');
  });

  it('preserves source identity during an export without repository options', async () => {
    await exportKnowledgeBundle({ wikiDir, sourceRepo: 'https://github.com/example/project.git', sourceCommit: 'abc123' });
    write('added.md', '# A newly added concept');
    await exportKnowledgeBundle({ wikiDir });
    expect(JSON.parse(read('knowledge/manifest.json'))).toMatchObject({ sourceRepository: 'https://github.com/example/project', sourceCommit: 'abc123', pageCount: 4 });
    // An explicit new source must not inherit the previous repository's revision.
    await exportKnowledgeBundle({ wikiDir, sourceRepo: 'https://github.com/example/other' });
    const changed = JSON.parse(read('knowledge/manifest.json'));
    expect(changed.sourceRepository).toBe('https://github.com/example/other');
    expect(changed.sourceCommit).toBeUndefined();
  });

  it('validates and strips credentials from retained catalog identity', async () => {
    await exportKnowledgeBundle({ wikiDir });
    const previous = JSON.parse(read('knowledge/manifest.json'));
    write('knowledge/manifest.json', JSON.stringify({ ...previous, sourceRepository: 'https://user:secret@example.com/repo.git?token=secret', sourceCommit: 'a'.repeat(40) }));
    await exportKnowledgeBundle({ wikiDir });
    expect(JSON.parse(read('knowledge/manifest.json')).sourceRepository).toBe('https://example.com/repo');
    expect(read('knowledge/manifest.json')).not.toContain('secret');
    write('knowledge/manifest.json', JSON.stringify({ ...previous, sourceRepository: 'file:///private/repository', sourceCommit: 'not a commit' }));
    await exportKnowledgeBundle({ wikiDir });
    const rebuilt = JSON.parse(read('knowledge/manifest.json'));
    expect(rebuilt.sourceRepository).toBeUndefined();
    expect(rebuilt.sourceCommit).toBeUndefined();
  });

  it('does not overwrite an unmanaged knowledge directory or follow symlinks', async () => {
    write('knowledge/notes.md', '# User notes');
    await expect(exportKnowledgeBundle({ wikiDir })).rejects.toThrow('not managed');
    expect(read('knowledge/notes.md')).toBe('# User notes');
    fs.rmSync(path.join(wikiDir, 'knowledge'), { recursive: true });
    const privatePath = path.join(root, 'private.md');
    fs.writeFileSync(privatePath, '# Private');
    fs.symlinkSync(privatePath, path.join(wikiDir, 'linked.md'));
    write('.private/secret.md', '# Hidden');
    await exportKnowledgeBundle({ wikiDir });
    expect(JSON.parse(read('knowledge/manifest.json')).pageCount).toBe(3);
    fs.unlinkSync(path.join(wikiDir, 'knowledge/concepts/README.concept.md'));
    fs.symlinkSync(privatePath, path.join(wikiDir, 'knowledge/concepts/README.concept.md'));
    await expect(exportKnowledgeBundle({ wikiDir })).rejects.toThrow('symbolic link');
    expect(fs.readFileSync(privatePath, 'utf8')).toBe('# Private');
  });

  it('rejects dangling generated-file symlinks and preserves a symlink discovery file', async () => {
    const elsewhere = path.join(root, 'outside.txt');
    fs.symlinkSync(elsewhere, path.join(wikiDir, 'llms.txt'));
    const result = await exportKnowledgeBundle({ wikiDir });
    expect(result.discoveryWritten).toBe(false);
    expect(fs.existsSync(elsewhere)).toBe(false);
    fs.unlinkSync(path.join(wikiDir, 'knowledge/concepts/README.concept.md'));
    fs.symlinkSync(elsewhere, path.join(wikiDir, 'knowledge/concepts/README.concept.md'));
    await expect(exportKnowledgeBundle({ wikiDir })).rejects.toThrow('symbolic link');
    expect(fs.existsSync(elsewhere)).toBe(false);
  });

  it('round-trips the knowledge bundle, discovery, and portable code index in a package', async () => {
    await exportKnowledgeBundle({ wikiDir });
    write('.semanticwiki-cache/metadata.json', JSON.stringify({ chunks: [] }));
    write('.semanticwiki-cache/index-state.json', JSON.stringify({ commitHash: 'abc123', chunkCount: 0, embeddingModel: 'local-test' }));
    const packagePath = await createPackage({ wikiPath: wikiDir, outputPath: path.join(root, 'release.archiwiki') });
    expect(listPackageFiles(packagePath)).toEqual(expect.arrayContaining(['wiki/llms.txt', 'wiki/knowledge/manifest.json', 'wiki/knowledge/.semanticwiki-knowledge.json', 'rag/metadata.json']));
    const output = path.join(root, 'unpacked');
    const manifest = await extractPackage({ packagePath, outputPath: output });
    expect(manifest.wikiStats.pageCount).toBe(3);
    expect(fs.readFileSync(path.join(output, 'wiki/llms.txt'), 'utf8')).toBe(read('llms.txt'));
    expect(fs.existsSync(path.join(output, 'wiki/.semanticwiki-cache/metadata.json'))).toBe(true);
    expect(fs.existsSync(path.join(output, '.semanticwiki-cache'))).toBe(false);
    await expect(exportKnowledgeBundle({ wikiDir: path.join(output, 'wiki') })).resolves.toMatchObject({ pageCount: 3 });
  });
});
