import * as fs from 'node:fs';
import * as path from 'node:path';
import { simpleGit } from 'simple-git';

export interface RepositoryChange { status: 'A' | 'M' | 'D'; file: string; }

export interface DocumentationIndexState {
  commitHash?: string;
  documentationCommit?: string;
  sourceFingerprint?: string;
  documentationSourceFingerprint?: string;
}

/** Documentation progress must not advance when only the search index changes. */
export function documentationCommit(wikiDir: string, indexState: DocumentationIndexState): string | undefined {
  try {
    const run = JSON.parse(fs.readFileSync(path.join(wikiDir, '.semanticwiki-run.json'), 'utf8'));
    if (run.status === 'complete' && typeof run.sourceCommit === 'string') return run.sourceCommit;
    if (run.status === 'incomplete') return typeof run.documentationCommit === 'string' ? run.documentationCommit : indexState.documentationCommit;
  } catch { /* Older wikis use the preserved index baseline. */ }
  return indexState.documentationCommit || indexState.commitHash;
}

/** A refreshed search index is not evidence that documentation saw those contents. */
export function documentationFingerprint(wikiDir: string, indexState: DocumentationIndexState): string | undefined {
  try {
    const run = JSON.parse(fs.readFileSync(path.join(wikiDir, '.semanticwiki-run.json'), 'utf8'));
    if (run.status === 'complete') return typeof run.sourceFingerprint === 'string' ? run.sourceFingerprint : undefined;
    if (run.status === 'incomplete') return typeof run.documentationSourceFingerprint === 'string' ? run.documentationSourceFingerprint : indexState.documentationSourceFingerprint;
  } catch { /* Legacy wikis can use the fingerprint preserved before index-only updates. */ }
  if (indexState.documentationSourceFingerprint) return indexState.documentationSourceFingerprint;
  if (indexState.documentationCommit && indexState.documentationCommit !== indexState.commitHash) return undefined;
  return indexState.sourceFingerprint;
}

/** Compare the documented revision to the working tree, including untracked files.
 * Renames are represented as a deletion plus an addition so both references update.
 */
export async function collectRepositoryChanges(
  repoPath: string,
  baseline: string | undefined,
  wikiDir?: string,
  options: { purpose?: 'documentation' | 'index'; baselineFingerprint?: string } = {},
): Promise<{ currentCommit: string; changes: RepositoryChange[]; requiresFullRefresh: boolean }> {
  const git = simpleGit(path.resolve(repoPath));
  const currentCommit = (await git.revparse(['HEAD'])).trim();
  const changes = new Map<string, RepositoryChange>();
  if (baseline && /^[a-f\d]{40,64}$/i.test(baseline)) {
    const diff = await git.raw(['diff', '--name-status', '-z', '--no-renames', baseline, '--']);
    const fields = diff.split('\0');
    for (let i = 0; i + 1 < fields.length; i += 2) {
      const status = fields[i][0];
      const file = fields[i + 1];
      if (file) changes.set(file, { status: status === 'A' ? 'A' : status === 'D' ? 'D' : 'M', file });
    }
  } else {
    // An unversioned legacy baseline cannot prove freshness; refresh tracked files.
    const tracked = await git.raw(['ls-files', '-z']);
    for (const file of tracked.split('\0').filter(Boolean)) changes.set(file, { status: 'M', file });
  }
  const untracked = await git.raw(['ls-files', '--others', '--exclude-standard', '-z']);
  for (const file of untracked.split('\0').filter(Boolean)) changes.set(file, { status: 'A', file });
  let baselineFingerprint = options.baselineFingerprint;
  if (wikiDir && options.purpose !== 'index' && baselineFingerprint === undefined) {
    let indexState: DocumentationIndexState = {};
    try { indexState = JSON.parse(fs.readFileSync(path.join(wikiDir, '.semanticwiki-cache', 'index-state.json'), 'utf8')); } catch { /* Optional legacy state. */ }
    baselineFingerprint = documentationFingerprint(wikiDir, indexState);
  }
  let requiresFullRefresh = false;
  if (wikiDir && baselineFingerprint) {
    const { RAGSystem } = await import('./rag/index.js');
    const rag = new RAGSystem({ repoPath: path.resolve(repoPath), storePath: path.join(path.resolve(wikiDir), '.semanticwiki-cache'), logToStderr: true });
    const snapshot = await rag.getSourceSnapshot();
    requiresFullRefresh = baselineFingerprint !== snapshot.sourceFingerprint;
    if (requiresFullRefresh) {
      // HEAD does not describe dirty or untracked contents that a previous run read.
      // Without a per-file documented snapshot, conservatively refresh every page.
      // The flag also covers deleted untracked files, which Git can no longer list.
      for (const file of snapshot.files) if (!changes.has(file)) changes.set(file, { status: 'M', file });
    }
  }
  const wikiRelative = wikiDir ? path.relative(path.resolve(repoPath), path.resolve(wikiDir)).replace(/\\/g, '/') : undefined;
  return {
    currentCommit,
    requiresFullRefresh,
    changes: [...changes.values()].filter(change => !wikiRelative || wikiRelative.startsWith('../') || (change.file !== wikiRelative && !change.file.startsWith(`${wikiRelative}/`)))
      .sort((a, b) => a.file.localeCompare(b.file)),
  };
}
