import * as fs from 'node:fs';
import * as path from 'node:path';

/** Resolve tool-supplied paths without allowing traversal or symlink escapes. */
export function containedPath(root: string, relativePath: string): string {
  if (typeof relativePath !== 'string' || relativePath.includes('\0') || path.isAbsolute(relativePath) || /^[A-Za-z]:/.test(relativePath) || relativePath.includes('\\')) {
    throw new Error('Expected a relative path inside the selected directory.');
  }
  const base = fs.realpathSync(root);
  const target = path.resolve(base, relativePath);
  const inside = (candidate: string) => candidate === base || candidate.startsWith(base + path.sep);
  if (!inside(target)) throw new Error('Path must stay inside the selected directory.');
  let existing = target;
  while (!fs.existsSync(existing)) {
    // A dangling symlink must not be followed by a subsequent write.
    try { if (fs.lstatSync(existing).isSymbolicLink()) throw new Error('Dangling symlink path.'); }
    catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    existing = path.dirname(existing);
  }
  if (!inside(fs.realpathSync(existing))) throw new Error('Symlink path leaves the selected directory.');
  return target;
}

export function wikiPagePath(root: string, relativePath: string): string {
  if (!relativePath?.toLowerCase().endsWith('.md') || relativePath.split('/').some(part => part.startsWith('.') || ['site', 'knowledge', 'node_modules'].includes(part))) {
    throw new Error('Wiki pages must be Markdown files outside managed asset directories.');
  }
  return containedPath(root, relativePath);
}
