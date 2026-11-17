/**
 * Page reward: the single number the harness, the eval command and the training loop
 * agree on. It is a weighted sum of verifiable components followed by guards that close
 * the exploits observed in the v3 evaluation data (see docs/research/REWARD_LOOP.md).
 *
 * The Python mirror in research/semanticwiki_reward/reward.py must produce identical
 * values for tests/fixtures/reward-conformance.json.
 */
import type { VerifiedCitation } from './citations.js';
import { checkDiagrams, checkStructure, type DiagramReport, type StructureReport } from './structure.js';

export const REWARD_VERSION = 1;

export const WEIGHTS = {
  validity: 0.25,
  grounding: 0.15,
  precision: 0.15,
  support: 0.20,
  density: 0.10,
  structure: 0.10,
  diagrams: 0.05,
} as const;

export type Component = keyof typeof WEIGHTS;

export interface Guard { name: string; effect: 'multiply' | 'cap' | 'zero'; value: number; reason: string }

export interface CitationSummary {
  total: number;
  unique: number;
  valid: number;
  validInContext: number;
  statuses: Record<string, number>;
}

export interface PageScore {
  rewardVersion: number;
  citations: CitationSummary;
  components: Record<Component, number>;
  base: number;
  guards: Guard[];
  reward: number;
  structure: StructureReport;
  diagrams: DiagramReport;
}

export interface PageScoreInput {
  markdown: string;
  citations: VerifiedCitation[];
  /** When known, a non-end_turn stop reason zeroes the reward: truncated pages are never rewarded. */
  stopReason?: 'end_turn' | 'max_tokens' | 'tool_use' | 'error';
}

const round3 = (value: number): number => Math.round(value * 1000) / 1000;
const mean = (values: number[]): number => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);

/**
 * Tight spans earn full credit; wide spans decay; whole-file citations of a non-trivial
 * file earn nothing. Small files (80 lines or fewer) may be cited wholesale.
 */
export function precisionWeight(spanLines: number, fileLines: number): number {
  if (fileLines > 0 && fileLines <= 80) return 1;
  if (fileLines > 0 && spanLines >= fileLines) return 0;
  let weight = spanLines <= 40 ? 1 : Math.max(0, 1 - (spanLines - 40) / 360);
  if (fileLines > 0 && spanLines / fileLines > 0.5) weight = Math.min(weight, 0.25);
  return round3(weight);
}

export function summarizeCitations(citations: VerifiedCitation[]): CitationSummary {
  const statuses: Record<string, number> = {};
  for (const citation of citations) statuses[citation.status] = (statuses[citation.status] || 0) + 1;
  const unique = new Set(citations.map(citation => `${citation.file}:${citation.start}-${citation.end}`)).size;
  const valid = citations.filter(citation => citation.status === 'valid');
  return { total: citations.length, unique, valid: valid.length, validInContext: valid.filter(citation => citation.inContext).length, statuses };
}

export function scorePage(input: PageScoreInput): PageScore {
  const structure = checkStructure(input.markdown);
  const diagrams = checkDiagrams(input.markdown);
  const summary = summarizeCitations(input.citations);
  const valid = input.citations.filter(citation => citation.status === 'valid');
  const supported = valid.filter(citation => citation.claimSupport !== null);
  const expectedCitations = Math.max(3, Math.round(structure.words / 150));

  const components: Record<Component, number> = {
    validity: summary.total ? round3(summary.valid / summary.total) : 0,
    grounding: summary.total ? round3(summary.validInContext / summary.total) : 0,
    precision: round3(mean(valid.map(citation => precisionWeight(citation.spanLines, citation.fileLines)))),
    support: round3(mean(supported.map(citation => citation.claimSupport as number))),
    density: round3(Math.min(1, summary.unique / expectedCitations)),
    structure: round3(structure.passed / structure.total),
    diagrams: diagrams.total === 0 ? 0.5 : round3(diagrams.valid / diagrams.total),
  };

  const base = round3((Object.keys(WEIGHTS) as Component[]).reduce((sum, key) => sum + WEIGHTS[key] * components[key], 0));
  const guards: Guard[] = [];
  let reward = base;
  if (input.stopReason && input.stopReason !== 'end_turn') {
    guards.push({ name: 'truncated', effect: 'zero', value: 0, reason: `stop reason ${input.stopReason}` });
    reward = 0;
  }
  if (summary.total === 0) {
    guards.push({ name: 'uncited', effect: 'multiply', value: 0.25, reason: 'page makes no verifiable claims' });
    reward *= 0.25;
  } else {
    const missing = (summary.statuses['file-not-found'] || 0) + (summary.statuses['outside-repository'] || 0);
    if (missing / summary.total >= 0.5) {
      guards.push({ name: 'hallucinated-paths', effect: 'cap', value: 0.3, reason: `${missing}/${summary.total} citations name files that do not exist` });
      reward = Math.min(reward, 0.3);
    }
    if (summary.unique / summary.total < 0.5) {
      guards.push({ name: 'duplicate-citations', effect: 'multiply', value: 0.5, reason: `${summary.unique} unique of ${summary.total} citations` });
      reward *= 0.5;
    }
  }
  return { rewardVersion: REWARD_VERSION, citations: summary, components, base, guards, reward: round3(reward), structure, diagrams };
}
