/**
 * DS activity-ranking evaluation over labeled synthetic cases. Pure: the caller supplies fixtures.
 * Relevance labels are DS author labels written before any run; teammate 1–5 usefulness ratings are tracked separately.
 */
import { rankActivities, soonestFirstBaseline, type ActivityRankInput, type ActivityRankResult } from './rank.ts';

export interface ActivityCase {
  id: string;
  group: 'positive' | 'no_action';
  agreed: ActivityRankInput['agreed'];
  catalogue: 'all' | string[];
  approvedInterests: ActivityRankInput['approvedInterests'];
  expected: {
    kind: 'ranked' | 'no_suggestion';
    reason?: string;
    suggestionIds?: string[];
    relevantTop1?: string[];
    relevant?: string[];
    mustNotSuggest?: string[];
    forbidRationale?: string[];
  };
}
export interface CaseFile { clock: string; utcOffsetMinutes: number; neverSuggest: string[]; cases: ActivityCase[] }
export interface CatalogueFile { allowedSourceSites: string[]; items: { activityId?: string }[] }

export interface CaseOutcome {
  id: string; group: ActivityCase['group']; result: ActivityRankResult;
  top1Relevant: boolean | null; precisionAt3: number | null; falseSuggestions: string[];
  noActionCorrect: boolean | null; noActionReasonMatch: boolean | null;
}
export interface Summary {
  ranker: string; cases: number; positive: number; noAction: number;
  top1Relevant: number; meanPrecisionAt3: number; casesWithFalseSuggestion: number; falseSuggestionCount: number;
  noActionCorrect: number; noActionReasonMatch: number; missedPositives: number; outcomes: CaseOutcome[];
}

export function inputFor(c: ActivityCase, cases: CaseFile, catalogue: CatalogueFile): ActivityRankInput {
  const rows = c.catalogue === 'all' ? catalogue.items
    : c.catalogue.map(id => {
      const row = catalogue.items.find(i => i.activityId === id);
      if (!row) throw new Error(`case ${c.id}: unknown catalogue row ${id}`);
      return row;
    });
  return { agreed: c.agreed, catalogue: structuredClone(rows), approvedInterests: c.approvedInterests,
    now: new Date(cases.clock), utcOffsetMinutes: cases.utcOffsetMinutes, allowedSourceSites: catalogue.allowedSourceSites };
}

export function evaluate(name: string, rank: (i: ActivityRankInput) => ActivityRankResult, cases: CaseFile,
  catalogue: CatalogueFile): Summary {
  const outcomes: CaseOutcome[] = cases.cases.map(c => {
    const result = rank(inputFor(c, cases, catalogue));
    const ids = result.kind === 'ranked' ? result.suggestions.map(s => s.activityId) : [];
    const banned = new Set([...cases.neverSuggest, ...(c.expected.mustNotSuggest ?? [])]);
    const falseSuggestions = c.group === 'no_action' ? ids : ids.filter(id => banned.has(id));
    const positive = c.group === 'positive';
    const relevant = new Set(c.expected.relevant ?? []);
    return {
      id: c.id, group: c.group, result, falseSuggestions,
      top1Relevant: positive ? ids.length > 0 && (c.expected.relevantTop1 ?? []).includes(ids[0]!) : null,
      precisionAt3: positive ? (ids.length === 0 ? 0 : ids.slice(0, 3).filter(id => relevant.has(id)).length / Math.min(3, ids.length)) : null,
      noActionCorrect: positive ? null : result.kind === 'no_suggestion',
      noActionReasonMatch: positive ? null : result.kind === 'no_suggestion' && result.reason === c.expected.reason,
    };
  });
  const pos = outcomes.filter(o => o.group === 'positive'), neg = outcomes.filter(o => o.group === 'no_action');
  return {
    ranker: name, cases: outcomes.length, positive: pos.length, noAction: neg.length,
    top1Relevant: pos.filter(o => o.top1Relevant).length,
    meanPrecisionAt3: pos.reduce((s, o) => s + (o.precisionAt3 ?? 0), 0) / Math.max(1, pos.length),
    casesWithFalseSuggestion: outcomes.filter(o => o.falseSuggestions.length > 0).length,
    falseSuggestionCount: outcomes.reduce((s, o) => s + o.falseSuggestions.length, 0),
    noActionCorrect: neg.filter(o => o.noActionCorrect).length,
    noActionReasonMatch: neg.filter(o => o.noActionReasonMatch).length,
    missedPositives: pos.filter(o => o.result.kind === 'no_suggestion').length,
    outcomes,
  };
}

export const RANKERS = { ds_rules_v1: rankActivities, baseline_soonest_first: soonestFirstBaseline } as const;
