/**
 * Deterministic gates (REASONING.md §8, §12). Each gate either passes a proposal or rejects it with a reason code.
 * Gates never score relational value and never raise automation. Order fixes which reason is reported.
 */
import { ACTION_SURFACE, TARGETED_ACTIONS, type ReasonCode } from './vocabulary.ts';
import type { CandidateProposal, ReasoningEpisodeInput, RelationshipInput } from './types.ts';

/** Episode-level stops: L0 hard stops and invalid assessment end the episode before any proposal is considered. */
export function episodeStop(input: ReasoningEpisodeInput): ReasonCode | null {
  if (input.hardStops.risk === 'urgent_support') return 'hard_stop';
  if (!input.hardStops.assessmentValid) return 'invalid_input';
  return null;
}

/** Mirrors of the authoritative server gates (§8 L4). The server stays the authority; this refuses early. */
export function serverGate(r: RelationshipInput, now: string): ReasonCode | null {
  const g = r.gates;
  if (g.paused) return 'gate_paused';
  if (g.optedOut === true) return 'gate_opted_out';
  if (g.presetRevoked || !g.presetCategories.includes('support_preference')) return 'gate_preset';
  if (g.cooldownUntil !== undefined && Date.parse(g.cooldownUntil) > Date.parse(now)) return 'gate_cooldown';
  if (g.quietHoursNow === true) return 'gate_quiet_hours';
  return null;
}

/**
 * Proposal-level gates, in order: proposer dismissal → explicit intent → exclusion → target exists → server-gate
 * mirrors (recipient surface) → context expiry → conflict → evidence. Returns the first failing reason, or null.
 */
export function gateProposal(p: CandidateProposal, input: ReasoningEpisodeInput, expired: boolean): ReasonCode | null {
  if (p.dismissed) return p.dismissed;
  if (p.action === 'ABSTAIN' || p.action === 'DEFER') return null;
  const surface = ACTION_SURFACE[p.action];
  const intent = input.explicitIntent;

  // L2 explicit intent outranks every inferred pattern (P11).
  if (intent.wantsSpace) return 'explicit_intent';
  if (intent.doesNotWantToTalk && p.action === 'DIRECT_CHECK_IN') return 'explicit_intent';
  if (p.targetRef !== undefined && intent.excludedRefs.includes(p.targetRef)) return 'excluded';

  const rel = p.targetRef === undefined ? undefined : input.relationships.find(r => r.ref === p.targetRef);
  if (TARGETED_ACTIONS.includes(p.action) && !rel) return 'invalid_input';
  if (p.targetRef !== undefined && !rel) return 'invalid_input';

  if (surface === 'recipient' && rel) {
    const gate = serverGate(rel, input.now);
    if (gate) return gate;
  }
  // P9/P14: an expired situation never produces an intervention; DEFER/ABSTAIN remain.
  if (expired) return 'context_expired';
  // L1 conflict lowers automation: no recipient-facing action at all (P8).
  if (surface === 'recipient' && (input.hardStops.risk === 'interpersonal_conflict' || rel?.conflict === 'unresolved')) return 'conflict';
  // Any intervention must cite evidence present in this episode.
  const known = new Set(input.evidence);
  if (p.evidenceRefs.length === 0 || !p.evidenceRefs.every(e => known.has(e))) return 'unsupported_by_evidence';
  return null;
}
