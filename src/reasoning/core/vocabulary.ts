/**
 * Reasoning v1 vocabulary (D052, docs/features/REASONING.md §2, §10).
 *
 * The deterministic core is the constraint and validation foundation for the later agentic runtime. It never weighs
 * relational value; it gates, caps, enforces the context window and explicit intent, validates and breaks exact ties.
 * Only type imports from @dor/contracts, so the core runs in the browser, the worker and tests without a build step.
 */
import type { Nudge, SupportMode } from '@dor/contracts';

/** Ordered by automation: abstain < defer < ask < act. */
export const REASONING_MODES = ['abstain', 'defer', 'ask', 'act'] as const;
export type ReasoningMode = (typeof REASONING_MODES)[number];
export const modeRank = (m: ReasoningMode): number => REASONING_MODES.indexOf(m);
export const lowerMode = (a: ReasoningMode, b: ReasoningMode): ReasoningMode => (modeRank(a) <= modeRank(b) ? a : b);

export const CANDIDATE_ACTIONS = [
  'DIRECT_CHECK_IN', 'CASUAL_INVITE', 'SHARED_ACTIVITY', 'CELEBRATE', 'PRACTICAL_HELP', 'RECONNECT',
  'HELP_USER_REACH_OUT', 'ASK', 'DEFER', 'ABSTAIN',
] as const;
export type CandidateAction = (typeof CANDIDATE_ACTIONS)[number];

/** recipient = reaches the other person (only via the existing D050 path); owner = shown to the user only. */
export const ACTION_SURFACES = ['recipient', 'owner', 'none'] as const;
export type ActionSurface = (typeof ACTION_SURFACES)[number];
export const ACTION_SURFACE: Record<CandidateAction, ActionSurface> = {
  DIRECT_CHECK_IN: 'recipient', CASUAL_INVITE: 'recipient', SHARED_ACTIVITY: 'recipient', CELEBRATE: 'recipient',
  PRACTICAL_HELP: 'recipient', RECONNECT: 'recipient', HELP_USER_REACH_OUT: 'owner', ASK: 'owner',
  DEFER: 'none', ABSTAIN: 'none',
};

/** Actions that need a person. ASK may or may not name one. */
export const TARGETED_ACTIONS: readonly CandidateAction[] = [
  'DIRECT_CHECK_IN', 'CASUAL_INVITE', 'SHARED_ACTIVITY', 'CELEBRATE', 'PRACTICAL_HELP', 'RECONNECT', 'HELP_USER_REACH_OUT',
];

/**
 * Existing delivery vocabulary (REASONING.md §9 C3). Only these recipient actions can become `act`; the rest are capped
 * to `ask` until a reviewed template exists. The template is intent, not a guarantee (§9 C11).
 */
export const DELIVERY_MAPPING: Partial<Record<CandidateAction, { supportMode: SupportMode; intendedTemplate: Nudge['templateId'] }>> = {
  DIRECT_CHECK_IN: { supportMode: 'short_call', intendedTemplate: 'offer_short_call' },
  CASUAL_INVITE: { supportMode: 'shared_activity', intendedTemplate: 'offer_shared_activity' },
  SHARED_ACTIVITY: { supportMode: 'shared_activity', intendedTemplate: 'offer_shared_activity' },
};

/** Descriptive levels, never summed into a score. */
export const LEVELS = ['none', 'low', 'medium', 'high', 'unknown'] as const;
export type Level = (typeof LEVELS)[number];
export const atLeastMedium = (l: Level): boolean => l === 'medium' || l === 'high';

export const POSITIVE_FACTORS = [
  'relational_value', 'personal_fit', 'relationship_fit', 'timing_quality', 'mutual_receptiveness', 'past_success', 'naturalness',
] as const;
export const NEGATIVE_FACTORS = [
  'awkwardness', 'interruption_cost', 'human_ownership_cost', 'notification_fatigue', 'saturation', 'uncertainty',
  'conflict_risk', 'staleness',
] as const;
export type Factor = (typeof POSITIVE_FACTORS)[number] | (typeof NEGATIVE_FACTORS)[number];

export const REASON_CODES = [
  // core gates and caps
  'hard_stop', 'invalid_input', 'explicit_intent', 'excluded', 'gate_paused', 'gate_opted_out', 'gate_cooldown',
  'gate_quiet_hours', 'gate_preset', 'no_delivery_path', 'context_expired', 'conflict', 'sensitive_topic',
  'high_reveal_value', 'low_confidence', 'unsupported_by_evidence', 'unnamed_target', 'outranked', 'not_proposed',
  'no_reassessment_condition',
  // contextual (proposer)
  'not_receptive', 'unavailable', 'saturated_vs_baseline', 'above_baseline', 'already_with_people', 'recovered',
  'pattern_prefers_alone', 'pattern_prefers_company', 'no_relational_value', 'explained_silence', 'mutual_opening',
  'preserve_personal_delivery', 'distress_still_relevant',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export const REASSESS_CONDITIONS = ['distress_still_relevant', 'still_wants_connection', 'target_available', 'situation_unchanged'] as const;
export type ReassessCondition = (typeof REASSESS_CONDITIONS)[number];

export const RISKS = ['none', 'interpersonal_conflict', 'urgent_support'] as const;
export type Risk = (typeof RISKS)[number];

/** Mirrors contracts SIGNAL_LIFETIME_MS (24 h); a triggered signal never outlives it (REASONING.md §9 C4). */
export const SIGNAL_LIFETIME_MINUTES = 24 * 60;
