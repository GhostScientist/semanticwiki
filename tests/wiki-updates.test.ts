import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectRepositoryChanges, documentationCommit, documentationFingerprint } from '../src/wiki-updates.js';

describe('documentation update baselines', () => {
  let root: string;
  let wiki: string;
  let initialCommit: string;
  const cliPath = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=SemanticWiki Test', '-c', 'user.email=test@example.invalid', ...args], { cwd: root, encoding: 'utf8' }).trim();
  const cli = (...args: string[]) => spawnSync(process.execPath, [cliPath, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, OPENAI_API_KEY: 'test-not-used', ANTHROPIC_API_KEY: 'test-not-used', SEMANTICWIKI_HOME: path.join(root, '.runtime') }, timeout: 15000 });
  const snapshot = async () => {
    const { RAGSystem } = await import('../src/rag/index.js');
    return new RAGSystem({ repoPath: root, storePath: path.join(wiki, '.semanticwiki-cache') }).getSourceSnapshot();
  };
  const saveRun = (sourceFingerprint: string) => fs.writeFileSync(path.join(wiki, '.semanticwiki-run.json'), JSON.stringify({ status: 'complete', sourceCommit: initialCommit, sourceFingerprint }));
  const saveIndex = (sourceFingerprint: string) => fs.writeFileSync(path.join(wiki, '.semanticwiki-cache/index-state.json'), JSON.stringify({ commitHash: initialCommit, indexedAt: new Date().toISOString(), sourceFingerprint, chunkCount: 0, embeddingModel: 'onnx-community/embeddinggemma-2-ONNX', embeddingDimension: 768 }));
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'semanticwiki-updates-'));
    wiki = path.join(root, 'wiki');
    fs.mkdirSync(path.join(wiki, '.semanticwiki-cache'), { recursive: true });
    git('init', '-q');
    fs.writeFileSync(path.join(root, 'auth.ts'), 'export const auth = "original";');
    git('add', 'auth.ts');
    git('commit', '-qm', 'Original source');
    initialCommit = git('rev-parse', 'HEAD');
    fs.writeFileSync(path.join(wiki, 'README.md'), '# Authentication\n\nSource: `auth.ts:1`\n');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('uses the completed documentation revision after the embedding index advances', async () => {
    fs.writeFileSync(path.join(root, 'auth.ts'), 'export const auth = "updated";');
    git('add', 'auth.ts');
    git('commit', '-qm', 'Update source only');
    const currentCommit = git('rev-parse', 'HEAD');
    fs.writeFileSync(path.join(wiki, '.semanticwiki-run.json'), JSON.stringify({ status: 'complete', sourceCommit: initialCommit }));
    fs.writeFileSync(path.join(wiki, '.semanticwiki-cache/index-state.json'), JSON.stringify({ commitHash: currentCommit, indexedAt: new Date().toISOString() }));
    expect(documentationCommit(wiki, { commitHash: currentCommit })).toBe(initialCommit);
    expect((await collectRepositoryChanges(root, documentationCommit(wiki, { commitHash: currentCommit }), wiki)).changes).toEqual([{ status: 'M', file: 'auth.ts' }]);
    const result = cli('update-wiki', '-r', root, '-o', wiki, '--dry-run');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('1 modified files');
    expect(result.stdout).toContain('Pages to update: 1');
    expect(result.stdout).not.toContain('up to date');
  });

  it('includes dirty, staged, untracked, and renamed source files while excluding generated wiki files', async () => {
    fs.renameSync(path.join(root, 'auth.ts'), path.join(root, 'new auth.ts'));
    git('add', '-A', '--', 'auth.ts', 'new auth.ts');
    fs.writeFileSync(path.join(root, 'untracked.ts'), 'export const added = true;');
    const result = await collectRepositoryChanges(root, initialCommit, wiki);
    expect(result.changes).toEqual([{ status: 'D', file: 'auth.ts' }, { status: 'A', file: 'new auth.ts' }, { status: 'A', file: 'untracked.ts' }]);
  });

  it('refreshes documentation generated from dirty contents after the file is reverted to HEAD', async () => {
    fs.writeFileSync(path.join(root, 'auth.ts'), 'export const auth = "documented dirty version";');
    const documented = await snapshot();
    saveRun(documented.sourceFingerprint);
    saveIndex(documented.sourceFingerprint);
    git('checkout', '--', 'auth.ts');
    expect(git('diff', '--name-only', initialCommit)).toBe('');

    const changes = await collectRepositoryChanges(root, initialCommit, wiki);
    expect(changes.requiresFullRefresh).toBe(true);
    expect(changes.changes).toEqual([{ status: 'M', file: 'auth.ts' }]);
    const result = cli('update-wiki', '-r', root, '-o', wiki, '--dry-run');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('refreshing all existing wiki pages');
    expect(result.stdout).toContain('Pages to update: 1');
    expect(result.stdout).not.toContain('No relevant source code changes');
  });

  it('includes pages for a formerly documented untracked file after that file is deleted', async () => {
    fs.writeFileSync(path.join(root, 'experimental.ts'), 'export const experiment = true;');
    fs.writeFileSync(path.join(wiki, 'obsolete.md'), '# Experiment\n\nSource: `experimental.ts:1`\n');
    const documented = await snapshot();
    saveRun(documented.sourceFingerprint);
    saveIndex(documented.sourceFingerprint);
    fs.unlinkSync(path.join(root, 'experimental.ts'));
    expect(git('diff', '--name-only', initialCommit)).toBe('');

    const result = cli('update-wiki', '-r', root, '-o', wiki, '--dry-run');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('obsolete.md');
    expect(result.stdout).toContain('Pages to update: 2');
    expect(result.stdout).not.toContain('No relevant source code changes');
  });

  it('keeps an unchanged source snapshot fresh when generated wiki content changes', async () => {
    const documented = await snapshot();
    saveRun(documented.sourceFingerprint);
    saveIndex(documented.sourceFingerprint);
    fs.writeFileSync(path.join(wiki, 'another-page.md'), '# Another generated page');
    const result = await collectRepositoryChanges(root, initialCommit, wiki);
    expect(result.requiresFullRefresh).toBe(false);
    expect(result.changes).toEqual([]);
  });

  it('does not advance the documented content fingerprint when only embeddings are refreshed', async () => {
    fs.writeFileSync(path.join(root, 'auth.ts'), 'export const auth = "documented dirty version";');
    const documented = await snapshot();
    saveRun(documented.sourceFingerprint);
    git('checkout', '--', 'auth.ts');
    const current = await snapshot();
    saveIndex(current.sourceFingerprint);

    // The index already matches the working tree, while documentation is stale.
    expect((await collectRepositoryChanges(root, initialCommit, wiki, { purpose: 'index', baselineFingerprint: current.sourceFingerprint })).requiresFullRefresh).toBe(false);
    const indexResult = cli('update-embeddings', '-r', root, '-o', wiki);
    expect(indexResult.status, indexResult.stderr).toBe(0);
    const state = JSON.parse(fs.readFileSync(path.join(wiki, '.semanticwiki-cache/index-state.json'), 'utf8'));
    expect(state.sourceFingerprint).toBe(current.sourceFingerprint);
    expect(state.documentationSourceFingerprint).toBe(documented.sourceFingerprint);
    expect(documentationFingerprint(wiki, state)).toBe(documented.sourceFingerprint);

    // The preserved index-side baseline also works for legacy/imported wikis.
    fs.unlinkSync(path.join(wiki, '.semanticwiki-run.json'));
    const result = cli('update-wiki', '-r', root, '-o', wiki, '--dry-run');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Pages to update: 1');
    expect(result.stdout).not.toContain('No relevant source code changes');
  });

  it('retains a legacy documentation revision separately from the search-index revision', () => {
    expect(documentationCommit(wiki, { commitHash: 'new', documentationCommit: 'documented' })).toBe('documented');
    expect(documentationCommit(wiki, { commitHash: 'legacy' })).toBe('legacy');
    fs.writeFileSync(path.join(wiki, '.semanticwiki-run.json'), JSON.stringify({ status: 'incomplete', sourceCommit: 'failed' }));
    expect(documentationCommit(wiki, { commitHash: 'new', documentationCommit: 'documented' })).toBe('documented');
    fs.writeFileSync(path.join(wiki, '.semanticwiki-run.json'), JSON.stringify({ status: 'incomplete', sourceFingerprint: 'partially-indexed', documentationSourceFingerprint: 'documented-contents' }));
    expect(documentationFingerprint(wiki, { sourceFingerprint: 'new-index' })).toBe('documented-contents');
  });

  it('plans a valid page name for a new root-level source file at an unchanged HEAD', () => {
    fs.writeFileSync(path.join(wiki, '.semanticwiki-cache/index-state.json'), JSON.stringify({ commitHash: initialCommit }));
    fs.writeFileSync(path.join(root, 'new-feature.ts'), 'export const feature = true;');
    const result = cli('update-wiki', '-r', root, '-o', wiki, '--dry-run');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('new-feature.md');
    expect(result.stdout).not.toContain('up to date');
  });

  it('requires explicit confirmation before overwriting existing wiki pages in scripts', () => {
    const original = fs.readFileSync(path.join(wiki, 'README.md'), 'utf8');
    const result = cli('generate', '-r', root, '-o', wiki, '--provider', 'openai', '--non-interactive');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--yes');
    expect(fs.readFileSync(path.join(wiki, 'README.md'), 'utf8')).toBe(original);
    expect(fs.existsSync(path.join(wiki, '.semanticwiki-cache/metadata.json'))).toBe(false);
  });

  it('keeps estimation available without overwrite confirmation', () => {
    const result = cli('generate', '-r', root, '-o', wiki, '--estimate', '--non-interactive');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).not.toContain('Pass --yes');
  });
});
