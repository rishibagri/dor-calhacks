import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AgentAckSchema, ApprovedSignalSchema, CoordinationOutcomeSchema, NUDGE_VISIBLE_MS, NudgeSchema,
  RecipientSupportPreferencesSchema, nudgeDelivery, templateForSignal, type AgentAck, type ApprovedSignal,
  type Availability, type Clock, type CoordinationOutcome, type CoordinationOutcomeCode, type CoordinationPort,
  type DisclosurePolicyPort, type Nudge, type RecipientDelivery, type RecipientSupportPreferences,
  type SupportMode } from '@dor/contracts';
import { eligibleOptions, sameOption, type AckOption } from './eligibility.js';

export const MAX_ROUNDS = 2;

/** Everything a recipient agent may see: approved enums and pre-filtered options. No IDs, no vault data. */
export interface AckProposalInput {
  approved: { supportMode?: SupportMode; availability?: Availability };
  options: AckOption[];
  round: 1 | 2;
}
export const AckProposalSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('compatible'), optionIndex: z.number().int().min(0) }).strict(),
  z.object({ decision: z.literal('decline') }).strict(),
]);
export type AckProposal = z.infer<typeof AckProposalSchema>;

export interface AckProposerPort {
  /** Returns untrusted model output; the coordinator validates it and never treats it as authority. */
  propose(input: AckProposalInput, requestId: string): Promise<unknown>;
}
export interface RecipientPreferencesPort {
  /** Authoritative current consent record for this recipient in this pair, or null. */
  current(pairId: string, recipientId: string): Promise<unknown>;
}
export interface DeliveryStatePort {
  current(pairId: string, recipientId: string): Promise<{ delivery: RecipientDelivery; lastNudgeAt: Date | null }>;
}
export interface CoordinatorDeps {
  policy: DisclosurePolicyPort;
  preferences: RecipientPreferencesPort;
  proposer: AckProposerPort;
  clock: Clock;
  /** Recipient's delivery settings and last nudge for this pair (FLOWS.md F5: opt-in, quiet hours; no cooldown since D059). */
  delivery: DeliveryStatePort;
  /** DS ranking hook. It may reorder or drop options; anything it adds is ignored. */
  rank?: (options: AckOption[], signal: ApprovedSignal) => AckOption[];
  /** Use the top-ranked option when both rounds fail. Policy is still rechecked first. Default true. */
  fallbackOnProposerFailure?: boolean;
}

interface PairResult { ack?: AgentAck; nudge?: Nudge; outcome: CoordinationOutcome }

/**
 * Bounded exchange: policy check → delivery gate (opt-in, cooldown, quiet hours) → recipient consent → deterministic intersection → at most two
 * proposer rounds → policy, delivery and consent recheck → schema-checked ACK and nudge proposal. Nothing is committed
 * here; the caller passes the result to a version-checked reducer, which revalidates again.
 */
export class BoundedCoordinator implements CoordinationPort {
  constructor(private readonly deps: CoordinatorDeps) {}

  async coordinate(signals: ApprovedSignal[], requestId: string) {
    const groups = new Map<string, ApprovedSignal[]>();
    for (const raw of signals) {
      const parsed = ApprovedSignalSchema.safeParse(raw);
      if (!parsed.success) continue;
      const key = JSON.stringify([parsed.data.pairId, parsed.data.recipientId]);
      groups.set(key, [...(groups.get(key) ?? []), parsed.data]);
    }
    const acknowledgements: AgentAck[] = [], proposedNudges: Nudge[] = [], outcomes: CoordinationOutcome[] = [];
    for (const group of groups.values()) {
      group.sort((a, b) => a.signalId.localeCompare(b.signalId));
      const result = await this.coordinatePair(group, requestId);
      if (result.ack) acknowledgements.push(result.ack);
      if (result.nudge) proposedNudges.push(result.nudge);
      outcomes.push(result.outcome);
    }
    return { acknowledgements, proposedNudges, outcomes };
  }

