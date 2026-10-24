import { createHash } from 'node:crypto';
import { z } from 'zod';
import { PlanOutcomeSchema, PlanRequestSchema, SharedPlanProposalSchema, type CatalogueEventRef, type Clock,
  type PlanOutcome, type PlanOutcomeCode, type PlanRequest, type SharedPlanProposal } from '@kinetic/contracts';

export const PLAN_MAX_ROUNDS = 2;
export const PLAN_MAX_OPTIONS = 3;
const HOUR_MS = 60 * 60 * 1000;

/** All the model sees per event: normalized topics, format and how far away it is. No titles, URLs or IDs. */
export interface PlanProposalInput {
  events: { topics: string[]; format: 'in_person' | 'online'; startsInHours: number }[];
  round: 1 | 2;
}
export const PlanProposalReplySchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('suggest'), eventIndex: z.number().int().min(0) }).strict(),
  z.object({ decision: z.literal('none') }).strict(),
]);

export interface PlanProposerPort {
  /** Untrusted model output; the coordinator validates it and never treats it as authority. */
  propose(input: PlanProposalInput, requestId: string): Promise<unknown>;
}

/**
 * Authoritative current facts for a plan (CS state + Cyber guards), read fresh: whether the basis still holds
 * (introduction accepted and not withdrawn, or pair linked with a C7 activity approval that covers events; no
 * block), each participant's current intent version and whether both still intend this event, and the current
 * catalogue record. Null when the basis no longer holds.
 */
export interface PlanCurrentStatePort {
  current(basis: PlanRequest['basis'], refs: readonly [string, string], eventId: string): Promise<{
    intentVersions: Record<string, number>;
    bothIntend: boolean;
    event: CatalogueEventRef | null;
  } | null>;
}

export interface PlanCoordinatorDeps {
  current: PlanCurrentStatePort;
  proposer: PlanProposerPort;
  clock: Clock;
  /** Catalogue records older than this are not proposed (stale source). Default 48 h. */
  maxSourceAgeMs?: number;
  /** Do not propose events starting sooner than this. Default 2 h. */
  minLeadMs?: number;
  /** Default true; labeled `fixed_template`. */
  fallbackOnProposerFailure?: boolean;
  deterministicOnly?: boolean;
}

export class InvalidPlanRequestError extends Error {
  constructor() { super('invalid_plan_request'); this.name = 'InvalidPlanRequestError'; }
}
export interface PlanResult { proposal?: SharedPlanProposal; outcome: PlanOutcome }

/**
 * Bounded shared-plan step (AI-R3). Only events BOTH people explicitly published intent for, from CS's
 * normalized catalogue, are options. Zero model calls for zero or one usable event; at most one call plus one
 * repair for two or three. The basis, both intents and the event are rechecked after generation. The result
 * is revision 1 of a proposal both people must accept (plan-lifecycle); nothing is booked, sent or bought.
 */
export class PlanCoordinator {
  constructor(private readonly deps: PlanCoordinatorDeps) {}

