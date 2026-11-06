import { afterEach, describe, expect, it, vi } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { getRuntimePaths, getRepositoryKey, getIndexPath } from '../src/runtime-paths.js';

afterEach(() => vi.unstubAllEnvs());

describe('shared runtime storage', () => {
  it('keeps every default download and clone outside the working directory', () => {
    vi.stubEnv('SEMANTICWIKI_HOME', '');
    vi.stubEnv('SEMANTICWIKI_MODELS_DIR', '');
    const dirs = getRuntimePaths();
    expect(dirs.homeDir).toBe(path.join(os.homedir(), '.semanticwiki'));
    for (const directory of Object.values(dirs)) {
      expect(path.isAbsolute(directory)).toBe(true);
      expect(directory.startsWith(`${process.cwd()}${path.sep}`)).toBe(false);
    }
  });

  it('respects one absolute home override and rejects accidental relative cache roots', () => {
    const home = path.join(os.tmpdir(), 'semanticwiki-test-home');
    vi.stubEnv('SEMANTICWIKI_HOME', home);
    vi.stubEnv('SEMANTICWIKI_MODELS_DIR', '');
    expect(getRuntimePaths().modelsDir).toBe(path.join(home, 'models'));
    expect(getRuntimePaths().embeddingsDir).toBe(path.join(home, 'cache', 'embeddings'));
    vi.stubEnv('SEMANTICWIKI_HOME', './models');
    expect(() => getRuntimePaths()).toThrow('absolute path');
  });

  it('gives symlinks the same repository identity without colliding on folder names', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'semanticwiki-paths-'));
    try {
      mkdirSync(path.join(root, 'project'));
      symlinkSync(path.join(root, 'project'), path.join(root, 'link'), 'dir');
      expect(getRepositoryKey(path.join(root, 'project'))).toBe(getRepositoryKey(path.join(root, 'link')));
      expect(getRepositoryKey(path.join(root, 'project'))).not.toBe(getRepositoryKey(path.join(root, 'other', 'project')));
      expect(getIndexPath(path.join(root, 'project'), 'wiki')).toMatch(/wiki$/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
