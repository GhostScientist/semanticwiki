/** Read-only, model-free wiki discovery for MCP coding harnesses. */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema,
  ReadResourceRequestSchema, ErrorCode, McpError,
} from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import type { RAGSystem } from './rag/index.js';
import { documentSummary, loadWikiCatalog, type WikiDocument } from './wiki-catalog.js';

export interface WikiServerConfig { wikiPath: string; ragStorePath?: string; repoPath?: string; }
type Args = Record<string, unknown>;
type ToolResult = { content: Array<{ type: 'text'; text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean };
const version = createRequire(import.meta.url)('../package.json').version as string;
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const formatProperty = { type: 'string', enum: ['text', 'json'], description: 'Response presentation. Structured results are always included.' };
const filters = {
  category: { type: 'string', description: 'Exact category filter (case-insensitive).' },
  type: { type: 'string', description: 'Exact OKF concept type filter (case-insensitive).' },
  tag: { type: 'string', description: 'Filter by a single tag (case-insensitive).' },
};
const tools = [
  {
    name: 'get_knowledge_manifest',
    description: 'Start here: discover the wiki, OKF export, entry points, categories, and available query operations. No model or API key required.',
    inputSchema: { type: 'object', properties: { format: formatProperty } },
  },
  {
    name: 'search_wiki',
    description: 'Search wiki concepts by keyword, title, headings, and content. Returns ranked matches with excerpts, section IDs, and trust metadata.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 2000 }, maxResults: { type: 'integer', minimum: 1, maximum: 50, default: 10 }, ...filters, format: formatProperty }, required: ['query'] },
  },
  {
    name: 'get_wiki_page',
    description: 'Read a bounded part of a page by path or concept ID. Optionally select a heading ID; use nextStartLine for subsequent chunks. Line numbers refer to the Markdown body, excluding frontmatter.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, section: { type: 'string', description: 'Heading ID or exact heading title from search/list results.' }, startLine: { type: 'integer', minimum: 1 }, maxLines: { type: 'integer', minimum: 1, maximum: 400, default: 120 }, format: formatProperty }, required: ['path'] },
  },
  {
    name: 'list_wiki_pages',
    description: 'Browse concepts with headings and metadata, with pagination and optional category/type/tag filters.',
    inputSchema: { type: 'object', properties: { ...filters, offset: { type: 'integer', minimum: 0, default: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 }, format: formatProperty } },
  },
  {
    name: 'get_related_pages',
    description: 'Follow outgoing wiki links and backlinks to navigate related concepts without reading every page.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, maxResults: { type: 'integer', minimum: 1, maximum: 50, default: 20 }, format: formatProperty }, required: ['path'] },
  },
  {
    name: 'search_code',
    description: 'Search a previously indexed source repository. Keyword mode needs no embedding model; vector and hybrid modes can initialize local embeddings.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 2000 }, maxResults: { type: 'integer', minimum: 1, maximum: 50, default: 5 }, mode: { type: 'string', enum: ['hybrid', 'vector', 'keyword'], default: 'hybrid' }, format: formatProperty }, required: ['query'] },
  },
  {
    name: 'get_architecture_overview',
    description: 'Read the first 120 lines of the best architecture overview; use get_wiki_page to continue.',
    inputSchema: { type: 'object', properties: { format: formatProperty } },
  },
].map(tool => ({ ...tool, annotations }));

function stringArg(args: Args, key: string, required = false): string | undefined {
  const value = args[key];
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) throw new Error(`${key} must be a nonempty string of at most 2000 characters.`);
  return value.trim();
}

