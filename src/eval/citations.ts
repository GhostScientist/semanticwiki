/**
 * Citation extraction and deterministic verification.
 *
 * A citation is a `path:line` or `path:start-end` reference to a source file in the
 * documented repository. This module is the harness-side half of the reward contract
 * shared with `research/semanticwiki_reward/reward.py`; the two are held equal by
 * `tests/fixtures/reward-conformance.json`. Change the grammar in both places.
 *
 * Grammar (all forms produce the same normalized citation):
 *   - `src/a.ts:12`                   single line
 *   - `src/a.ts:12-30`                inclusive range (en dash accepted)
 *   - `src/a.ts#L12` / `#L12-L30`     GitHub anchor form (also inside markdown links)
 *   - `src/a.ts` lines 12-30          prose form used by teacher models
 * Citations inside fenced code blocks are ignored: copied code is evidence, not a claim.
 * URLs are ignored.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface Citation {
  /** Exact text matched in the page. */
  raw: string;
  /** Repository-relative POSIX path as written, normalized (no leading ./). */
  file: string;
  start: number;
  end: number;
  /** 1-based line of the page where the citation appears. */
  pageLine: number;
  /** The sentence or list item that contains the citation, with markup stripped. */
  claim: string;
}

export type CitationStatus = 'valid' | 'file-not-found' | 'line-out-of-bounds' | 'empty-cited-lines' | 'outside-repository';

export interface VerifiedCitation extends Citation {
  status: CitationStatus;
  /** Whether the cited file was part of the evidence supplied to the writer. */
  inContext: boolean;
  /** Whether the cited span overlaps a supplied evidence span (requires context spans). */
  spanInContext: boolean;
  /** Lines in the cited span. */
  spanLines: number;
  /** Total lines of the cited file (0 when it does not exist). */
  fileLines: number;
  /** Identifier tokens shared between the claim and the cited span over claim identifiers. */
  claimSupport: number | null;
}

export interface ContextSpan { file: string; start: number; end: number }

// A path starts at a token boundary; the lookbehind keeps URL segments and version numbers out.
const PATH = String.raw`(?<![\w./\-:@])((?:\.{0,2}/)?[\w@][\w./\-]*\.[A-Za-z0-9]{1,6})`;
const CITE_COLON = new RegExp(String.raw`${PATH}\`?:(\d+)(?:\s*[-–]\s*L?(\d+))?`, 'g');
const CITE_ANCHOR = new RegExp(String.raw`${PATH}\`?#L(\d+)(?:\s*[-–]\s*L?(\d+))?`, 'g');
const CITE_PROSE = new RegExp(String.raw`${PATH}\`?\s+lines?\s+(\d+)(?:\s*[-–]\s*(\d+))?`, 'gi');

const STOPWORDS = new Set(['the', 'and', 'for', 'that', 'this', 'with', 'from', 'are', 'was', 'were', 'has', 'have', 'its', 'into', 'then', 'when', 'which', 'each', 'uses', 'use', 'used', 'via', 'can', 'not', 'but', 'all', 'any', 'one', 'two', 'also', 'only', 'see', 'how', 'what', 'where', 'while', 'after', 'before', 'their', 'there', 'these', 'those', 'than', 'such', 'both', 'over', 'under', 'between', 'through', 'returns', 'return', 'function', 'method', 'class', 'file', 'files', 'line', 'lines', 'code', 'module', 'object', 'value', 'values', 'type', 'types', 'data', 'default', 'defined', 'defines', 'calls', 'call', 'called', 'provides', 'provide', 'handles', 'handle', 'contains', 'implementation', 'implements', 'source', 'sources', 'component', 'components', 'system', 'main', 'new', 'set', 'get', 'will', 'does', 'did', 'being', 'been', 'other', 'first', 'last', 'more', 'most', 'some', 'same', 'like', 'just', 'also', 'here', 'they', 'them', 'our', 'your']);

export function normalizeCitationPath(file: string): string {
  return file.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '');
}

