import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(project, 'dist/cli.js');
const version = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8')).version;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'semanticwiki-cli-'));
const env = { ...process.env, SEMANTICWIKI_HOME: path.join(root, 'managed'), NO_COLOR: '1' };
for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CLAUDE_API_KEY', 'SEMANTICWIKI_PROVIDER', 'SEMANTICWIKI_MODEL', 'SEMANTICWIKI_MODELS_DIR']) delete env[key];

function run(args, expected = 0) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, expected, `${args.join(' ')} exited ${result.status}: ${result.stderr}\n${result.stdout}`);
  return result;
}

try {
  assert.equal(run(['--version']).stdout.trim(), version);
  assert.match(run([]).stdout, /generate/);
  const doctor = JSON.parse(run(['doctor', '--json']).stdout);
  assert.equal(doctor.providers.openai.configured, false);
  assert.equal(doctor.providers.anthropic.configured, false);
  assert.equal(doctor.paths.homeDir, env.SEMANTICWIKI_HOME);
  assert.ok(JSON.parse(run(['models', 'list', '--json']).stdout).some(model => model.modelId === 'semanticwiki-coder-7b-v2'));
  assert.match(run(['generate', '--provider', 'openai'], 1).stderr, /OPENAI_API_KEY/);
  assert.match(run(['generate', '--provider', 'local', '--direct-api'], 1).stderr, /conflicts/);
  assert.match(run(['generate', '--max-turns', '0'], 1).stderr, /positive whole number/);
  assert.ok(!fs.existsSync(path.join(root, '.semanticwiki-models')));
  assert.ok(!fs.existsSync(path.join(root, '.semanticwiki-repos')));
  assert.ok(!fs.existsSync(env.SEMANTICWIKI_HOME), 'Read-only setup commands must not create runtime directories');

  const wiki = path.join(root, 'wiki');
  fs.mkdirSync(path.join(wiki, 'architecture'), { recursive: true });
  fs.writeFileSync(path.join(wiki, 'README.md'), '# Fixture\n\n[Architecture](architecture/overview.md)\n');
  fs.writeFileSync(path.join(wiki, 'architecture/overview.md'), '# Request lifecycle\n\n## Authentication\n\nValidate the session token. [Home](../README.md)\n');
  assert.equal(JSON.parse(run(['verify', '--json']).stdout).isComplete, true);
  const search = JSON.parse(run(['search', 'authentication', '--json']).stdout);
  assert.equal(search.results.length, 1);
  assert.equal(search.results[0].path, 'architecture/overview.md');
  assert.equal(JSON.parse(run(['export', '--json']).stdout).pageCount, 2);
  run(['preview', '--site-title', 'Launch Fixture']);
  assert.ok(fs.existsSync(path.join(wiki, 'site/index.html')));
  assert.ok(fs.existsSync(path.join(wiki, 'site/knowledge/index.md')));
  assert.ok(fs.existsSync(path.join(wiki, 'site/llms.txt')));
  assert.equal(JSON.parse(run(['verify', '--json']).stdout).totalPages, 2, 'Generated copies are not human wiki pages');
  assert.equal(JSON.parse(run(['search', 'authentication', '--json']).stdout).results.length, 1);
  run(['continue', '-r', root, '--verify-only']);
  fs.mkdirSync(path.join(root, 'empty'));
  assert.equal(JSON.parse(run(['verify', '-o', './empty', '--json'], 1).stdout).isComplete, false);
  fs.appendFileSync(path.join(wiki, 'README.md'), '\n[Missing](missing.md)\n');
  run(['continue', '-r', root, '--verify-only'], 1);
  assert.match(run(['preview', '--theme', 'invalid'], 1).stderr, /Theme must/);
  assert.ok(!fs.existsSync(env.SEMANTICWIKI_HOME), 'Model-free commands must not download weights');
  console.log(`CLI contracts passed (${version}; isolated cwd, no keys or downloads).`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