  private async coordinatePair(signals: ApprovedSignal[], requestId: string): Promise<PairResult> {
    const { pairId, recipientId } = signals[0]!;
    const outcome = (code: CoordinationOutcomeCode, rounds = 0, decidedBy: CoordinationOutcome['decidedBy'] = 'none',
      nudgeId?: string) => CoordinationOutcomeSchema.parse({ schemaVersion: 1, requestId, pairId,
      signalIds: signals.map(s => s.signalId), outcome: code, rounds, decidedBy, ...(nudgeId ? { nudgeId } : {}) });

    const allowed: ApprovedSignal[] = [];
    for (const signal of signals) if (await this.allowed(signal)) allowed.push(signal);
    if (allowed.length === 0) return { outcome: outcome('policy_denied') };

    const gate = await this.deliveryGate(pairId, recipientId);
    if (gate) return { outcome: outcome(gate) };

    const prefs = await this.currentPreferences(pairId, recipientId);
    if (!prefs) return { outcome: outcome('preferences_unavailable') };

    let signal = allowed[0]!, options: AckOption[] = [];
    for (const candidate of allowed) {
      options = this.ranked(eligibleOptions(candidate, prefs), candidate);
      if (options.length > 0) { signal = candidate; break; }
    }
    if (options.length === 0) return { ack: declineAck(signal, prefs), outcome: outcome('no_intersection') };

    let choice: AckOption | undefined, declined = false, rounds = 0;
    const approved = { ...(signal.supportMode ? { supportMode: signal.supportMode } : {}),
      ...(signal.availability ? { availability: signal.availability } : {}) };
    for (let round = 1; round <= MAX_ROUNDS && !choice && !declined; round++) {
      rounds = round;
      let raw: unknown;
      try {
        raw = await this.deps.proposer.propose({ approved, options, round: round as 1 | 2 }, requestId);
      } catch {
        continue;
      }
      const proposal = AckProposalSchema.safeParse(raw);
      if (!proposal.success) continue;
      if (proposal.data.decision === 'decline') declined = true;
      else choice = options[proposal.data.optionIndex];
    }
    if (declined) return { ack: declineAck(signal, prefs), outcome: outcome('recipient_declined', rounds) };

    let decidedBy: CoordinationOutcome['decidedBy'] = 'agent', code: CoordinationOutcomeCode = 'nudge_proposed';
    if (!choice) {
      if (this.deps.fallbackOnProposerFailure === false) return { outcome: outcome('proposer_failed_no_suggestion', rounds) };
      choice = options[0]!; decidedBy = 'fixed_template'; code = 'proposer_failed_fallback';
    }

    // Consent or delivery settings may have changed while the proposer ran.
    if (!(await this.allowed(signal))) return { outcome: outcome('policy_denied', rounds) };
    const lateGate = await this.deliveryGate(pairId, recipientId);
    if (lateGate) return { outcome: outcome(lateGate, rounds) };
    const fresh = await this.currentPreferences(pairId, recipientId);
    if (!fresh || fresh.consentId !== prefs.consentId || fresh.consentVersion !== prefs.consentVersion ||
      !eligibleOptions(signal, fresh).some(o => sameOption(o, choice)))
      return { outcome: outcome('preferences_unavailable', rounds) };

    const templateId = templateForSignal(signal);
    if (!templateId) return { outcome: outcome('no_intersection', rounds) };
    const now = this.deps.clock.now();
    const ack = AgentAckSchema.parse({ schemaVersion: 1, signalId: signal.signalId, recipientConsentId: fresh.consentId,
      recipientConsentVersion: fresh.consentVersion, decision: 'compatible', supportMode: choice.supportMode,
      ...(choice.availability ? { availability: choice.availability } : {}) });
    const expiresAt = Math.min(Date.parse(signal.expiresAt), Date.parse(fresh.expiresAt), now.getTime() + NUDGE_VISIBLE_MS);
    const nudge = NudgeSchema.parse({ schemaVersion: 1, id: nudgeId(requestId, pairId, recipientId), pairId, recipientId,
      sourceSignalIds: [signal.signalId], sourceConsentVersions: [signal.consentVersion],
      templateId, createdAt: now.toISOString(),
      expiresAt: new Date(expiresAt).toISOString() });
    return { ack, nudge, outcome: outcome(code, rounds, decidedBy, nudge.id) };
  }

  /** Fail closed: a throwing or ambiguous policy port denies. */
  private async allowed(signal: ApprovedSignal): Promise<boolean> {
    try {
      return (await this.deps.policy.check(signal, signal.recipientId)).allowed === true;
    } catch {
      return false;
    }
  }

  /** Contracts' nudgeDelivery decides; an unreadable delivery state is treated as not opted in (D017). */
  private async deliveryGate(pairId: string, recipientId: string): Promise<'not_opted_in' | 'quiet_hours' | 'cooldown' | null> {
    try {
      const { delivery, lastNudgeAt } = await this.deps.delivery.current(pairId, recipientId);
      const decision = nudgeDelivery(delivery, lastNudgeAt, this.deps.clock.now());
      return decision.deliver ? null : decision.reason;
    } catch {
      return 'not_opted_in';
    }
  }

  private async currentPreferences(pairId: string, recipientId: string): Promise<RecipientSupportPreferences | null> {
    let raw: unknown;
    try {
      raw = await this.deps.preferences.current(pairId, recipientId);
    } catch {
      return null;
    }
    const parsed = RecipientSupportPreferencesSchema.safeParse(raw);
    if (!parsed.success) return null;
    const prefs = parsed.data;
    if (prefs.pairId !== pairId || prefs.recipientId !== recipientId || prefs.revokedAt !== null ||
      Date.parse(prefs.expiresAt) <= this.deps.clock.now().getTime()) return null;
    return prefs;
  }

  private ranked(options: AckOption[], signal: ApprovedSignal): AckOption[] {
    if (!this.deps.rank || options.length < 2) return options;
    let ranked: AckOption[];
    try {
      ranked = this.deps.rank(options.map(o => ({ ...o })), signal);
    } catch {
      return options;
    }
    return ranked.filter((o, i) => options.some(e => sameOption(e, o)) &&
      ranked.findIndex(r => sameOption(r, o)) === i);
  }
}

function declineAck(signal: ApprovedSignal, prefs: RecipientSupportPreferences): AgentAck {
  return AgentAckSchema.parse({ schemaVersion: 1, signalId: signal.signalId, recipientConsentId: prefs.consentId,
    recipientConsentVersion: prefs.consentVersion, decision: 'decline' });
}

/** Stable per request so a retried job proposes the same nudge ID and the reducer can deduplicate. */
function nudgeId(requestId: string, pairId: string, recipientId: string): string {
  return 'nudge_' + createHash('sha256').update(`${requestId}\n${pairId}\n${recipientId}`).digest('hex').slice(0, 32);
}
