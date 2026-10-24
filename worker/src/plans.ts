import { createHash } from 'node:crypto';
import { PlanOutcomeSchema, type CatalogueEventRef, type Clock, type PlanOutcome, type PlanRequest } from '@dor/contracts';
import { PlanCoordinator, type PlanCurrentStatePort } from '@dor/agents';
import type { CommitPlanArgs, WorkerStateSource } from './spacetime/adapters.js';
import { mapRows, toPlanCandidate, type PlanCandidate } from './spacetime/rows.js';
import { isDisconnected } from './spacetime/connection.js';
import { DroidPlanProposer, type DroidRunner } from './droid-proposer.js';
import { DEFAULT_JOB_DEADLINE_MS } from './live.js';

/**
 * Shared-plan path over the real module (AI-R3, D034/D039): worker_plan_candidates → PlanCoordinator →
 * commit_plan_proposal. The view already lists only current bases, standing mutual intents, usable catalogue
 * records and (for a pair basis) standing C7 approvals; the reducer rechecks all of it in its own transaction.
 *
 * Participants are positional (`participant_a`/`participant_b`, as the view orders the intents): the reducer
 * derives the real people from the basis, never from the worker. The module versions intents per event while
 * D034's PlanParticipant has one intentVersion per person, so the request carries a constant 1 there and the
 * exact per-event intent ids and versions are bound here instead: the recheck reports `bothIntend` only if the
 * same (basis, event) row still exists with identical intents and approvals, and the commit binds exactly those.
 */
export const PLAN_PARTICIPANTS = ['participant_a', 'participant_b'] as const;
const BASIS_INTENT_VERSION = 1;
const MAX_EVENTS = 20;

export interface PlanBasis {
  kind: PlanCandidate['basisKind'];
  ref: string;
  /** Every current candidate row for this basis, one per mutually intended event. */
  rows: PlanCandidate[];
}

/** Groups candidate rows by basis. Order inside a basis is soonest event first (DS's tie order) unless ranked. */
export function groupPlanBases(rows: PlanCandidate[]): PlanBasis[] {
  const bases = new Map<string, PlanBasis>();
  for (const row of rows) {
    const key = `${row.basisKind}\n${row.basisRef}`;
    const basis = bases.get(key) ?? { kind: row.basisKind, ref: row.basisRef, rows: [] };
    if (!basis.rows.some(r => r.eventId === row.eventId)) basis.rows.push(row);
    bases.set(key, basis);
  }
  for (const basis of bases.values()) basis.rows.sort((x, y) => Date.parse(x.event.startsAt) - Date.parse(y.event.startsAt));
  return [...bases.values()];
}

/** Stable for the same basis and the same exact intents, so a restart or retry maps to the same request. */
export function planFingerprint(basis: PlanBasis): string {
  const parts = basis.rows.map(r => [r.eventId, ...r.intentIds, ...r.intentVersions, ...r.approvalIds].join(',')).sort();
  return createHash('sha256').update([basis.kind, basis.ref, ...parts].join('\n')).digest('hex').slice(0, 32);
}

export function toPlanRequest(basis: PlanBasis, rankEvents?: (events: CatalogueEventRef[]) => CatalogueEventRef[]): PlanRequest {
  let events = basis.rows.map(r => r.event);
  if (rankEvents) {
    // DS may reorder or drop events, never add one.
    const known = new Map(events.map(e => [e.eventId, e]));
    events = rankEvents(events).flatMap(e => known.has(e.eventId) ? [known.get(e.eventId)!] : []);
  }
  events = events.slice(0, MAX_EVENTS);
  const eventIds = events.map(e => e.eventId);
  return {
    schemaVersion: 1, requestId: `planreq_${planFingerprint(basis)}`, basis: { kind: basis.kind, ref: basis.ref },
    participants: [
      { ref: PLAN_PARTICIPANTS[0], intentVersion: BASIS_INTENT_VERSION, eventIds },
      { ref: PLAN_PARTICIPANTS[1], intentVersion: BASIS_INTENT_VERSION, eventIds },
    ],
    events,
  };
}

const sameRow = (a: PlanCandidate, b: PlanCandidate) =>
  a.intentIds.join() === b.intentIds.join() && a.intentVersions.join() === b.intentVersions.join() &&
  a.approvalIds.join() === b.approvalIds.join();

/**
 * PlanCurrentStatePort over a fresh read of worker_plan_candidates. Fails closed: no row, or a row whose intents
 * or approvals changed since the request was built, is not current; an unreadable view throws (the coordinator
 * then reports not_current).
 */
export class SpacetimePlanState implements PlanCurrentStatePort {
  constructor(private readonly source: WorkerStateSource, private readonly snapshot: PlanBasis) {}

  async current(basis: PlanRequest['basis'], _refs: readonly [string, string], eventId: string) {
    if (!this.source.planCandidates) return null;
    const now = mapRows(await this.source.planCandidates(), toPlanCandidate)
      .find(r => r.basisKind === basis.kind && r.basisRef === basis.ref && r.eventId === eventId);
    const then = this.snapshot.rows.find(r => r.eventId === eventId);
    if (!now || !then) return null;
    return {
      intentVersions: Object.fromEntries(PLAN_PARTICIPANTS.map(p => [p, BASIS_INTENT_VERSION])),
      bothIntend: sameRow(now, then), event: now.event,
    };
  }
}