/** Strip fenced code blocks, replacing them with blank lines so line numbers survive. */
export function stripFences(markdown: string): string {
  const lines = markdown.split('\n');
  let fence: { character: string; length: number } | undefined;
  return lines.map(line => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = { character: marker[1][0], length: marker[1].length };
      else if (marker[1][0] === fence.character && marker[1].length >= fence.length) fence = undefined;
      return '';
    }
    return fence ? '' : line;
  }).join('\n');
}

function claimAround(line: string, raw: string): string {
  // Take the sentence containing the citation on this line, then strip markup.
  const index = line.indexOf(raw);
  const before = index < 0 ? '' : line.slice(0, index);
  const after = index < 0 ? line : line.slice(index + raw.length);
  const sentenceStart = Math.max(before.lastIndexOf('. '), before.lastIndexOf('; '));
  const sentenceEndMatch = after.match(/[.;](\s|$)/);
  const sentence = before.slice(sentenceStart < 0 ? 0 : sentenceStart + 2) + raw + (sentenceEndMatch ? after.slice(0, sentenceEndMatch.index! + 1) : after);
  return sentence
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_>#|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600);
}

const MARKDOWN_LINK = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const LOOKS_CITED = new RegExp(String.raw`${PATH}(?::\d+|#L\d+|\s+lines?\s+\d+)`, 'i');

/**
 * Markdown links are the harness's own clickable citation form, `[a.ts:12](../a.ts#L12)`.
 * Keep whichever side carries the citation (the text when both do) so a link is one
 * citation, and strip the wiki-relative `../` prefix from a link target.
 */
export function unwrapCitationLinks(line: string): string {
  return line.replace(MARKDOWN_LINK, (whole, text: string, target: string) => {
    if (LOOKS_CITED.test(text)) return text;
    if (LOOKS_CITED.test(target) && !/^[a-z][a-z\d+.-]*:/i.test(target)) return target.replace(/^(\.\.?\/)+/, '');
    return text;
  });
}

export function extractCitations(markdown: string): Citation[] {
  const visible = stripFences(markdown);
  const lines = visible.split('\n');
  const citations: Citation[] = [];
  lines.forEach((rawLine, index) => {
    if (!rawLine.trim()) return;
    const line = unwrapCitationLinks(rawLine);
    const found: Array<{ from: number; to: number; citation: Citation }> = [];
    for (const pattern of [CITE_ANCHOR, CITE_COLON, CITE_PROSE]) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(line)) !== null) {
        const rawPath = match[1];
        if (/^\d+(\.\d+)+$/.test(rawPath)) continue; // version numbers like 1.2.3:4
        const start = Number(match[2]);
        const end = match[3] ? Number(match[3]) : start;
        if (!Number.isFinite(start) || start < 1) continue;
        found.push({ from: match.index, to: match.index + match[0].length, citation: {
          raw: match[0], file: normalizeCitationPath(rawPath), start, end: Math.max(end, start),
          pageLine: index + 1, claim: claimAround(line, match[0]),
        } });
      }
    }
    // The same characters can match more than one grammar; keep the earliest, longest match.
    found.sort((a, b) => a.from - b.from || b.to - a.to);
    let cursor = -1;
    for (const item of found) {
      if (item.from < cursor) continue;
      cursor = item.to;
      citations.push(item.citation);
    }
  });
  return citations;
}

/** Tokens that look like code identifiers: backticked, camelCase, snake_case, ALLCAPS, or containing digits. */
export function identifierTokens(text: string, options: { strict?: boolean } = {}): Set<string> {
  const tokens = new Set<string>();
  if (options.strict) {
    for (const match of text.matchAll(/`([^`]+)`/g)) {
      for (const token of match[1].matchAll(/[A-Za-z_][A-Za-z0-9_]{1,}/g)) if (!STOPWORDS.has(token[0].toLowerCase())) tokens.add(token[0].toLowerCase());
    }
  }
  for (const match of text.replace(/`[^`]*`/g, ' ').matchAll(/[A-Za-z_][A-Za-z0-9_]{2,}/g)) {
    const token = match[0];
    if (STOPWORDS.has(token.toLowerCase())) continue;
    if (options.strict && !(/[a-z][A-Z]/.test(token) || token.includes('_') || /\d/.test(token) || /^[A-Z]{2,}/.test(token))) continue;
    tokens.add(token.toLowerCase());
  }
  return tokens;
}

