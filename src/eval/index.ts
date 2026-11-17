/**
 * Wiki-level evaluation: scores every page with the shared reward, checks internal
 * links, and estimates repository coverage. `compareReports` gives paired deltas with
 * bootstrap confidence intervals so two runs can be told apart from noise.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadWikiCatalog, type WikiDocument } from '../wiki-catalog.js';
import { extractCitations, filesystemRepository, normalizeCitationPath, verifyCitations, type ContextSpan, type RepositoryReader, type VerifiedCitation } from './citations.js';
import { REWARD_VERSION, WEIGHTS, scorePage, type Component, type PageScore } from './reward.js';

export * from './citations.js';
export * from './reward.js';
export * from './structure.js';

export type ContextSource = 'spans' | 'files' | 'unknown';

export interface PageReport extends PageScore {
  path: string;
  title: string;
  /** Where the evidence context came from: recorded spans, recorded files, or unknown (whole repository). */
  contextSource: ContextSource;
  problems: Array<{ file: string; start: number; end: number; status: string; pageLine: number }>;
  trust: 'unverified' | 'machine-confirmed' | 'human-reviewed';
}

export interface EvalReport {
  formatVersion: 1;
  rewardVersion: number;
  generatedAt: string;
  wikiDir: string;
  repoPath: string;
  pages: PageReport[];
  links: { total: number; broken: Array<{ source: string; href: string }> };
  coverage: { sourceFiles: number; citedFiles: number; fraction: number };
  summary: {
    pages: number;
    meanReward: number;
    components: Record<Component, number>;
    citations: { total: number; valid: number; validity: number; uncitedPages: number; hallucinatedPathPages: number };
    diagrams: { total: number; invalid: number };
    brokenLinks: number;
    guardCounts: Record<string, number>;
  };
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.kt', '.rb', '.php', '.c', '.h', '.cc', '.cpp', '.hpp', '.cs', '.swift', '.scala', '.sh', '.sql', '.cbl', '.cob', '.cpy', '.jcl']);
const SKIP_DIRS = new Set(['node_modules', 'vendor', 'dist', 'build', 'coverage', '.git', '__pycache__', 'site', 'knowledge', 'target', '.semanticwiki-cache']);

export function listSourceFiles(repoPath: string, limit = 5000): string[] {
  const files: string[] = [];
  const walk = (dir: string, relative: string) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (files.length >= limit) return;
      if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      const relPath = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), relPath); }
      else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(relPath);
    }
  };
  walk(repoPath, '');
  return files.sort();
}

