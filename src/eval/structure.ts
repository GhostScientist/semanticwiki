/**
 * Deterministic structure checks for a wiki page, including a lightweight
 * Mermaid syntax check. These catch breakage, not quality; see reward.ts for how
 * they are weighted.
 */
import { extractHeadings } from '../wiki-catalog.js';

export interface StructureReport {
  words: number;
  checks: Record<string, boolean>;
  passed: number;
  total: number;
}

export interface DiagramCheck { pageLine: number; type: string; valid: boolean; reason?: string }
export interface DiagramReport { total: number; valid: number; invalid: number; checker: 'lightweight'; details: DiagramCheck[] }

const STUB_PATTERNS = [/\b(?:TODO|TBD|FIXME)\b/, /\(?\.\.\.\s*truncated\)?/i, /lorem ipsum/i, /\[(?:insert|placeholder)[^\]]*\]/i];

export function wordCount(markdown: string): number {
  return markdown.split(/\s+/).filter(Boolean).length;
}

export function checkStructure(markdown: string): StructureReport {
  const headings = extractHeadings(markdown);
  const words = wordCount(markdown);
  const h1Count = headings.filter(heading => heading.level === 1).length;
  const fenceMarkers = markdown.split('\n').filter(line => /^ {0,3}(`{3,}|~{3,})/.test(line)).length;
  const checks = {
    has_h1: h1Count >= 1,
    single_h1: h1Count === 1,
    has_h2: headings.some(heading => heading.level === 2),
    fences_closed: fenceMarkers % 2 === 0,
    no_stub_markers: !STUB_PATTERNS.some(pattern => pattern.test(markdown)),
    word_count_ok: words >= 150 && words <= 5000,
  };
  const passed = Object.values(checks).filter(Boolean).length;
  return { words, checks, passed, total: Object.keys(checks).length };
}

const DIAGRAM_TYPES = /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|pie|journey|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|C4Context|C4Container|C4Component|sankey-beta|xychart-beta|block-beta|packet-beta|kanban|architecture-beta)\b/;

function bracketsBalanced(body: string): string | undefined {
  const pairs: Record<string, string> = { '[': ']', '(': ')', '{': '}' };
  const closers = new Set(Object.values(pairs));
  const stack: string[] = [];
  let quote: string | undefined;
  for (const line of body.split('\n')) {
    if (line.trim().startsWith('%%')) continue;
    for (const char of line) {
      if (quote) { if (char === quote) quote = undefined; continue; }
      if (char === '"') { quote = char; continue; }
      if (pairs[char]) stack.push(pairs[char]);
      else if (closers.has(char)) {
        if (stack.pop() !== char) return `unexpected "${char}"`;
      }
    }
    quote = undefined; // a quote never spans lines in Mermaid labels
  }
  return stack.length ? `unclosed "${stack[stack.length - 1]}"` : undefined;
}

export function checkMermaidSource(source: string): { type: string; valid: boolean; reason?: string } {
  const lines = source.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('%%'));
  if (lines.length === 0) return { type: 'unknown', valid: false, reason: 'empty diagram' };
  const header = lines[0].replace(/^---[\s\S]*?---\s*/, '');
  const typeMatch = header.match(DIAGRAM_TYPES);
  if (!typeMatch) return { type: 'unknown', valid: false, reason: `unknown diagram type "${header.slice(0, 30)}"` };
  const type = typeMatch[1];
  if (lines.length < 2) return { type, valid: false, reason: 'diagram has no body' };
  const body = lines.slice(1).join('\n');
  if (/^(graph|flowchart)$/.test(type)) {
    const direction = header.slice(type.length).trim();
    if (direction && !/^(TD|TB|BT|LR|RL)\b/.test(direction)) return { type, valid: false, reason: `invalid direction "${direction}"` };
    const opened = (body.match(/^\s*subgraph\b/gm) || []).length;
    const closed = (body.match(/^\s*end\b/gm) || []).length;
    if (opened !== closed) return { type, valid: false, reason: `subgraph/end mismatch (${opened}/${closed})` };
    if (!/-->|---|-\.->|==>|--[^-]*-->|-->\|/.test(body) && !/^\s*[\w"]+(\[|\(|\{)/m.test(body)) return { type, valid: false, reason: 'no nodes or edges' };
  }
  if (type === 'sequenceDiagram' && !/(-->>|->>|-->|->|-x|--x|-\)|--\))/.test(body)) return { type, valid: false, reason: 'no messages' };
  if (/^(graph|flowchart|classDiagram|stateDiagram|stateDiagram-v2|erDiagram)$/.test(type)) {
    const reason = bracketsBalanced(body);
    if (reason) return { type, valid: false, reason };
  }
  return { type, valid: true };
}

export function checkDiagrams(markdown: string): DiagramReport {
  const details: DiagramCheck[] = [];
  const lines = markdown.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const open = lines[index].match(/^ {0,3}(`{3,}|~{3,})\s*mermaid\b/i);
    if (!open) continue;
    const start = index + 1;
    let end = start;
    while (end < lines.length && !(lines[end].startsWith(open[1][0].repeat(open[1].length)))) end++;
    details.push({ pageLine: start, ...checkMermaidSource(lines.slice(start, end).join('\n')) });
    index = end;
  }
  const valid = details.filter(detail => detail.valid).length;
  return { total: details.length, valid, invalid: details.length - valid, checker: 'lightweight', details };
}
