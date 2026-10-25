/**
 * finalize(input, proposals, options): the deterministic core's single entry point (REASONING.md §3.3, §12).
 * validate → context window → episode stops → per-proposal gates → caps → select → build and validate the decision.
 *
 * The core is the constraint and validation foundation, not the reasoning intelligence: proposals come from the
 * agentic runtime (in v1 tests, the labeled reference policy). Every failure path ends in `abstain`.
 */
import { capProposal } from './caps.ts';
import { episodeStop, gateProposal } from './gates.ts';
import { selectSurvivor, type Survivor } from './select.ts';
import { summarize } from './summary.ts';
import { validateDecision, validateInput, validateProposal } from './validate.ts';
import { ACTION_SURFACE, DELIVERY_MAPPING, SIGNAL_LIFETIME_MINUTES, type ReasonCode } from './vocabulary.ts';
import { contextExpiresAt, freshnessOf } from './window.ts';
import type { CandidateProposal, FinalizeOptions, ReasoningDecision, ReasoningEpisodeInput, RejectedCandidate } from './types.ts';

const FAR_PAST = new Date(0).toISOString();

function abstain(episodeId: string, reason: ReasonCode, rejected: RejectedCandidate[], expiresAt = FAR_PAST,
  freshness: ReasoningDecision['freshness'] = 'expired'): ReasoningDecision {
  const withBoth = ensureBoth(rejected, 'ABSTAIN-chosen');
  return {
    schemaVersion: 1, episodeId, mode: 'abstain', evidenceRefs: [], freshness, timing: 'n/a', confidence: 'unknown',
    contextExpiresAt: expiresAt, reasons: [reason], summary: summarize('abstain', undefined, [reason]), rejected: withBoth,
  };
}

/** DEFER and ABSTAIN always appear in the decision record (I5): chosen, rejected or recorded as not proposed. */
function ensureBoth(rejected: RejectedCandidate[], chosen: 'ABSTAIN-chosen' | 'DEFER-chosen' | 'other'): RejectedCandidate[] {
  const out = [...rejected];
  if (chosen !== 'ABSTAIN-chosen' && !out.some(r => r.action === 'ABSTAIN')) out.push({ action: 'ABSTAIN', reason: 'outranked' });
  if (chosen !== 'DEFER-chosen' && !out.some(r => r.action === 'DEFER')) out.push({ action: 'DEFER', reason: 'not_proposed' });
  return out;
}

export function finalize(input: unknown, proposals: readonly unknown[], opts: FinalizeOptions = {}): ReasoningDecision {
  const episodeId = typeof (input as { episodeId?: unknown })?.episodeId === 'string' ? (input as { episodeId: string }).episodeId : 'invalid';
  if (!validateInput(input)) return abstain(episodeId, 'invalid_input', []);
  const expiresAt = contextExpiresAt(input.window);
  const freshness = freshnessOf(input.window, input.now);

  const valid: CandidateProposal[] = [];
  const rejected: RejectedCandidate[] = [];
  for (const p of proposals) {
    if (validateProposal(p)) valid.push(p);
    else if (typeof (p as { action?: unknown })?.action === 'string') {
      rejected.push({ action: (p as CandidateProposal).action, reason: 'invalid_input' });
    }
  }

  const stop = episodeStop(input);
  if (stop) {
    return abstain(input.episodeId, stop, valid.filter(p => p.action !== 'ABSTAIN')
      .map(p => ({ action: p.action, ...(p.targetRef ? { targetRef: p.targetRef } : {}), reason: stop })), expiresAt, freshness);
  }

  const survivors: Survivor[] = [];
  const caps = new Map<CandidateProposal, ReasonCode>();
  for (const p of valid) {
    const reason = gateProposal(p, input, freshness === 'expired');
    if (reason) { rejected.push({ action: p.action, ...(p.targetRef ? { targetRef: p.targetRef } : {}), reason }); continue; }
    const cap = capProposal(p, input, opts);
    if (cap.by) caps.set(p, cap.by);
    survivors.push({ proposal: p, mode: cap.mode });
  }

  const chosen = selectSurvivor(survivors);
  for (const s of survivors) {
    if (s === chosen) continue;
    rejected.push({ action: s.proposal.action, ...(s.proposal.targetRef ? { targetRef: s.proposal.targetRef } : {}), reason: 'outranked' });
  }
  if (!chosen) return abstain(input.episodeId, 'no_relational_value', rejected, expiresAt, freshness);

  const p = chosen.proposal, mode = chosen.mode;
  const by = caps.get(p);
  const reasons: ReasonCode[] = [...(by ? [by] : []), ...p.rationale];
  const isTargeted = mode === 'act' || mode === 'ask';
  const surface = ACTION_SURFACE[p.action];
  const mapping = mode === 'act' && surface === 'recipient' ? DELIVERY_MAPPING[p.action] : undefined;
  const delay = p.timing.delayMinutes;
  const decision: ReasoningDecision = {
    schemaVersion: 1, episodeId: input.episodeId, mode,
    ...(isTargeted ? { action: p.action, surface } : {}),
    ...(isTargeted && p.targetRef ? { targetRef: p.targetRef } : {}),
    ...(mapping ? { deliveryMapping: { ...mapping } } : {}),
    evidenceRefs: mode === 'abstain' ? [] : [...p.evidenceRefs],
    freshness,
    timing: mode === 'act' ? p.timing.kind : mode === 'defer' ? 'not_now' : 'n/a',
    ...(mode === 'act' && delay !== undefined ? { timingDelayMinutes: Math.min(delay, SIGNAL_LIFETIME_MINUTES) } : {}),
    ...(p.alternativeInterpretation ? { alternativeInterpretation: p.alternativeInterpretation } : {}),
    confidence: p.confidence,
    contextExpiresAt: expiresAt,
    ...(mode === 'defer' && p.reassess ? { reassess: { ...p.reassess } } : {}),
    ...(by ? { capped: { from: p.requestedMode, by } } : {}),
    reasons,
    summary: summarize(mode, isTargeted ? p.action : undefined, reasons),
    rejected: ensureBoth(rejected, mode === 'abstain' ? 'ABSTAIN-chosen' : mode === 'defer' ? 'DEFER-chosen' : 'other'),
  };
  return validateDecision(decision) ? decision : abstain(input.episodeId, 'invalid_input', rejected, expiresAt, freshness);
}