/**
 * Entailment proxy: of the code identifiers the claim names, how many occur in the cited
 * lines. Null when the claim names no identifiers (prose-only claims are not scored).
 */
export function claimSupportScore(claim: string, citedLines: string[]): number | null {
  // Drop the citations themselves (anything with a slash or a :line suffix) but keep dotted identifiers.
  const withoutCitations = claim.replace(/(?:[\w@][\w.\-]*\/[\w./\-]*|[\w@][\w./\-]*\.[A-Za-z0-9]{1,6}:\d+(?:-\d+)?)(?::\d+(?:-\d+)?)?/g, ' ');
  const claimTokens = identifierTokens(withoutCitations, { strict: true });
  if (claimTokens.size === 0) return null;
  const spanTokens = identifierTokens(citedLines.join('\n'));
  let hits = 0;
  for (const token of claimTokens) if (spanTokens.has(token)) hits++;
  return Math.round((hits / claimTokens.size) * 1000) / 1000;
}

export interface RepositoryReader {
  /** Returns file lines, or undefined when the file does not exist or is outside the repository. */
  readLines(file: string): string[] | undefined;
}

export function filesystemRepository(repoRoot: string): RepositoryReader {
  const root = path.resolve(repoRoot);
  const cache = new Map<string, string[] | undefined>();
  return {
    readLines(file) {
      if (cache.has(file)) return cache.get(file);
      let lines: string[] | undefined;
      const resolved = path.resolve(root, file);
      const relative = path.relative(root, resolved);
      if (!relative.startsWith('..') && !path.isAbsolute(relative) && !file.includes('\0')) {
        try {
          const real = fs.realpathSync(resolved);
          const realRoot = fs.realpathSync(root);
          if ((real === realRoot || real.startsWith(realRoot + path.sep)) && fs.statSync(real).isFile()) {
            lines = fs.readFileSync(real, 'utf8').split(/\r?\n/);
          }
        } catch { lines = undefined; }
      }
      cache.set(file, lines);
      return lines;
    },
  };
}

export function inMemoryRepository(files: Record<string, string>): RepositoryReader {
  return { readLines: file => (file in files ? files[file].split(/\r?\n/) : undefined) };
}

export function verifyCitations(
  citations: Citation[],
  repository: RepositoryReader,
  context?: ContextSpan[]
): VerifiedCitation[] {
  const contextFiles = context ? new Set(context.map(span => normalizeCitationPath(span.file))) : undefined;
  return citations.map(citation => {
    const lines = repository.readLines(citation.file);
    const base = {
      ...citation,
      inContext: contextFiles ? contextFiles.has(citation.file) : true,
      spanInContext: context
        ? context.some(span => normalizeCitationPath(span.file) === citation.file && citation.start <= span.end && citation.end >= span.start)
        : true,
      spanLines: citation.end - citation.start + 1,
      fileLines: lines ? lines.length : 0,
      claimSupport: null as number | null,
    };
    if (citation.file.split('/').includes('..')) return { ...base, status: 'outside-repository' };
    if (!lines) return { ...base, status: 'file-not-found' };
    // A trailing newline produces an empty final element; do not count it as a line.
    const fileLines = lines.length > 0 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
    base.fileLines = fileLines;
    if (citation.start > fileLines || citation.end > fileLines) return { ...base, status: 'line-out-of-bounds' };
    const span = lines.slice(citation.start - 1, citation.end);
    if (span.every(line => !line.trim())) return { ...base, status: 'empty-cited-lines' };
    return { ...base, status: 'valid', claimSupport: claimSupportScore(citation.claim, span) };
  });
}
