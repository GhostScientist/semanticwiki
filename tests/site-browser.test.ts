/** DOM integration tests execute the emitted script; they do not claim visual browser coverage. */
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SiteGenerator } from '../src/site-generator.js';
import { getClientScripts } from '../src/site/scripts.js';

let root: string;
let output: string;
let window: Window | undefined;
const read = (file: string) => fs.readFileSync(path.join(output, file), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 15));

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'semanticwiki-dom-'));
  const wiki = path.join(root, 'wiki');
  output = path.join(root, 'site');
  fs.mkdirSync(path.join(wiki, 'architecture'), { recursive: true });
  fs.writeFileSync(path.join(wiki, 'README.md'), '# Home\n\n## Welcome\n\nStart here.\n\n## Next steps\n\n[Read the guide](architecture/guide.md)');
  fs.writeFileSync(path.join(wiki, 'architecture/guide.md'), '# Architecture guide\n\n## Authentication\n\nAuthentication uses tokens.\n\n## Storage\n\nData lives here.\n\n[Home](../README.md)\n\n[Reference](../reference.md)');
  fs.writeFileSync(path.join(wiki, 'reference.md'), '# Reference\n\nNo table of contents on this page.');
  fs.appendFileSync(path.join(wiki, 'README.md'), '\n\n[Source](/tmp/example-repository/src/index.ts#L1-L3)');
  await new SiteGenerator({ wikiDir: wiki, outputDir: output, features: { guidedTour: false } }).generate();
});
afterEach(async () => { await window?.happyDOM.close(); window = undefined; });
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

async function boot(url = 'https://docs.example.test/project/README.html', storageUnavailable = false) {
  window = new Window({ url, settings: { enableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, suppressInsecureJavaScriptEnvironmentWarning: true } });
  const win = window;
  win.document.write(read('README.html'));
  const fetchMock = vi.fn(async (input: string) => {
    const file = new URL(String(input), url).pathname.replace('/project/', '');
    return { ok: true, text: async () => read(file) };
  });
  win.fetch = fetchMock as any;
  win.scrollTo = vi.fn() as any;
  win.HTMLElement.prototype.scrollIntoView = vi.fn();
  // This is a DOM simulation: visible geometry must be provided explicitly for focus-loop checks.
  win.HTMLElement.prototype.getClientRects = () => [{ width: 100, height: 24 }] as any;
  if (storageUnavailable) Object.defineProperty(win, 'localStorage', { get: () => { throw new Error('Storage blocked'); } });
  const clipboard = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(win.navigator, 'clipboard', { value: { writeText: clipboard }, configurable: true });
  win.eval(read('assets/manifest.js'));
  win.eval(read('assets/app.js'));
  win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
  await tick();
  return { win, fetchMock, clipboard };
}

function key(win: Window, target: any, name: string, options: Record<string, boolean> = {}) {
  target.dispatchEvent(new win.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...options }));
}

