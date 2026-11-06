import * as fs from 'node:fs';
import * as path from 'node:path';
import matter from 'gray-matter';
import { marked } from 'marked';

export interface WikiHeading {
  id: string;
  title: string;
  level: number;
  startLine: number;
  endLine: number;
}

export interface WikiDocument {
  path: string;
  id: string;
  title: string;
  description: string;
  type: string;
  category?: string;
  tags: string[];
  content: string;
  raw: string;
  metadata: Record<string, any>;
  headings: WikiHeading[];
  links: Array<{ href: string; title: string; path?: string }>;
}

/** A single discovery rule for exports and MCP. Never traverse links or generated output. */
export function listWikiMarkdown(wikiDir: string): string[] {
  if (!fs.existsSync(wikiDir) || !fs.statSync(wikiDir).isDirectory()) {
    throw new Error(`Wiki directory not found: ${wikiDir}`);
  }
  const files: string[] = [];
  const walk = (relativeDir: string) => {
    for (const entry of fs.readdirSync(path.join(wikiDir, relativeDir), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const relativePath = path.posix.join(relativeDir, entry.name);
      if (entry.isDirectory()) {
        if (['site', 'knowledge', 'node_modules'].includes(entry.name)) continue;
        walk(relativePath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(relativePath);
      }
    }
  };
  walk('');
  return files.sort();
}

export function extractHeadings(content: string): WikiHeading[] {
  const lines = content.split('\n');
  const headings: WikiHeading[] = [];
  const used = new Map<string, number>();
  let fence: { character: string; length: number } | undefined;
  for (let i = 0; i < lines.length; i++) {
    const marker = lines[i].match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = { character: marker[1][0], length: marker[1].length };
      else if (marker[1][0] === fence.character && marker[1].length >= fence.length) fence = undefined;
      continue;
    }
    if (fence) continue;
    const match = lines[i].match(/^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/);
    if (!match) continue;
    const title = match[2].replace(/[*_`]/g, '');
    const base = title.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-') || 'section';
    const count = used.get(base) || 0;
    used.set(base, count + 1);
    headings.push({ id: count ? `${base}-${count}` : base, title, level: match[1].length, startLine: i + 1, endLine: lines.length });
  }
  for (let i = 0; i < headings.length; i++) {
    const next = headings.slice(i + 1).find(heading => heading.level <= headings[i].level);
    if (next) headings[i].endLine = next.startLine - 1;
  }
  return headings;
}

/** Resolve only known pages, including OKF bundle-root links. External links remain external. */
export function resolveWikiLink(from: string, href: string, paths: Set<string>): string | undefined {
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//')) return undefined;
  const rawPath = href.split(/[?#]/, 1)[0];
  if (!rawPath) return from;
  let decoded: string;
  try { decoded = decodeURIComponent(rawPath); } catch { return undefined; }
  if (decoded.includes('\\') || decoded.includes('\0')) return undefined;
  const normalized = path.posix.normalize(decoded.startsWith('/') ? decoded.slice(1) : path.posix.join(path.posix.dirname(from), decoded));
  if (normalized === '..' || normalized.startsWith('../')) return undefined;
  const candidates = [normalized, `${normalized}.md`, path.posix.join(normalized, 'index.md'), path.posix.join(normalized, 'README.md')];
  return candidates.find(candidate => paths.has(candidate));
}

export function loadWikiCatalog(wikiDir: string): WikiDocument[] {
  const files = listWikiMarkdown(wikiDir);
  const paths = new Set(files);
  return files.map(file => {
    const raw = fs.readFileSync(path.join(wikiDir, file), 'utf8');
    let parsed: ReturnType<typeof matter>;
    try { parsed = matter(raw); } catch (error) {
      throw new Error(`Invalid frontmatter in ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const { data: metadata, content } = parsed;
    const headings = extractHeadings(content);
    const title = typeof metadata.title === 'string' && metadata.title.trim() ? metadata.title : headings[0]?.title || path.basename(file, '.md');
    const description = typeof metadata.description === 'string' ? metadata.description.replace(/\s+/g, ' ').trim() : '';
    const links: WikiDocument['links'] = [];
    marked.walkTokens(marked.lexer(content), token => {
      if (token.type === 'link') {
        links.push({ href: token.href, title: token.text, path: resolveWikiLink(file, token.href, paths) });
      }
    });
    return {
      path: file, id: file.slice(0, -3), title, description,
      type: typeof metadata.type === 'string' && metadata.type.trim() ? metadata.type : 'Code Documentation',
      category: typeof metadata.category === 'string' ? metadata.category : undefined,
      tags: Array.isArray(metadata.tags) ? metadata.tags.filter((tag: unknown): tag is string => typeof tag === 'string') : [],
      content, raw, metadata, headings, links,
    };
  });
}

export function trustTier(metadata: Record<string, any>): 'unverified' | 'machine-confirmed' | 'human-reviewed' {
  const events = Array.isArray(metadata.verified) ? metadata.verified : metadata.verified ? [metadata.verified] : [];
  const valid = events.filter(event => event && typeof event.by === 'string' && (typeof event.at === 'string' || event.at instanceof Date) && Number.isFinite(Date.parse(String(event.at))));
  if (valid.some(event => event.by.startsWith('human:'))) return 'human-reviewed';
  return valid.length ? 'machine-confirmed' : 'unverified';
}

export function documentSummary(page: WikiDocument) {
  return {
    id: page.id, path: page.path, title: page.title, description: page.description,
    type: page.type, category: page.category, tags: page.tags,
    status: typeof page.metadata.status === 'string' ? page.metadata.status : 'stable',
    trust: trustTier(page.metadata),
    stale: page.metadata.stale_after ? Date.now() >= Date.parse(String(page.metadata.stale_after)) : false,
    headings: page.headings,
  };
}