/** Recover the evidence a page was written from, when generation recorded it in frontmatter. */
export function contextFromMetadata(metadata: Record<string, any>): { spans?: ContextSpan[]; source: ContextSource } {
  const evidence = metadata.evidence;
  if (evidence && Array.isArray(evidence.spans)) {
    const spans = evidence.spans
      .filter((span: any) => span && typeof span.file === 'string' && Number.isFinite(span.start) && Number.isFinite(span.end))
      .map((span: any) => ({ file: normalizeCitationPath(span.file), start: Number(span.start), end: Number(span.end) }));
    if (spans.length) return { spans, source: 'spans' };
  }
  if (Array.isArray(metadata.sources) && metadata.sources.length) {
    const files = metadata.sources
      .map((source: any) => (typeof source === 'string' ? source : source && typeof source.resource === 'string' ? source.resource : undefined))
      .filter((file: unknown): file is string => typeof file === 'string' && !/^[a-z][a-z\d+.-]*:/i.test(file))
      .map((file: string) => normalizeCitationPath(file.replace(/[:#]L?\d+(?:-L?\d+)?$/, '')));
    if (files.length) return { spans: files.map((file: string) => ({ file, start: 1, end: Number.MAX_SAFE_INTEGER })), source: 'files' };
  }
  return { source: 'unknown' };
}

export function trustFromMetadata(metadata: Record<string, any>): PageReport['trust'] {
  const events = Array.isArray(metadata.verified) ? metadata.verified : metadata.verified ? [metadata.verified] : [];
  const valid = events.filter((event: any) => event && typeof event.by === 'string' && Number.isFinite(Date.parse(String(event.at))));
  if (valid.some((event: any) => event.by.startsWith('human:'))) return 'human-reviewed';
  return valid.length ? 'machine-confirmed' : 'unverified';
}

export function evaluatePage(page: Pick<WikiDocument, 'path' | 'title' | 'content' | 'metadata'>, repository: RepositoryReader): PageReport {
  const context = contextFromMetadata(page.metadata);
  const citations: VerifiedCitation[] = verifyCitations(extractCitations(page.content), repository, context.spans);
  const score = scorePage({ markdown: page.content, citations });
  return {
    path: page.path,
    title: page.title,
    contextSource: context.source,
    ...score,
    problems: citations.filter(citation => citation.status !== 'valid').map(citation => ({ file: citation.file, start: citation.start, end: citation.end, status: citation.status, pageLine: citation.pageLine })),
    trust: trustFromMetadata(page.metadata),
  };
}

const round3 = (value: number): number => Math.round(value * 1000) / 1000;
const mean = (values: number[]): number => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);

function isPageLink(href: string): boolean {
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('#')) return false;
  const target = href.split(/[?#]/, 1)[0];
  // Source citations rendered as links are judged by the citation verifier, not as page links.
  if (/\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|rb|php|[ch](?:pp)?|cs|swift|scala|sh|sql|cbl|cob|cpy|jcl)$/i.test(target) || /#L\d+/.test(href) || /:\d+$/.test(href)) return false;
  return true;
}

export function evaluateWiki(wikiDir: string, repoPath: string): EvalReport {
  const absoluteWiki = path.resolve(wikiDir);
  const absoluteRepo = path.resolve(repoPath);
  const repository = filesystemRepository(absoluteRepo);
  const catalog = loadWikiCatalog(absoluteWiki);
  const pages = catalog.map(page => evaluatePage(page, repository));

  const broken: EvalReport['links']['broken'] = [];
  let totalLinks = 0;
  for (const page of catalog) {
    for (const link of page.links) {
      if (!isPageLink(link.href)) continue;
      totalLinks++;
      if (!link.path) broken.push({ source: page.path, href: link.href });
    }
  }

  const sourceFiles = listSourceFiles(absoluteRepo);
  const cited = new Set<string>();
  for (const page of catalog) {
    for (const citation of verifyCitations(extractCitations(page.content), repository)) if (citation.status === 'valid') cited.add(citation.file);
  }
  const sourceSet = new Set(sourceFiles);
  const citedFiles = [...cited].filter(file => sourceSet.has(file)).length;

  const components = Object.fromEntries((Object.keys(WEIGHTS) as Component[]).map(key => [key, round3(mean(pages.map(page => page.components[key])))])) as Record<Component, number>;
  const guardCounts: Record<string, number> = {};
  for (const page of pages) for (const guard of page.guards) guardCounts[guard.name] = (guardCounts[guard.name] || 0) + 1;
  const totalCitations = pages.reduce((sum, page) => sum + page.citations.total, 0);
  const validCitations = pages.reduce((sum, page) => sum + page.citations.valid, 0);

  return {
    formatVersion: 1,
    rewardVersion: REWARD_VERSION,
    generatedAt: new Date().toISOString(),
    wikiDir: absoluteWiki,
    repoPath: absoluteRepo,
    pages,
    links: { total: totalLinks, broken },
    coverage: { sourceFiles: sourceFiles.length, citedFiles, fraction: sourceFiles.length ? round3(citedFiles / sourceFiles.length) : 0 },
    summary: {
      pages: pages.length,
      meanReward: round3(mean(pages.map(page => page.reward))),
      components,
      citations: {
        total: totalCitations,
        valid: validCitations,
        validity: totalCitations ? round3(validCitations / totalCitations) : 0,
        uncitedPages: pages.filter(page => page.citations.total === 0).length,
        hallucinatedPathPages: guardCounts['hallucinated-paths'] || 0,
      },
      diagrams: { total: pages.reduce((sum, page) => sum + page.diagrams.total, 0), invalid: pages.reduce((sum, page) => sum + page.diagrams.invalid, 0) },
      brokenLinks: broken.length,
      guardCounts,
    },
  };
}

export interface PairedDelta { metric: string; cells: number; delta: number; ci95: [number, number]; pTwoSided: number }
export interface CompareReport {
  formatVersion: 1;
  method: string;
  cells: number;
  onlyInA: string[];
  onlyInB: string[];
  deltas: PairedDelta[];
}

/** Deterministic PRNG so comparisons are reproducible across runs and languages. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Paired sign-flip test and percentile bootstrap over per-page deltas. */
export function pairedDelta(metric: string, diffs: number[], resamples = 2000, seed = 7): PairedDelta {
  const n = diffs.length;
  const observed = mean(diffs);
  if (n === 0) return { metric, cells: 0, delta: 0, ci95: [0, 0], pTwoSided: 1 };
  const random = mulberry32(seed);
  const bootstrap: number[] = [];
  let extreme = 0;
  for (let round = 0; round < resamples; round++) {
    let flipped = 0;
    let resampled = 0;
    for (let index = 0; index < n; index++) {
      flipped += random() < 0.5 ? diffs[index] : -diffs[index];
      resampled += diffs[Math.floor(random() * n)];
    }
    if (Math.abs(flipped / n) >= Math.abs(observed) - 1e-12) extreme++;
    bootstrap.push(resampled / n);
  }
  bootstrap.sort((a, b) => a - b);
  const quantile = (q: number) => bootstrap[Math.min(bootstrap.length - 1, Math.max(0, Math.floor(q * (bootstrap.length - 1))))];
  return { metric, cells: n, delta: round3(observed), ci95: [round3(quantile(0.025)), round3(quantile(0.975))], pTwoSided: round3(extreme / resamples) };
}

export function compareReports(a: EvalReport, b: EvalReport, options: { resamples?: number; seed?: number } = {}): CompareReport {
  const byPathA = new Map(a.pages.map(page => [page.path, page]));
  const byPathB = new Map(b.pages.map(page => [page.path, page]));
  const shared = [...byPathA.keys()].filter(key => byPathB.has(key)).sort();
  const metrics: Array<[string, (page: PageReport) => number]> = [
    ['reward', page => page.reward],
    ...(Object.keys(WEIGHTS) as Component[]).map(key => [key, (page: PageReport) => page.components[key]] as [string, (page: PageReport) => number]),
  ];
  return {
    formatVersion: 1,
    method: `paired sign-flip test over shared pages (B minus A), ${options.resamples ?? 2000} resamples, seed ${options.seed ?? 7}; percentile bootstrap 95% CI`,
    cells: shared.length,
    onlyInA: [...byPathA.keys()].filter(key => !byPathB.has(key)).sort(),
    onlyInB: [...byPathB.keys()].filter(key => !byPathA.has(key)).sort(),
    deltas: metrics.map(([metric, read]) => pairedDelta(metric, shared.map(key => read(byPathB.get(key)!) - read(byPathA.get(key)!)), options.resamples, options.seed)),
  };
}

export function renderReportMarkdown(report: EvalReport): string {
  const { summary } = report;
  const lines = [
    `# Wiki evaluation`,
    '',
    `Pages: ${summary.pages} · mean reward: ${summary.meanReward} · citation validity: ${summary.citations.validity} (${summary.citations.valid}/${summary.citations.total}) · uncited pages: ${summary.citations.uncitedPages} · broken links: ${summary.brokenLinks} · invalid diagrams: ${summary.diagrams.invalid}/${summary.diagrams.total} · coverage: ${report.coverage.citedFiles}/${report.coverage.sourceFiles} source files`,
    '',
    '| Component | Mean |',
    '| --- | ---: |',
    ...(Object.keys(WEIGHTS) as Component[]).map(key => `| ${key} | ${summary.components[key]} |`),
    '',
    '| Page | Reward | Cites (valid) | Context | Guards |',
    '| --- | ---: | ---: | --- | --- |',
    ...report.pages.map(page => `| ${page.path} | ${page.reward} | ${page.citations.total} (${page.citations.valid}) | ${page.contextSource} | ${page.guards.map(guard => guard.name).join(', ') || '-'} |`),
  ];
  const problems = report.pages.flatMap(page => page.problems.map(problem => `- ${page.path}:${problem.pageLine} → ${problem.file}:${problem.start}${problem.end !== problem.start ? `-${problem.end}` : ''} (${problem.status})`));
  if (problems.length) lines.push('', '## Citation problems', '', ...problems.slice(0, 200));
  if (report.links.broken.length) lines.push('', '## Broken links', '', ...report.links.broken.map(link => `- ${link.source} → ${link.href}`));
  return lines.join('\n') + '\n';
}
