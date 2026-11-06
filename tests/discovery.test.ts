import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CodebaseDiscovery } from '../src/discovery/index.js';

describe('source domain discovery', () => {
  let repoPath: string;
  beforeEach(() => { repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'semanticwiki-discovery-')); });
  afterEach(() => fs.rmSync(repoPath, { recursive: true, force: true }));

  it('keeps ordinary task entities in source documentation without inventing background processing', async () => {
    fs.mkdirSync(path.join(repoPath, 'src'));
    fs.writeFileSync(path.join(repoPath, 'src/index.ts'), 'export type Task = { title: string; complete: boolean };\nexport class TaskStore { private tasks: Task[] = []; list() { return this.tasks.map(task => ({ ...task })); } }');
    const result = await new CodebaseDiscovery({ repoPath }).discover();
    expect(result.domains.find(domain => domain.id === 'source-code')?.files).toContain('src/index.ts');
    expect(result.domains.some(domain => domain.category === 'batch-processing')).toBe(false);
    expect(result.domains.some(domain => domain.category === 'presentation')).toBe(false);
  });

  it('continues to identify explicit scheduler source as background processing', async () => {
    fs.writeFileSync(path.join(repoPath, 'scheduler.ts'), 'export function runScheduledJob() { return true; }');
    const result = await new CodebaseDiscovery({ repoPath }).discover();
    expect(result.domains.find(domain => domain.id === 'batch-processing')?.files).toContain('scheduler.ts');
  });
});
