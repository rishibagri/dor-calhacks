/**
 * DS activity-ranking evaluation over labeled synthetic cases. Pure: the caller supplies fixtures.
 * Relevance labels are DS author labels written before any run; teammate 1–5 usefulness ratings are tracked separately.
 */
import { rankActivities, soonestFirstBaseline, type ActivityRankInput, type ActivityRankResult } from './rank.ts';
import { mostTagsBaseline, rankNearby, type NearbyInput } from './nearby.ts';
import type { DiscoveryMode, DiscoveryShortlist, DiscoveryViewer } from '../features/discovery/types.ts';

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

// ---- Nearby/event shortlist evaluation ----

export interface NearbyCase {
  id: string; group: 'positive' | 'no_action'; viewer: string; mode: DiscoveryMode; candidates: 'all' | 'generated60' | string[];
  expected: { kind: 'shortlist' | 'none'; reason?: string; refs?: string[]; truncated?: boolean; relevantTop1?: string[];
    relevant?: string[]; mustNotSuggest?: string[]; reasonsOf?: Record<string, string[]> };
}
export interface NearbyCaseFile { clock: string; cases: NearbyCase[] }
export interface NearbyPoolFile { allowedTags: string[]; viewers: Record<string, DiscoveryViewer>; candidates: { ref: string }[] }

export function nearbyInputFor(c: NearbyCase, file: NearbyCaseFile, pool: NearbyPoolFile): NearbyInput {
  const template = pool.candidates.find(r => r.ref === 'c-10')!;
  const rows = c.candidates === 'all' ? pool.candidates
    : c.candidates === 'generated60'
      ? Array.from({ length: 60 }, (_, i) => ({ ...template, ref: `g-${String(i).padStart(3, '0')}`, displayName: `Synthetic ${i}` }))
      : c.candidates.map(ref => {
        const row = pool.candidates.find(r => r.ref === ref);
        if (!row) throw new Error(`case ${c.id}: unknown candidate ${ref}`);
        return row;
      });
  const viewer = pool.viewers[c.viewer];
  if (!viewer) throw new Error(`case ${c.id}: unknown viewer ${c.viewer}`);
  return { viewer: structuredClone(viewer), candidates: structuredClone(rows), mode: c.mode, allowedTags: pool.allowedTags,
    now: new Date(file.clock) };
}

export interface NearbySummary {
  ranker: string; cases: number; positive: number; noAction: number; top1Relevant: number; meanPrecisionAt3: number;
  casesWithFalseMatch: number; falseMatchCount: number; noActionCorrect: number; noActionReasonMatch: number;
  missedPositives: number; outcomes: { id: string; result: DiscoveryShortlist; falseMatches: string[] }[];
}

export function evaluateNearby(name: string, rank: (i: NearbyInput) => DiscoveryShortlist, file: NearbyCaseFile,
  pool: NearbyPoolFile): NearbySummary {
  const rows = file.cases.map(c => {
    const result = rank(nearbyInputFor(c, file, pool));
    const refs = result.kind === 'shortlist' ? result.entries.map(e => e.ref) : [];
    const banned = new Set(c.expected.mustNotSuggest ?? []);
    const falseMatches = c.group === 'no_action' ? refs : refs.filter(r => banned.has(r));
    const relevant = new Set(c.expected.relevant ?? []);
    return { c, result, refs, falseMatches,
      top1: c.group === 'positive' && refs.length > 0 && (c.expected.relevantTop1 ?? []).includes(refs[0]!),
      p3: refs.length === 0 ? 0 : refs.slice(0, 3).filter(r => relevant.has(r)).length / Math.min(3, refs.length) };
  });
  const pos = rows.filter(r => r.c.group === 'positive'), neg = rows.filter(r => r.c.group === 'no_action');
  return {
    ranker: name, cases: rows.length, positive: pos.length, noAction: neg.length,
    top1Relevant: pos.filter(r => r.top1).length,
    meanPrecisionAt3: pos.reduce((s, r) => s + r.p3, 0) / Math.max(1, pos.length),
    casesWithFalseMatch: rows.filter(r => r.falseMatches.length > 0).length,
    falseMatchCount: rows.reduce((s, r) => s + r.falseMatches.length, 0),
    noActionCorrect: neg.filter(r => r.result.kind === 'none').length,
    noActionReasonMatch: neg.filter(r => r.result.kind === 'none' && r.result.reason === r.c.expected.reason).length,
    missedPositives: pos.filter(r => r.result.kind === 'none').length,
    outcomes: rows.map(r => ({ id: r.c.id, result: r.result, falseMatches: r.falseMatches })),
  };
}

export const NEARBY_RANKERS = { ds_nearby_v1: rankNearby, baseline_most_tags: mostTagsBaseline } as const;
