import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { WikiMCPServer } from '../src/mcp-wiki-server.js';

describe('SemanticWiki MCP protocol', () => {
  let root: string;
  let server: WikiMCPServer;
  let client: Client;
  const write = (name: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), content);
  };
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    return result as { isError?: boolean; content: Array<{ type: string; text: string }>; structuredContent: Record<string, any> };
  };
  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'semanticwiki-mcp-'));
    write('README.md', '# Example project\n\nRead about [authentication](architecture/auth.md).\n');
    write('architecture/auth.md', '---\ntitle: Authentication\ntype: Component\ncategory: Architecture\ntags: [security, api]\nsources:\n  - resource: https://example.com/auth.ts\n---\n\n# Authentication\n\n## Login flow\n\nClients authenticate using signed tokens.\n\n### Token checks\n\nVerify the issuer and expiry.\n\n## Storage\n\nCredentials are not stored here.\n\n[Return home](/README.md)\n');
    write('API Notes.md', '# API\n\n## API\n\nA short API reference.\n\n```md\n# Fake heading\n```\n\n## API\n\nAnother API section.\n');
    write('knowledge/copy.md', '# Must not duplicate results');
    write('.secret/private.md', '# Must not appear');
    server = new WikiMCPServer({ wikiPath: root });
    client = new Client({ name: 'protocol-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });
  afterEach(async () => {
    await client.close();
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('discovers read-only navigation tools and works without a code index or model', async () => {
    const list = await client.listTools();
    expect(list.tools.map(tool => tool.name)).toEqual(expect.arrayContaining(['get_knowledge_manifest', 'search_wiki', 'get_wiki_page', 'get_related_pages']));
    expect(list.tools.every(tool => tool.annotations?.readOnlyHint)).toBe(true);
    const result = await call('get_knowledge_manifest');
    expect(result.structuredContent).toMatchObject({ pageCount: 3, codeSearchAvailable: false, export: null });
    expect(result.structuredContent.entrypoints[0].path).toBe('README.md');
    const unavailable = await call('search_code', { query: 'authentication' });
    expect(unavailable.isError).toBe(true);
    expect(unavailable.content[0].text).toContain('wiki search remains available');
  });

  it('finds short identifiers and returns structured filtered results with excerpts and provenance', async () => {
    const result = await call('search_wiki', { query: 'API', type: 'component', tag: 'SECURITY', format: 'json' });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent.total).toBe(0);
    const login = await call('search_wiki', { query: 'login', category: 'architecture', format: 'json' });
    expect(login.structuredContent.results).toHaveLength(1);
    expect(login.structuredContent.results[0]).toMatchObject({ path: 'architecture/auth.md', trust: 'unverified', sources: [{ resource: 'https://example.com/auth.ts' }] });
    expect(login.structuredContent.results[0].headings.map((heading: any) => heading.id)).toContain('login-flow');
    expect(JSON.parse(login.content[0].text)).toEqual(login.structuredContent);
    const api = await call('search_wiki', { query: 'API' });
    expect(api.structuredContent.results[0].path).toBe('API Notes.md');
  });

  it('reads a specific section including child sections but excluding its next sibling', async () => {
    const result = await call('get_wiki_page', { path: 'architecture/auth', section: 'login-flow', format: 'json' });
    expect(result.structuredContent.content).toContain('Verify the issuer');
    expect(result.structuredContent.content).not.toContain('## Storage');
    expect(result.structuredContent.metadata.sources).toEqual([{ resource: 'https://example.com/auth.ts' }]);
    expect(result.structuredContent.nextStartLine).toBeNull();
  });

  it('supports bounded page and section continuation without repeating lines', async () => {
    const first = await call('get_wiki_page', { path: 'architecture/auth.md', section: 'login-flow', maxLines: 3 });
    const second = await call('get_wiki_page', { path: 'architecture/auth.md', section: 'login-flow', startLine: first.structuredContent.nextStartLine, maxLines: 3 });
    expect(first.structuredContent.truncated).toBe(true);
    expect(second.structuredContent.startLine).toBe(first.structuredContent.endLine + 1);
    expect(second.structuredContent.content).not.toContain('## Storage');
  });

  it('paginates page discovery, identifies duplicate headings, and ignores fenced headings', async () => {
    const first = await call('list_wiki_pages', { limit: 1 });
    expect(first.structuredContent).toMatchObject({ total: 3, offset: 0, nextOffset: 1 });
    expect(first.structuredContent.pages[0].headings.map((heading: any) => heading.id)).toEqual(['api', 'api-1', 'api-2']);
    const second = await call('list_wiki_pages', { offset: 1, limit: 2 });
    expect(second.structuredContent.nextOffset).toBeNull();
    expect(second.structuredContent.pages.map((page: any) => page.path)).not.toContain(first.structuredContent.pages[0].path);
  });

  it('traverses cross-links and backlinks without treating source URLs as wiki pages', async () => {
    const result = await call('get_related_pages', { path: 'README.md' });
    expect(result.structuredContent.results).toHaveLength(1);
    expect(result.structuredContent.results[0]).toMatchObject({ path: 'architecture/auth.md', direction: 'both' });
  });

  it('returns protocol errors for malformed arguments and unknown paths', async () => {
    for (const [name, args] of [
      ['search_wiki', {}], ['search_wiki', { query: 'login', maxResults: -1 }],
      ['get_wiki_page', { path: '../private.md' }], ['get_wiki_page', { path: 'README.md', maxLines: 401 }],
      ['get_wiki_page', { path: 'README.md', section: 'missing' }], ['list_wiki_pages', { limit: 0 }],
    ] as Array<[string, Record<string, unknown>]>) {
      expect((await call(name, args)).isError, `${name} ${JSON.stringify(args)}`).toBe(true);
    }
    await expect(client.readResource({ uri: 'wiki://../private.md' })).rejects.toThrow('not found');
  });

  it('serves raw Markdown resources including frontmatter and correctly encodes names', async () => {
    const resources = await client.listResources();
    expect(resources.resources).toHaveLength(3);
    expect(resources.resources.map(resource => resource.uri)).toContain('wiki://API%20Notes.md');
    const result = await client.readResource({ uri: 'wiki://architecture/auth.md' });
    expect(result.contents[0]).toMatchObject({ mimeType: 'text/markdown', text: fs.readFileSync(path.join(root, 'architecture/auth.md'), 'utf8') });
  });
});
