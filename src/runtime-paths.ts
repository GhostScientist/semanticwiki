import * as os from 'node:os';
import * as path from 'node:path';
import { realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';

/** Shared downloads and temporary repositories never default to the caller's cwd. */
export function getRuntimePaths() {
  const homeDir = absoluteOverride('SEMANTICWIKI_HOME') ?? path.join(os.homedir(), '.semanticwiki');
  const modelsDir = absoluteOverride('SEMANTICWIKI_MODELS_DIR') ?? path.join(homeDir, 'models');
  const cacheDir = path.join(homeDir, 'cache');
  return {
    homeDir,
    modelsDir,
    embeddingsDir: path.join(cacheDir, 'embeddings'),
    cacheDir,
    reposDir: path.join(cacheDir, 'repos'),
  };
}

function absoluteOverride(name: string): string | undefined {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  if (!path.isAbsolute(value)) throw new Error(`${name} must be an absolute path.`);
  return path.normalize(value);
}

/** Stable identity for local repositories, including when opened through a symlink. */
export function getRepositoryKey(repoPath: string): string {
  let canonicalPath = path.resolve(repoPath);
  try { canonicalPath = realpathSync(canonicalPath); } catch { /* New repository. */ }
  return createHash('sha256').update(canonicalPath).digest('hex').slice(0, 20);
}

export function getIndexPath(repoPath: string, kind: 'code' | 'wiki' = 'code'): string {
  return path.join(getRuntimePaths().cacheDir, 'indexes', getRepositoryKey(repoPath), kind);
}