/** Reducer refusals that mean "not current any more" (recorded) rather than a worker or deployment fault (thrown). */
export function classifyPlanCommitError(error: unknown): Extract<PlanOutcome['outcome'], 'not_current' | 'source_stale'> | null {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const match = /^([a-z_]+): (.*)$/s.exec(message);
  if (!match) return null;
  const [, code, reason] = match;
  // invalid = a malformed or reused commit from this worker; unauthorized: worker only = missing allow-list entry.
  if (code === 'stale' || code === 'not_found' || (code === 'unauthorized' && reason !== 'worker only')) {
    return reason === 'source_stale' ? 'source_stale' : 'not_current';
  }
  return null;
}

export interface PlanJobDeps {
  source: WorkerStateSource;
  /** The worker's shared Droid slot pool, so plan calls count against the same concurrency budget as ACKs. */
  runner: DroidRunner;
  clock: Clock;
  /** DS: optional event ranking; may reorder or drop, never add. Default soonest first. */
  rankEvents?: (events: CatalogueEventRef[]) => CatalogueEventRef[];
  deterministicOnly?: boolean;
  /** Aggregate model budget for this job (slot wait included). Default 25 s. */
  deadlineMs?: number;
  /** Default true, labeled `fixed_template` (D034 decision pending with Cyber). */
  fallbackOnProposerFailure?: boolean;
}

/**
 * Runs one basis: coordinator (0 model calls for one usable event, ≤ 1 + 1 repair for 2–3) → commit with the
 * exact bound intents. Returns the outcome with any commit refusal folded in. Transport and configuration
 * failures throw so the watcher retries.
 */
export async function runPlanJob(basis: PlanBasis, deps: PlanJobDeps): Promise<PlanOutcome> {
  if (!deps.source.commitPlanProposal) throw new Error('unavailable: commit_plan_proposal');
  const coordinator = new PlanCoordinator({
    current: new SpacetimePlanState(deps.source, basis), proposer: new DroidPlanProposer({ runner: deps.runner, deadlineAt: Date.now() + (deps.deadlineMs ?? DEFAULT_JOB_DEADLINE_MS) }),
    clock: deps.clock, deterministicOnly: deps.deterministicOnly, fallbackOnProposerFailure: deps.fallbackOnProposerFailure,
  });
  const { proposal, outcome } = await coordinator.propose(toPlanRequest(basis, deps.rankEvents));
  if (!proposal) return outcome;
  const row = basis.rows.find(r => r.eventId === proposal.eventId)!;
  const args: CommitPlanArgs = {
    plan_id: proposal.planId, basis_kind: basis.kind, basis_ref: basis.ref, event_id: proposal.eventId,
    intent_ids: [...row.intentIds], intent_versions: [...row.intentVersions], approval_ids: [...row.approvalIds],
    expires_at: proposal.expiresAt, decided_by: proposal.decidedBy,
  };
  try {
    await deps.source.commitPlanProposal(args);
    return outcome;
  } catch (error) {
    const refusal = classifyPlanCommitError(error);
    if (!refusal) throw error;
    const { planId: _dropped, ...rest } = outcome;
    return PlanOutcomeSchema.parse({ ...rest, outcome: refusal });
  }
}

export interface PlanWatcherOptions {
  run: (basis: PlanBasis) => Promise<PlanOutcome>;
  /** Codes and counts only; never log rows. */
  onOutcome?: (outcome: PlanOutcome) => void;
  onError?: (error: unknown) => void;
  /** Attempts per fingerprint before it is left alone until the process restarts. Default 3. */
  maxAttempts?: number;
}

/**
 * Turns each basis whose mutual intents changed into one plan job. A basis is reconsidered only when its
 * fingerprint (events, exact intents, approvals) changes; plan IDs are stable per basis and event, so a restart
 * re-commits the same plan_id, which the reducer treats as a no-op. Sweeps never overlap.
 */
export class PlanWatcher {
  private readonly done = new Set<string>();
  private readonly attempts = new Map<string, number>();
  private sweeping: Promise<number> | null = null;

  constructor(private readonly source: WorkerStateSource, private readonly options: PlanWatcherOptions) {}

  /** Returns the number of jobs started. */
  sweep(): Promise<number> {
    this.sweeping ??= this.runSweep().finally(() => { this.sweeping = null; });
    return this.sweeping;
  }

  private async runSweep(): Promise<number> {
    if (!this.source.planCandidates) return 0;
    const bases = groupPlanBases(mapRows(await this.source.planCandidates(), toPlanCandidate));
    const max = this.options.maxAttempts ?? 3;
    const pending = bases.map(b => ({ basis: b, key: planFingerprint(b) }))
      .filter(({ key }) => !this.done.has(key) && (this.attempts.get(key) ?? 0) < max);
    for (const { basis, key } of pending) {
      try {
        const outcome = await this.options.run(basis);
        this.done.add(key);
        this.attempts.delete(key);
        this.options.onOutcome?.(outcome);
      } catch (error) {
        // A dropped connection is retried after reconnecting; plan IDs are stable, so a landed commit is a no-op.
        if (!isDisconnected(error)) this.attempts.set(key, (this.attempts.get(key) ?? 0) + 1);
        this.options.onError?.(error);
      }
    }
    return pending.length;
  }
}
