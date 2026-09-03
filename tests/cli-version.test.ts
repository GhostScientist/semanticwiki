import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));
const cliPath = path.join(repoRoot, 'dist', 'cli.js');
const built = fs.existsSync(cliPath);

/**
 * `--version` was hardcoded twice before (once to 1.0.0, then to 1.4.0) and drifted
 * from the published release both times. These tests require it to stay derived from
 * package.json. They only run against a built dist/, so they no-op on a clean tree.
 */
describe.runIf(built)('CLI version reporting', () => {
  const runCli = (args: string[]) =>
    execFileSync(process.execPath, [cliPath, ...args], {
      encoding: 'utf-8',
      cwd: repoRoot
    });

  it('reports the version from package.json', () => {
    expect(runCli(['--version']).trim()).toBe(pkg.version);
  });

  it('prints the version with no other output on stdout', () => {
    // dotenv v17 prints a banner unless `quiet` is set, which would corrupt both
    // `--version` and the mcp-server stdio stream.
    const lines = runCli(['--version']).trim().split('\n').filter(Boolean);
    expect(lines).toEqual([pkg.version]);
  });

  it('does not hardcode a version string in the CLI source', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'src', 'cli.ts'), 'utf-8');
    expect(source).not.toMatch(/\.version\(\s*['"`]\d+\.\d+\.\d+/);
  });
});