  async propose(rawRequest: unknown): Promise<PlanResult> {
    const parsed = PlanRequestSchema.safeParse(rawRequest);
    if (!parsed.success) throw new InvalidPlanRequestError();
    const request = parsed.data;
    const now = this.deps.clock.now().getTime();
    let rounds = 0, modelCalls = 0, mutualEvents = 0, usableEvents = 0;
    const outcome = (code: PlanOutcomeCode, decidedBy: PlanOutcome['decidedBy'] = 'none', planId?: string) =>
      PlanOutcomeSchema.parse({ schemaVersion: 1, requestId: request.requestId, outcome: code, mutualEvents, usableEvents,
        rounds, modelCalls, decidedBy, ...(planId ? { planId } : {}) });

    const [a, b] = request.participants;
    const both = new Set(a.eventIds.filter(id => b.eventIds.includes(id)));
    const mutual = request.events.filter(e => both.has(e.eventId));
    mutualEvents = mutual.length;
    const usable = mutual.filter(e => this.usable(e, now));
    usableEvents = usable.length;
    if (usable.length === 0) {
      return { outcome: outcome(mutual.some(e => this.fresh(e, now)) || mutual.length === 0 ? 'no_shared_event' : 'source_stale') };
    }

    const options = usable.slice(0, PLAN_MAX_OPTIONS);
    let choice: CatalogueEventRef | undefined, decidedBy: PlanOutcome['decidedBy'] = 'deterministic';
    let code: PlanOutcomeCode = 'proposed';
    if (options.length === 1 || this.deps.deterministicOnly) {
      choice = options[0];
    } else {
      const events = options.map(e => ({ topics: [...e.topics], format: e.format,
        startsInHours: Math.round((Date.parse(e.startsAt) - now) / HOUR_MS) }));
      for (let round = 1; round <= PLAN_MAX_ROUNDS && !choice; round++) {
        rounds = round; modelCalls++;
        let raw: unknown;
        try {
          raw = await this.deps.proposer.propose({ events, round: round as 1 | 2 }, request.requestId);
        } catch {
          continue;
        }
        const reply = PlanProposalReplySchema.safeParse(raw);
        if (!reply.success) continue;
        if (reply.data.decision === 'none') return { outcome: outcome('no_fit', 'agent') };
        choice = options[reply.data.eventIndex];
      }
      decidedBy = 'agent';
      if (!choice) {
        if (this.deps.fallbackOnProposerFailure === false) return { outcome: outcome('proposer_failed_no_suggestion') };
        choice = options[0]; decidedBy = 'fixed_template'; code = 'proposer_failed_fallback';
      }
    }

    // Intents, the basis or the event itself may have changed while the model ran.
    const recheck = await this.recheck(request, choice!, this.deps.clock.now().getTime());
    if (recheck) return { outcome: outcome(recheck, decidedBy) };

    const created = this.deps.clock.now();
    const startsAt = Date.parse(choice!.startsAt);
    const participants = [...request.participants].sort((x, y) => x.ref < y.ref ? -1 : 1)
      .map(p => ({ ref: p.ref, intentVersion: p.intentVersion })) as [{ ref: string; intentVersion: number }, { ref: string; intentVersion: number }];
    const proposal = SharedPlanProposalSchema.parse({
      schemaVersion: 1, planId: planId(request, choice!.eventId), revision: 1, requestId: request.requestId,
      basis: request.basis, participants, eventId: choice!.eventId, eventStartsAt: choice!.startsAt,
      sourceFetchedAt: choice!.fetchedAt, createdAt: created.toISOString(),
      expiresAt: new Date(Math.min(created.getTime() + 48 * HOUR_MS, startsAt - HOUR_MS)).toISOString(), decidedBy,
    });
    return { proposal, outcome: outcome(code, decidedBy, proposal.planId) };
  }

  private fresh(e: CatalogueEventRef, now: number): boolean {
    return now - Date.parse(e.fetchedAt) <= (this.deps.maxSourceAgeMs ?? 48 * HOUR_MS);
  }

  private usable(e: CatalogueEventRef, now: number): boolean {
    return e.status === 'scheduled' && this.fresh(e, now) &&
      Date.parse(e.startsAt) - now >= (this.deps.minLeadMs ?? 2 * HOUR_MS);
  }

  /** Fail closed: a throwing port, changed versions, a withdrawn intent or a changed event is not current. */
  private async recheck(request: PlanRequest, chosen: CatalogueEventRef, now: number): Promise<PlanOutcomeCode | null> {
    let state: Awaited<ReturnType<PlanCurrentStatePort['current']>>;
    try {
      state = await this.deps.current.current(request.basis, [request.participants[0].ref, request.participants[1].ref], chosen.eventId);
    } catch {
      return 'not_current';
    }
    if (!state || !state.bothIntend) return 'not_current';
    if (request.participants.some(p => state!.intentVersions[p.ref] !== p.intentVersion)) return 'not_current';
    const event = state.event;
    if (!event || event.status !== 'scheduled' || event.startsAt !== chosen.startsAt) return 'not_current';
    if (!this.usable(event, now)) return this.fresh(event, now) ? 'not_current' : 'source_stale';
    return null;
  }
}

/** Stable per basis, people and event, so a retried request maps to the same plan (and its revisions). */
function planId(request: PlanRequest, eventId: string): string {
  const refs = request.participants.map(p => p.ref).sort();
  return 'plan_' + createHash('sha256').update([request.basis.kind, request.basis.ref, ...refs, eventId].join('\n'))
    .digest('hex').slice(0, 32);
}
