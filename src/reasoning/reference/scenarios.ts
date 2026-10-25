/**
 * TEST-ONLY loader for src/reasoning/fixtures/scenarios.synthetic.json. Fills the documented defaults and runs a
 * scenario through the reference policy and the real core. Never imported by core or production code.
 */
import { readFileSync } from 'node:fs';
import { finalize } from '../core/finalize.ts';
import type { CandidateProposal, FinalizeOptions, GateMirror, ReasoningDecision, ReasoningEpisodeInput, RelationshipInput } from '../core/types.ts';
import { referenceProposals, type ReferenceContext } from './reference-policy.ts';

export interface Scenario {
  id: string;
  title: string;
  demonstrates: string[];
  offlineOnly?: string;
  options?: FinalizeOptions;
  episode: {
    hardStops?: ReasoningEpisodeInput['hardStops'];
    explicitIntent?: Partial<ReasoningEpisodeInput['explicitIntent']>;
    window: ReasoningEpisodeInput['window'];
    evidence: string[];
    relationships: (Partial<Omit<RelationshipInput, 'gates'>> & { ref: string; gates?: Partial<GateMirror> })[];
  };
  context: ReferenceContext;
  adversarialProposals?: CandidateProposal[];
  expected: {
    mode: ReasoningDecision['mode'];
    action?: string;
    targetRef?: string;
    surface?: string;
    timing?: string;
    freshness?: string;
    cappedBy?: string;
    reasons?: string[];
    reassess?: ReasoningDecision['reassess'];
    rejected?: { action: string; reason: string; targetRef?: string }[];
  };
}

const file = JSON.parse(readFileSync(new URL('../fixtures/scenarios.synthetic.json', import.meta.url), 'utf8')) as
  { now: string; scenarios: Scenario[] };
export const SCENARIOS: readonly Scenario[] = file.scenarios;
export const NOW = file.now;

export const OPEN_GATES: GateMirror = {
  paused: false, optedOut: false, quietHoursNow: false, presetRevoked: false,
  presetCategories: ['support_preference', 'coarse_availability'],
};

export function buildInput(s: Scenario): ReasoningEpisodeInput {
  const e = s.episode;
  return {
    schemaVersion: 1, episodeId: s.id, now: NOW,
    hardStops: e.hardStops ?? { risk: 'none', assessmentValid: true },
    explicitIntent: { wantsSpace: false, doesNotWantToTalk: false, excludedRefs: [], namedRefs: [], ...e.explicitIntent },
    window: e.window,
    relationships: e.relationships.map(r => ({
      ref: r.ref, gates: { ...OPEN_GATES, ...r.gates }, conflict: r.conflict ?? 'none', sensitiveTopics: r.sensitiveTopics ?? [],
    })),
    evidence: e.evidence,
  };
}

export function proposalsFor(s: Scenario, input = buildInput(s)): CandidateProposal[] {
  return [...(s.adversarialProposals ?? []), ...referenceProposals(input, s.context)];
}

export function runScenario(s: Scenario, overrides: { input?: ReasoningEpisodeInput; options?: FinalizeOptions } = {}): ReasoningDecision {
  const input = overrides.input ?? buildInput(s);
  return finalize(input, proposalsFor(s, input), overrides.options ?? s.options ?? {});
}
