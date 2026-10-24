/**
 * D044 automatic nudges: owner standing consent (Cyber; README "Existing-connection privacy decision — D044").
 * Runtime-dependency-free so the module enforces the same rules (re-exported from `@dor/contracts/policy`).
 *
 * Per-nudge sender preview becomes optional ONLY for a pair where the owner explicitly set a revocable, expiring,
 * category-limited standing rule. Off by default. Never granted by onboarding answers, a preset, a journal entry, an
 * assessment, model confidence, a provider or the recipient. The recipient's own opt-in and support consent, the
 * D041 pause, expiry, quiet hours, cooldown and revocation are all still checked at delivery. It never grants
 * discovery publication or event consent.
 */
import { SHARING_CATEGORIES } from './enums.js';

/** Version of the standing-consent notice ("matching future nudges may be delivered without item-by-item review"). */
export const STANDING_CONSENT_VERSION = 1;
export const STANDING_RULE_MAX_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
export const STANDING_RULE_MIN_LIFETIME_MS = 60 * 60 * 1000;
export const STANDING_PURPOSE = 'support_nudge' as const;

export type StandingDenyReason = 'invalid_schema' | 'not_participant' | 'pair_not_accepted' | 'no_preset' | 'blocked_category'
  | 'stale_policy' | 'too_long' | 'too_short' | 'paused' | 'no_rule' | 'revoked' | 'expired' | 'wrong_recipient';
type Deny = { ok: false; reason: StandingDenyReason };
const no = (reason: StandingDenyReason): Deny => ({ ok: false, reason });

export interface StandingPresetState { allowedCategories: readonly string[]; version: number; assignmentVersion: number; expiresAtMs: number; revoked: boolean }

/**
 * Setting (or replacing) a rule. The categories must be allowlisted C3 categories the owner's current preset for this
 * pair already allows (a ceiling, never broadened); the preset/assignment versions and the notice are the ones the
 * owner was shown; no active pause on that person.
 */
export function guardStandingRule(input: {
  pairAccepted: boolean; preset: StandingPresetState | null; categories: unknown; expiresAtMs: unknown;
  expectedPolicyVersion: unknown; expectedAssignmentVersion: unknown; noticeVersion: unknown; paused: boolean; nowMs: number;
}): { ok: true; categories: string[]; expiresAtMs: number } | Deny {
  const { preset, nowMs } = input;
  if (!input.pairAccepted) return no('pair_not_accepted');
  if (input.paused) return no('paused');
  const c = input.categories;
  if (!Array.isArray(c) || c.length === 0 || new Set(c).size !== c.length ||
    !c.every(x => (SHARING_CATEGORIES as readonly unknown[]).includes(x))) return no('invalid_schema');
  if (input.noticeVersion !== STANDING_CONSENT_VERSION) return no('stale_policy');
  if (!preset || preset.revoked || preset.expiresAtMs <= nowMs) return no('no_preset');
  if (input.expectedPolicyVersion !== preset.version || input.expectedAssignmentVersion !== preset.assignmentVersion) return no('stale_policy');
  if (!c.every(x => preset.allowedCategories.includes(x as string))) return no('blocked_category');
  if (!Number.isSafeInteger(input.expiresAtMs)) return no('invalid_schema');
  const exp = input.expiresAtMs as number;
  if (exp < nowMs + STANDING_RULE_MIN_LIFETIME_MS) return no('too_short');
  if (exp > nowMs + STANDING_RULE_MAX_LIFETIME_MS) return no('too_long');
  return { ok: true, categories: [...c] as string[], expiresAtMs: Math.min(exp, preset.expiresAtMs) };
}

export interface StandingRuleState {
  ruleId: string;
  ownerId: string;
  recipientId: string;
  pairId: string;
  categories: readonly string[];
  recipientPolicyVersion: number;
  presetAssignmentVersion: number;
  noticeVersion: number;
  version: number;
  expiresAtMs: number;
  revokedAtMs: number | null;
  /** Set by the expiry sweep (clockless views). */
  expiredMarked: boolean;
}

/**
 * Whether a rule still authorizes an automatic approval or the use of one: current, unrevoked, unexpired, same
 * owner/recipient/pair, unchanged preset versions, current notice, covering every category of the payload, and (for a
 * signal already approved under it) the exact rule version that approved it.
 */
export function standingRuleStands(rule: StandingRuleState | null, preset: StandingPresetState | null, expect: {
  ownerId: string; recipientId: string; pairId: string; categories: readonly string[]; ruleVersion?: number;
}, nowMs: number | null): StandingDenyReason | null {
  if (!rule) return 'no_rule';
  if (rule.ownerId !== expect.ownerId || rule.pairId !== expect.pairId) return 'no_rule';
  if (rule.recipientId !== expect.recipientId) return 'wrong_recipient';
  if (rule.revokedAtMs !== null) return 'revoked';
  if (rule.expiredMarked || (nowMs !== null && rule.expiresAtMs <= nowMs)) return 'expired';
  if (expect.ruleVersion !== undefined && expect.ruleVersion !== rule.version) return 'stale_policy';
  if (rule.noticeVersion !== STANDING_CONSENT_VERSION) return 'stale_policy';
  if (!preset || preset.revoked || preset.version !== rule.recipientPolicyVersion || preset.assignmentVersion !== rule.presetAssignmentVersion) {
    return 'stale_policy';
  }
  if (expect.categories.length === 0 || !expect.categories.every(c => rule.categories.includes(c))) return 'blocked_category';
  return null;
}

export type StandingErrorCode = 'invalid' | 'not_found' | 'stale' | 'unauthorized';
export function standingErrorCode(reason: StandingDenyReason): StandingErrorCode {
  switch (reason) {
    case 'invalid_schema':
    case 'too_long':
    case 'too_short':
    case 'pair_not_accepted': return 'invalid';
    case 'not_participant':
    case 'wrong_recipient': return 'not_found';
    case 'no_rule':
    case 'no_preset':
    case 'blocked_category':
    case 'paused': return 'unauthorized';
    default: return 'stale';
  }
}