function integerArg(args: Args, key: string, fallback: number, minimum: number, maximum: number): number {
  const value = args[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${key} must be an integer from ${minimum} to ${maximum}.`);
  return value;
}

function response(data: Record<string, unknown>, text: string, args: Args): ToolResult {
  if (args.format !== undefined && args.format !== 'text' && args.format !== 'json') throw new Error('format must be text or json.');
  return { content: [{ type: 'text', text: args.format === 'json' ? JSON.stringify(data, null, 2) : text }], structuredContent: data };
}

function resourceUri(pagePath: string): string {
  return `wiki://${pagePath.split('/').map(encodeURIComponent).join('/')}`;
}

export class WikiMCPServer {
  private readonly server: Server;
  private pages: WikiDocument[] = [];
  private ragSystem: RAGSystem | null = null;

  constructor(private readonly config: WikiServerConfig) {
    this.server = new Server({ name: 'semanticwiki', version }, { capabilities: { tools: {}, resources: {} } });
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
    this.server.setRequestHandler(CallToolRequestSchema, async request => {
      try { return await this.callTool(request.params.name, (request.params.arguments || {}) as Args); }
      catch (error) { return { content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }], isError: true }; }
    });
    this.server.setRequestHandler(ListResourcesRequestSchema, async request => {
      const cursor = request.params?.cursor;
      if (cursor !== undefined && !/^\d+$/.test(cursor)) throw new McpError(ErrorCode.InvalidParams, 'Invalid resource cursor.');
      const offset = Number(cursor || 0);
      if (!Number.isSafeInteger(offset) || offset > this.pages.length) throw new McpError(ErrorCode.InvalidParams, 'Invalid resource cursor.');
      const resources = this.pages.slice(offset, offset + 100).map(page => ({ uri: resourceUri(page.path), name: page.title, description: page.description, mimeType: 'text/markdown' }));
      return { resources, ...(offset + 100 < this.pages.length ? { nextCursor: String(offset + 100) } : {}) };
    });
    this.server.setRequestHandler(ReadResourceRequestSchema, async request => {
      let requestedPath: string;
      try {
        if (!request.params.uri.startsWith('wiki://')) throw new Error('Unknown URI scheme');
        requestedPath = decodeURIComponent(request.params.uri.slice('wiki://'.length));
      } catch { throw new McpError(ErrorCode.InvalidParams, 'Invalid wiki resource URI.'); }
      const page = this.pages.find(candidate => candidate.path === requestedPath);
      if (!page) throw new McpError(ErrorCode.InvalidParams, `Wiki resource not found: ${requestedPath}`);
      return { contents: [{ uri: request.params.uri, mimeType: 'text/markdown', text: page.raw }] };
    });
  }

  private filterPages(args: Args): WikiDocument[] {
    const category = stringArg(args, 'category')?.toLowerCase();
    const type = stringArg(args, 'type')?.toLowerCase();
    const tag = stringArg(args, 'tag')?.toLowerCase();
    return this.pages.filter(page => (!category || page.category?.toLowerCase() === category) && (!type || page.type.toLowerCase() === type) && (!tag || page.tags.some(value => value.toLowerCase() === tag)));
  }

  private findPage(value: string): WikiDocument {
    const normalized = value.replace(/^\//, '').toLowerCase();
    const page = this.pages.find(candidate => candidate.path.toLowerCase() === normalized || candidate.id.toLowerCase() === normalized);
    if (!page) throw new Error(`Wiki page not found: ${value}. Use search_wiki or list_wiki_pages to discover valid paths.`);
    return page;
  }

  private readPage(args: Args): ToolResult {
    const page = this.findPage(stringArg(args, 'path', true)!);
    const section = stringArg(args, 'section');
    const heading = section ? page.headings.find(value => value.id === section || value.title.toLowerCase() === section.toLowerCase()) : undefined;
    if (section && !heading) throw new Error(`Section not found: ${section}. Available heading IDs: ${page.headings.map(value => value.id).join(', ')}`);
    const lines = page.content.split('\n');
    const firstLine = heading?.startLine || 1;
    const lastLine = heading?.endLine || lines.length;
    const startLine = integerArg(args, 'startLine', firstLine, 1, Math.max(1, lines.length));
    const maxLines = integerArg(args, 'maxLines', 120, 1, 400);
    if (startLine < firstLine || startLine > lastLine) throw new Error(`startLine must be within the selected section (${firstLine}-${lastLine}).`);
    let endLine = Math.min(startLine + maxLines - 1, lastLine);
    let content = lines.slice(startLine - 1, endLine).join('\n');
    let longLineTruncated = false;
    while (content.length > 32000 && endLine > startLine) { endLine--; content = lines.slice(startLine - 1, endLine).join('\n'); }
    if (content.length > 32000) { content = content.slice(0, 32000); longLineTruncated = true; }
    const nextStartLine = endLine < lastLine ? endLine + 1 : null;
    const data = { ...documentSummary(page), metadata: page.metadata, startLine, endLine, totalLines: lines.length, nextStartLine, truncated: nextStartLine !== null || longLineTruncated, longLineTruncated, content };
    const hint = nextStartLine ? `\n\nContinue with get_wiki_page(path=${JSON.stringify(page.path)}, startLine=${nextStartLine}${section ? `, section=${JSON.stringify(section)}` : ''}).` : '';
    const longLineHint = longLineTruncated ? '\n\nA line exceeded 32,000 characters. Read the wiki resource to obtain the complete document.' : '';
    return response(data, `# ${page.title}\nPath: ${page.path} | Lines: ${startLine}-${endLine} | Trust: ${data.trust}\n\n${content}${hint}${longLineHint}`, args);
  }

  private async callTool(name: string, args: Args): Promise<ToolResult> {
    switch (name) {
      case 'get_knowledge_manifest': {
        const exportAvailable = fs.existsSync(path.join(this.config.wikiPath, 'knowledge', 'manifest.json'));
        const entries = this.pages.filter(page => /^(README|index|overview|architecture)\.md$/i.test(page.path) || page.path === 'architecture/overview.md').map(documentSummary);
        const data = { name: 'SemanticWiki', version, pageCount: this.pages.length, entrypoints: entries, categories: [...new Set(this.pages.map(page => page.category).filter(Boolean))].sort(), types: [...new Set(this.pages.map(page => page.type))].sort(), codeSearchAvailable: this.ragSystem !== null, export: exportAvailable ? { format: 'OKF', version: '0.2', index: 'knowledge/index.md', catalog: 'knowledge/manifest.json', discovery: 'llms.txt' } : null, workflow: ['list_wiki_pages or search_wiki', 'get_wiki_page with path and optional section', 'get_related_pages', 'search_code if an index is available'], trustNote: 'Generated documentation is unverified unless explicit verification metadata says otherwise. Check source code before making changes.' };
        return response(data, JSON.stringify(data, null, 2), args);
      }
      case 'search_wiki': {
        const query = stringArg(args, 'query', true)!;
        const keywords = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_.-]+/gu) || [])];
        const maxResults = integerArg(args, 'maxResults', 10, 1, 50);
        const matches = this.filterPages(args).map(page => {
          const lower = page.content.toLowerCase();
          let score = 0;
          for (const keyword of keywords) {
            if (page.title.toLowerCase().includes(keyword)) score += 10;
            if (page.description.toLowerCase().includes(keyword)) score += 5;
            if (page.headings.some(heading => heading.title.toLowerCase().includes(keyword))) score += 3;
            if (lower.includes(keyword)) score++;
          }
          const positions = keywords.map(keyword => lower.indexOf(keyword)).filter(position => position >= 0);
          const start = Math.max(0, (positions.length ? Math.min(...positions) : 0) - 100);
          return { ...documentSummary(page), score, excerpt: page.content.slice(start, start + 360), sources: page.metadata.sources || [] };
        }).filter(result => result.score > 0).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
        const results = matches.slice(0, maxResults);
        return response({ query, total: matches.length, results }, results.length ? results.map(page => `## ${page.title}\nPath: ${page.path} | Score: ${page.score} | Trust: ${page.trust}\n${page.excerpt}\nSections: ${page.headings.map(heading => heading.id).join(', ')}`).join('\n\n') : `No wiki pages found matching "${query}".`, args);
      }
      case 'get_wiki_page': return this.readPage(args);
      case 'list_wiki_pages': {
        const offset = integerArg(args, 'offset', 0, 0, Number.MAX_SAFE_INTEGER);
        const limit = integerArg(args, 'limit', 25, 1, 100);
        const all = this.filterPages(args);
        const pages = all.slice(offset, offset + limit).map(documentSummary);
        const nextOffset = offset + limit < all.length ? offset + limit : null;
        return response({ total: all.length, offset, nextOffset, pages }, `# Wiki pages (${all.length} total)\n\n${pages.map(page => `- ${page.title} (${page.path})${page.description ? ` — ${page.description}` : ''}`).join('\n')}${nextOffset !== null ? `\n\nNext offset: ${nextOffset}` : ''}`, args);
      }
      case 'get_related_pages': {
        const page = this.findPage(stringArg(args, 'path', true)!);
        const maxResults = integerArg(args, 'maxResults', 20, 1, 50);
        const outgoingPaths = new Set(page.links.map(link => link.path).filter(Boolean));
        const related = this.pages.filter(candidate => candidate.path !== page.path && (outgoingPaths.has(candidate.path) || candidate.links.some(link => link.path === page.path))).map(candidate => ({ ...documentSummary(candidate), direction: outgoingPaths.has(candidate.path) ? candidate.links.some(link => link.path === page.path) ? 'both' : 'outgoing' : 'incoming' }));
        const results = related.slice(0, maxResults);
        return response({ path: page.path, total: related.length, results }, `# Related to ${page.title}\n\n${results.map(result => `- ${result.title} (${result.path}) — ${result.direction}`).join('\n') || 'No related pages found.'}`, args);
      }
      case 'search_code': {
        const query = stringArg(args, 'query', true)!;
        const maxResults = integerArg(args, 'maxResults', 5, 1, 50);
        const mode = args.mode || 'hybrid';
        if (mode !== 'hybrid' && mode !== 'vector' && mode !== 'keyword') throw new Error('mode must be hybrid, vector, or keyword.');
        if (!this.ragSystem) throw new Error('Code search is unavailable. Start the MCP server with a repository and an existing index; wiki search remains available without a model.');
        const results = (await this.ragSystem.search(query, { maxResults, mode })).map(result => ({ ...result, content: result.content.slice(0, 4000), contentTruncated: result.content.length > 4000 }));
        return response({ query, mode, results }, results.map(result => `## ${result.filePath}:${result.startLine}-${result.endLine}\n\n\`\`\`${result.language}\n${result.content}\n\`\`\``).join('\n\n') || `No code matches for "${query}".`, args);
      }
      case 'get_architecture_overview': {
        const candidates = ['architecture/overview.md', 'overview.md', 'architecture.md', 'README.md', 'index.md'];
        const page = candidates.map(candidate => this.pages.find(page => page.path === candidate)).find(Boolean) || this.pages.find(page => /architecture|overview/i.test(page.title));
        if (!page) return response({ pageCount: this.pages.length, pages: this.pages.slice(0, 25).map(documentSummary) }, 'No dedicated architecture overview found. Use list_wiki_pages to browse documented concepts.', args);
        return this.readPage({ ...args, path: page.path });
      }
      default: throw new Error(`Unknown tool: ${name}`);
    }
  }

  /** Connect to any MCP transport; useful to embedders and protocol integration tests. */
  async connect(transport: Transport): Promise<void> {
    this.pages = loadWikiCatalog(path.resolve(this.config.wikiPath));
    if (this.config.ragStorePath && this.config.repoPath && fs.existsSync(path.join(this.config.ragStorePath, 'metadata.json'))) {
      try {
        const { RAGSystem } = await import('./rag/index.js');
        const rag = new RAGSystem({ storePath: this.config.ragStorePath, repoPath: this.config.repoPath, useHybridSearch: true, useReranking: false, logToStderr: true });
        await rag.loadMetadataOnly({ migrateEmbeddings: false });
        this.ragSystem = rag;
      } catch (error) { console.error('Code index unavailable; wiki tools remain available:', error instanceof Error ? error.message : String(error)); }
    }
    await this.server.connect(transport);
  }

  async start(): Promise<void> {
    await this.connect(new StdioServerTransport());
    console.error(`SemanticWiki MCP server ready (${this.pages.length} pages).`);
  }

  async close(): Promise<void> { await this.server.close(); }
}

async function main() {
  const args = process.argv.slice(2);
  const config: WikiServerConfig = { wikiPath: './wiki' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--wiki' && args[i + 1]) config.wikiPath = args[++i];
    else if (args[i] === '--rag-store' && args[i + 1]) config.ragStorePath = args[++i];
    else if (args[i] === '--repo' && args[i + 1]) config.repoPath = args[++i];
    else if (args[i] === '--help' || args[i] === '-h') {
      console.log('SemanticWiki MCP Server\n\nUsage: semanticwiki mcp-server -o /path/to/wiki [-r /path/to/repository]\n\nTools: get_knowledge_manifest, search_wiki, get_wiki_page, list_wiki_pages, get_related_pages, search_code, get_architecture_overview');
      return;
    } else throw new Error(`Unknown or incomplete option: ${args[i]}`);
  }
  await new WikiMCPServer(config).start();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
