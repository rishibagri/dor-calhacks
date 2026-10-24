/**
 * D047 standing-rule automatic nudges: constants, types and state (CS). Runtime-dependency-free like policy.ts, which
 * re-exports this file and holds the guards (`guardRuleCreation`, `guardRuleApproval`) because they reuse the F3/F4
 * evaluation there. A rule is an explicit, revocable, time-bounded owner choice for ONE accepted pair that lets the
 * owner's client approve a matching signal without the per-item preview. It only ever narrows the pair's current
 * preset/assignment, which stays the ceiling; it is never created by a quiz, preset, journal, model or recipient.
 */

/** Shortest rule an owner can set. */
export const STANDING_RULE_MIN_MS = 60 * 60 * 1000;
/** Longest rule an owner can set; a longer wish is a new, explicit renewal. */
export const STANDING_RULE_MAX_MS = 30 * 24 * 60 * 60 * 1000;
/** Fixed purpose enum. Free text is never a purpose. */
export const STANDING_RULE_PURPOSES = ['support_check_in'] as const;
export type StandingRulePurpose = (typeof STANDING_RULE_PURPOSES)[number];

/** The owner's rule as stored (times as epoch ms). */
export interface StandingRuleState {
  ruleId: string;
  ownerId: string;
  pairId: string;
  supportModes: readonly string[];
  availability: readonly string[];
  purpose: string;
  /** Bumped on every set and every revoke; signals approved under an older version never deliver. */
  version: number;
  expiresAtMs: number;
  revokedAtMs: number | null;
  /** Set by the expiry sweep (clockless views). */
  expiredMarked: boolean;
}

/** Whether the rule is in force. `nowMs` null only in clockless views, where the sweep marker is the expiry control. */
export function standingRuleActive(r: StandingRuleState | null, nowMs: number | null): boolean {
  return Boolean(r && r.revokedAtMs === null && !r.expiredMarked && (nowMs === null || r.expiresAtMs > nowMs));
}
