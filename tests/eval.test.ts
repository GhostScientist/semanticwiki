import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  checkMermaidSource, compareReports, evaluateWiki, extractCitations, inMemoryRepository, pairedDelta,
  precisionWeight, scorePage, verifyCitations, checkStructure, checkDiagrams, filesystemRepository, contextFromMetadata,
} from '../src/eval/index.js';

const SOURCE = [
  'import { Router } from "./router";',
  '',
  'export class AuthService {',
  '  constructor(private readonly router: Router) {}',
  '  validateToken(token: string): boolean {',
  '    return token.length > 0;',
  '  }',
  '}',
  '',
  '',
].join('\n');

const repo = inMemoryRepository({ 'src/auth.ts': SOURCE, 'src/router.ts': 'export class Router {}\n' });

describe('citation extraction', () => {
  it('recognizes every citation form and normalizes it', () => {
    const page = [
      '# Auth',
      'The `AuthService` class (`src/auth.ts:3-8`) owns token checks.',
      'See [src/auth.ts:5](../src/auth.ts#L5-L7) and ./src/router.ts#L1.',
      'The router lives in `src/router.ts` lines 1-1.',
      'Version 1.2.3:4 is not a citation, nor is https://example.com/a.ts:1.',
      '```ts',
      '// src/auth.ts:999 inside a fence is copied code, not a claim',
      '```',
    ].join('\n');
    const citations = extractCitations(page);
    expect(citations.map(citation => [citation.file, citation.start, citation.end])).toEqual([
      ['src/auth.ts', 3, 8],
      ['src/auth.ts', 5, 5],
      ['src/router.ts', 1, 1],
      ['src/router.ts', 1, 1],
    ]);
    expect(citations[0].raw).toBe('src/auth.ts:3-8');
    expect(citations[0].claim).toContain('AuthService');
    expect(citations[0].pageLine).toBe(2);
  });

  it('verifies status, context membership and claim support', () => {
    const page = [
      'The `AuthService.validateToken` method rejects empty tokens (`src/auth.ts:5-7`).',
      'Padding is handled in `src/auth.ts:9`.',
      'The parser is in `src/parser.ts:1-10` and `src/auth.ts:40`.',
      'Escape attempts cite `../etc/secrets.txt:1`.',
    ].join('\n');
    const verified = verifyCitations(extractCitations(page), repo, [{ file: 'src/auth.ts', start: 1, end: 8 }]);
    expect(verified.map(citation => citation.status)).toEqual(['valid', 'empty-cited-lines', 'file-not-found', 'line-out-of-bounds', 'outside-repository']);
    expect(verified[0].inContext).toBe(true);
    expect(verified[0].spanInContext).toBe(true);
    expect(verified[0].fileLines).toBe(9);
    expect(verified[0].claimSupport).toBe(0.5);
    expect(verified[1].spanInContext).toBe(false);
  });

  it('reads files through the filesystem without escaping the repository', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'semanticwiki-eval-fs-'));
    try {
      fs.mkdirSync(path.join(root, 'src'));
      fs.writeFileSync(path.join(root, 'src/a.ts'), 'a\nb\n');
      fs.symlinkSync('/etc', path.join(root, 'escape'), 'dir');
      const reader = filesystemRepository(root);
      expect(reader.readLines('src/a.ts')).toEqual(['a', 'b', '']);
      expect(reader.readLines('escape/hostname')).toBeUndefined();
      expect(reader.readLines('../x')).toBeUndefined();
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});