describe('emitted reader application', () => {
  it('searches offline data, selects a result, updates the whole page, and supports back navigation', async () => {
    const { win, fetchMock } = await boot();
    const doc = win.document;
    const trigger = doc.querySelector('.search-trigger') as any;
    trigger.focus();
    key(win, doc, 'k', { metaKey: true });
    await tick();
    const input = doc.querySelector('.search-input') as any;
    expect(doc.activeElement).toBe(input);
    expect(doc.querySelector('.search-modal')?.getAttribute('aria-hidden')).toBe('false');
    input.value = 'authentication tokens';
    input.dispatchEvent(new win.Event('input'));
    await new Promise(resolve => setTimeout(resolve, 130));
    expect(doc.querySelectorAll('.search-result')).toHaveLength(1);
    expect(doc.querySelector('.search-result')?.textContent).toContain('Architecture guide');
    expect(input.getAttribute('aria-activedescendant')).toBe('search-result-0');
    key(win, input, 'Enter');
    await tick();
    expect(doc.querySelector('h1')?.textContent).toBe('Architecture guide');
    expect(doc.querySelector('.nav-link[aria-current="page"]')?.textContent?.trim()).toBe('Architecture guide');
    expect(doc.querySelector('.toc-list')?.textContent).toContain('Authentication');
    expect(doc.querySelector('.page-markdown')?.textContent).toContain('Authentication uses tokens');
    expect(win.location.pathname).toBe('/project/architecture/guide.html');
    expect(doc.querySelector('.site-logo')?.getAttribute('href')).toBe('https://docs.example.test/project/index.html');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    win.history.back();
    await tick();
    expect(doc.querySelector('h1')?.textContent).toBe('Home');
    expect(win.location.pathname).toBe('/project/README.html');
  });

  it('keeps nested navigation, page tools, footer, and absent TOC in sync', async () => {
    const { win, clipboard } = await boot();
    const doc = win.document;
    const guide = [...doc.querySelectorAll('.nav-link')].find(link => link.textContent?.includes('Architecture guide')) as any;
    guide.click();
    await tick();
    (doc.querySelector('.copy-page') as any).click();
    await tick();
    expect(clipboard).toHaveBeenLastCalledWith(expect.stringContaining('# Architecture guide'));
    const reference = [...doc.querySelectorAll('.page-content a')].find(link => link.textContent === 'Reference') as any;
    reference.click();
    await tick();
    expect(doc.querySelector('h1')?.textContent).toBe('Reference');
    expect(doc.querySelector('.toc-list')).toBeNull();
    expect(doc.querySelector('.breadcrumbs')).toBeNull();
    expect(doc.querySelector('a[download]')?.getAttribute('href')).toBe('./source/reference.md');
    expect(win.location.pathname).toBe('/project/reference.html');
  });

  it('traps keyboard focus in search and returns it to the opener on Escape', async () => {
    const { win } = await boot();
    const trigger = win.document.querySelector('.search-trigger') as any;
    trigger.focus(); trigger.click();
    await tick();
    const input = win.document.querySelector('.search-input') as any;
    key(win, input, 'Tab', { shiftKey: true });
    expect(win.document.activeElement?.className).toBe('search-close');
    key(win, win.document.activeElement, 'Tab');
    expect(win.document.activeElement).toBe(input);
    key(win, input, 'Escape');
    await tick();
    expect(win.document.querySelector('.search-modal')?.getAttribute('aria-hidden')).toBe('true');
    expect(win.document.activeElement).toBe(trigger);
    expect(win.document.body.style.overflow).toBe('');
  });

  it('closes mobile navigation with Escape and reports its expanded state', async () => {
    const { win } = await boot();
    const toggle = win.document.querySelector('.mobile-menu-toggle') as any;
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(win.document.querySelector('.sidebar')?.classList.contains('open')).toBe(true);
    key(win, win.document, 'Escape');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(win.document.activeElement).toBe(toggle);
  });

  it('uses embedded search data on file:// without fetching and survives blocked storage', async () => {
    const { win, fetchMock } = await boot('file:///tmp/documentation/README.html', true);
    (win.document.querySelector('.search-trigger') as any).click();
    await tick();
    const input = win.document.querySelector('.search-input') as any;
    input.value = 'tokens'; input.dispatchEvent(new win.Event('input'));
    await new Promise(resolve => setTimeout(resolve, 130));
    expect(win.document.querySelector('.search-result')?.getAttribute('href')).toBe('file:///tmp/documentation/architecture/guide.html');
    expect(fetchMock).not.toHaveBeenCalled();
    (win.document.querySelector('.search-close') as any).click();
    (win.document.querySelector('.theme-toggle') as any).click();
    expect(win.document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
  it('opens a source citation as a useful location without navigating to a local filesystem URL', async () => {
    const { win, clipboard, fetchMock } = await boot();
    (win.document.querySelector('.source-link') as any).click();
    await tick();
    expect(win.document.querySelector('.code-explorer-modal')?.classList.contains('open')).toBe(true);
    expect(win.document.querySelector('.code-explorer-code')?.textContent).toContain('/tmp/example-repository/src/index.ts:1-3');
    expect(win.document.querySelector('.code-explorer-code')?.textContent).toContain('Source files are not bundled');
    (win.document.querySelector('.copy-source-reference') as any).click();
    await tick();
    expect(clipboard).toHaveBeenLastCalledWith('/tmp/example-repository/src/index.ts:1-3');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(win.location.pathname).toBe('/project/README.html');
  });

  it('renders chat content as text and rejects executable links while retaining Markdown formatting', async () => {
    const { win } = await boot();
    // Expose the emitted formatter for this behavior test without changing the production API.
    const script = getClientScripts({ aiChat: true }).replace(/\}\)\(\);\s*$/, 'window.__formatChatContent = formatChatContent; })();');
    win.eval(script);
    const html = (win as any).__formatChatContent('<img src=x onerror=alert(1)> **Important** [unsafe](javascript:alert) [guide](https://example.com)', []);
    const container = win.document.createElement('div');
    container.innerHTML = html;
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(container.querySelector('strong')?.textContent).toBe('Important');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
  });

});
