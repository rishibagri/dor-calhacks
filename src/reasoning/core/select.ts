/**
 * Selection (REASONING.md §12). Keeps the proposer's ranking; never re-ranks by a score. On an exact rank tie the
 * less automated option wins, then the target ref. No surviving proposal means `abstain` (P1).
 */
import { modeRank, type ReasoningMode } from './vocabulary.ts';
import type { CandidateProposal } from './types.ts';

export interface Survivor { proposal: CandidateProposal; mode: ReasoningMode }

export function compareSurvivors(a: Survivor, b: Survivor): number {
  return a.proposal.rank - b.proposal.rank ||
    modeRank(a.mode) - modeRank(b.mode) ||
    (a.proposal.targetRef ?? '').localeCompare(b.proposal.targetRef ?? '') ||
    a.proposal.action.localeCompare(b.proposal.action);
}

export function selectSurvivor(survivors: readonly Survivor[]): Survivor | null {
  return [...survivors].sort(compareSurvivors)[0] ?? null;
}