describe('reward', () => {
  it('rewards tight spans and nothing for whole files', () => {
    expect(precisionWeight(10, 300)).toBe(1);
    expect(precisionWeight(9, 9)).toBe(1);
    expect(precisionWeight(220, 2000)).toBe(0.5);
    expect(precisionWeight(400, 2000)).toBe(0);
    expect(precisionWeight(60, 100)).toBe(0.25);
    expect(precisionWeight(100, 100)).toBe(0);
  });

  const body = (claims: string) => `# Page\n\n## Overview\n\n${'The service does work. '.repeat(40)}\n\n${claims}\n`;

  it('applies the uncited guard', () => {
    const score = scorePage({ markdown: body('No references here.'), citations: [] });
    expect(score.components.validity).toBe(0);
    expect(score.guards.map(guard => guard.name)).toEqual(['uncited']);
    expect(score.reward).toBeLessThan(0.2);
  });

  it('caps hallucinated paths and halves duplicate spam', () => {
    const hallucinated = verifyCitations(extractCitations(body('See `src/ghost.ts:1` and `src/phantom.ts:2` and `src/auth.ts:3`.')), repo);
    const capped = scorePage({ markdown: body(''), citations: hallucinated });
    expect(capped.guards.map(guard => guard.name)).toEqual(['hallucinated-paths']);
    expect(capped.reward).toBeLessThanOrEqual(0.3);

    const spam = verifyCitations(extractCitations(body(Array(6).fill('`src/auth.ts:5-7`').join(' '))), repo);
    const halved = scorePage({ markdown: body(''), citations: spam });
    expect(halved.citations.unique).toBe(1);
    expect(halved.guards.map(guard => guard.name)).toEqual(['duplicate-citations']);
  });

  it('zeroes truncated pages', () => {
    const citations = verifyCitations(extractCitations(body('`src/auth.ts:5-7`')), repo);
    expect(scorePage({ markdown: body(''), citations, stopReason: 'max_tokens' }).reward).toBe(0);
  });

  it('matches the cross-language conformance fixture', () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/reward-conformance.json'), 'utf8'));
    for (const example of fixture.cases) {
      const reader = inMemoryRepository(example.repo);
      const citations = verifyCitations(extractCitations(example.page), reader, example.context ?? undefined);
      const score = scorePage({ markdown: example.page, citations, stopReason: example.stopReason });
      expect({ components: score.components, reward: score.reward, guards: score.guards.map((guard: any) => guard.name), citations: score.citations }, example.name)
        .toEqual({ components: example.expected.components, reward: example.expected.reward, guards: example.expected.guards, citations: example.expected.citations });
    }
  });
});

describe('structure and diagrams', () => {
  it('runs structure checks', () => {
    const report = checkStructure('# A\n\n## B\n\nTODO finish\n\n```\nopen fence');
    expect(report.checks).toMatchObject({ has_h1: true, single_h1: true, has_h2: true, fences_closed: false, no_stub_markers: false, word_count_ok: false });
  });

  it('accepts valid diagrams and rejects common breakage', () => {
    expect(checkMermaidSource('flowchart TD\n  A[Start] --> B{Choice}\n  B -->|yes| C[End]').valid).toBe(true);
    expect(checkMermaidSource('sequenceDiagram\n  participant A\n  A->>B: hello').valid).toBe(true);
    expect(checkMermaidSource('flowchart XX\n  A --> B')).toMatchObject({ valid: false, reason: expect.stringContaining('direction') });
    expect(checkMermaidSource('flowchart TD\n  A[Start --> B')).toMatchObject({ valid: false, reason: expect.stringContaining('unclosed') });
    expect(checkMermaidSource('flowchart TD\n  subgraph X\n  A --> B')).toMatchObject({ valid: false, reason: expect.stringContaining('subgraph') });
    expect(checkMermaidSource('sequenceDiagram\n  participant A').valid).toBe(false);
    expect(checkMermaidSource('diagram\n  A --> B').valid).toBe(false);
    expect(checkDiagrams('```mermaid\ngraph LR\n  A --> B\n```\n\n```mermaid\nnope\n```\n')).toMatchObject({ total: 2, valid: 1, invalid: 1 });
  });
});

describe('wiki evaluation', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'semanticwiki-eval-'));
    fs.mkdirSync(path.join(root, 'repo/src'), { recursive: true });
    fs.mkdirSync(path.join(root, 'wiki'), { recursive: true });
    fs.writeFileSync(path.join(root, 'repo/src/auth.ts'), SOURCE);
    fs.writeFileSync(path.join(root, 'repo/src/router.ts'), 'export class Router {}\n');
    fs.writeFileSync(path.join(root, 'repo/src/unused.ts'), 'export const x = 1;\n');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('scores pages, links and coverage from disk and honors recorded evidence', () => {
    fs.writeFileSync(path.join(root, 'wiki/index.md'), '# Index\n\n[Auth](auth.md) [Missing](missing.md) [Source](../src/auth.ts#L1)\n');
    fs.writeFileSync(path.join(root, 'wiki/auth.md'), `---\ntitle: Auth\nevidence:\n  spans:\n    - { file: src/auth.ts, start: 1, end: 8 }\n---\n# Auth\n\n## Overview\n\n${'The AuthService validates tokens. '.repeat(30)}\n\nThe \`AuthService\` class is declared in \`src/auth.ts:3-8\`; \`validateToken\` checks length (\`src/auth.ts:5-7\`). The router is \`src/router.ts:1\`.\n`);
    const report = evaluateWiki(path.join(root, 'wiki'), path.join(root, 'repo'));
    expect(report.summary.pages).toBe(2);
    expect(report.links).toEqual({ total: 2, broken: [{ source: 'index.md', href: 'missing.md' }] });
    const auth = report.pages.find(page => page.path === 'auth.md')!;
    expect(auth.contextSource).toBe('spans');
    expect(auth.citations).toMatchObject({ total: 3, valid: 3, validInContext: 2 });
    expect(auth.components.grounding).toBeCloseTo(2 / 3, 2);
    expect(report.coverage).toEqual({ sourceFiles: 3, citedFiles: 2, fraction: 0.667 });
    expect(report.summary.citations.uncitedPages).toBe(0);
    expect(report.pages.find(page => page.path === 'index.md')!.citations).toMatchObject({ total: 1, valid: 1 });
    expect(contextFromMetadata({ sources: [{ resource: 'src/auth.ts' }, 'https://example.com'] })).toMatchObject({ source: 'files', spans: [{ file: 'src/auth.ts' }] });
  });

  it('compares runs with deterministic paired statistics', () => {
    fs.writeFileSync(path.join(root, 'wiki/a.md'), '# A\n\n' + 'Word. '.repeat(160) + '\n`src/auth.ts:3-8`\n');
    const before = evaluateWiki(path.join(root, 'wiki'), path.join(root, 'repo'));
    fs.writeFileSync(path.join(root, 'wiki/a.md'), '# A\n\n## Overview\n\n' + 'Word. '.repeat(160) + '\nThe AuthService is in `src/auth.ts:3-8` and validateToken in `src/auth.ts:5-7`; the Router is in `src/router.ts:1`.\n');
    const after = evaluateWiki(path.join(root, 'wiki'), path.join(root, 'repo'));
    const comparison = compareReports(before, after);
    expect(comparison.cells).toBe(1);
    expect(comparison.deltas.find(delta => delta.metric === 'reward')!.delta).toBeGreaterThan(0);
    expect(pairedDelta('x', [0.1, 0.2, 0.3, 0.15, 0.25])).toEqual(pairedDelta('x', [0.1, 0.2, 0.3, 0.15, 0.25]));
    expect(pairedDelta('x', [0.1, 0.2, 0.3, 0.15, 0.25]).pTwoSided).toBeLessThan(0.2);
  });
});

describe('local page contract fixtures', () => {
  it('keeps the prompt fixture in sync with the TypeScript builder', async () => {
    const { buildLocalPagePrompt, buildRepairPrompt, LOCAL_PAGE_PROMPT_VERSION, LOCAL_PAGE_SYSTEM_PROMPT } = await import('../src/local-page.js');
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/prompt-conformance.json'), 'utf8'));
    expect(fixture.promptVersion).toBe(LOCAL_PAGE_PROMPT_VERSION);
    expect(fixture.systemPrompt).toBe(LOCAL_PAGE_SYSTEM_PROMPT);
    const input = { title: 'Auth', pageType: 'component', context: 'Token validation', repositoryName: 'fixture', windows: fixture.windows, relatedLinks: '- [Index](./index.md)' };
    expect(buildLocalPagePrompt(input)).toBe(fixture.prompt);
    expect(buildRepairPrompt([{ file: 'src/c.ts', start: 1, end: 5, status: 'file-not-found' }, { file: 'src/a.ts', start: 40, end: 40, status: 'line-out-of-bounds' }], fixture.windows)).toBe(fixture.repair);
    expect(fixture.windows.map((w: any) => `${w.file}:${w.start}-${w.end}`)).toEqual(['src/a.ts:1-12', 'src/b.ts:10-30']);
  });
});
