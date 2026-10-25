import { IntroductionOutcomeSchema, IntroductionShortlistSchema, MAX_SHORTLIST, type Clock, type IntroductionOutcome,
  type IntroductionShortlist } from '@dor/contracts';
import { IntroductionCoordinator, InvalidShortlistError, type DiscoveryEligibilityPort } from '@dor/agents';
import type { CommitIntroductionArgs, WorkerStateSource } from './spacetime/adapters.js';
import { mapRows, toIntroductionRequestRow, type IntroductionRequestRow } from './spacetime/rows.js';
import { isDisconnected } from './spacetime/connection.js';
import { DroidIntroProposer, type DroidRunner } from './droid-proposer.js';
import { DEFAULT_JOB_DEADLINE_MS } from './live.js';

/**
 * Introduction path (AI-R2, D033/D038): DS shortlist → IntroductionCoordinator → commit_introduction_proposal,
 * which rechecks visibility, both publication versions, tag overlap, blocks and existing requests in its own
 * transaction. The result is a suggestion in the viewer's private list only; the candidate is never contacted.
 *
 * The shortlist and current eligibility come from authoritative state the worker can read: since D048 that is the
 * worker_introduction_requests view (viewer-initiated requests; see IntroductionRequestWatcher below).
 */

/**
 * The D038 commit accepts `shared_interest` only until same-event introductions land (CYBER-R3 follow-up). Until
 * then event overlap is removed from the shortlist up front, so no model call is spent on an option that could
 * never commit; a candidate whose only overlap is an event drops out.
 */
export function withoutEventOverlap(shortlist: IntroductionShortlist): IntroductionShortlist {
  return {
    ...shortlist,
    candidates: shortlist.candidates.filter(c => c.sharedTags.length > 0).map(c => ({
      ...c, sharedEventId: null, reasons: c.reasons.filter(r => r !== 'same_event').length > 0
        ? c.reasons.filter(r => r !== 'same_event') : ['shared_interest'],
    })),
  };
}

/** Refusals meaning "no longer valid for this viewer" (recorded as stale) vs worker or deployment faults (thrown). */
export function classifyIntroCommitError(error: unknown): 'stale' | null {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const match = /^([a-z_]+): (.*)$/s.exec(message);
  if (!match) return null;
  const [, code, reason] = match;
  return code === 'stale' || code === 'not_found' || (code === 'unauthorized' && reason !== 'worker only') ? 'stale' : null;
}

export interface IntroductionJobDeps {
  source: WorkerStateSource;
  /** The worker's shared Droid slot pool. */
  runner: DroidRunner;
  eligibility: DiscoveryEligibilityPort;
  clock: Clock;
  /** Default false: event overlap is stripped (see withoutEventOverlap). */
  sameEventSupported?: boolean;
  deterministicOnly?: boolean;
  /** Aggregate model budget for this job (slot wait included). Default 25 s. */
  deadlineMs?: number;
  /** Default true, labeled `fixed_template` (Cyber decision pending). */
  fallbackOnProposerFailure?: boolean;
}

/**
 * Runs one viewer's shortlist: 0 model calls for 0–1 eligible candidates, ≤ 1 + 1 repair for 2–3, then the
 * guarded commit. Throws InvalidShortlistError for a malformed shortlist, and transport/configuration failures
 * so the caller can retry; a commit refusal is folded into the outcome as `stale`.
 */
export async function runIntroductionJob(rawShortlist: unknown, deps: IntroductionJobDeps): Promise<IntroductionOutcome> {
  if (!deps.source.commitIntroductionProposal) throw new Error('unavailable: commit_introduction_proposal');
  const parsed = IntroductionShortlistSchema.safeParse(rawShortlist);
  if (!parsed.success) throw new InvalidShortlistError();
  const shortlist = deps.sameEventSupported ? parsed.data : withoutEventOverlap(parsed.data);
  const coordinator = new IntroductionCoordinator({
    eligibility: deps.eligibility, proposer: new DroidIntroProposer({ runner: deps.runner, deadlineAt: Date.now() + (deps.deadlineMs ?? DEFAULT_JOB_DEADLINE_MS) }), clock: deps.clock,
    deterministicOnly: deps.deterministicOnly, fallbackOnProposerFailure: deps.fallbackOnProposerFailure,
  });
  const { proposal, outcome } = await coordinator.propose(shortlist);
  if (!proposal) return outcome;
  const args: CommitIntroductionArgs = {
    proposal_id: proposal.proposalId, viewer_ref: proposal.viewerRef, candidate_ref: proposal.candidateRef,
    viewer_publication_version: proposal.viewerPublicationVersion,
    candidate_publication_version: proposal.candidatePublicationVersion, reason_code: proposal.reasonCode,
    shared_tags: [...proposal.sharedTags], ...(proposal.eventId ? { event_id: proposal.eventId } : {}),
    opener_id: proposal.openerId, decided_by: proposal.decidedBy, expires_at: proposal.expiresAt,
  };
  try {
    await deps.source.commitIntroductionProposal(args);
    return outcome;
  } catch (error) {
    if (!classifyIntroCommitError(error)) throw error;
    const { proposalId: _dropped, ...rest } = outcome;
    return IntroductionOutcomeSchema.parse({ ...rest, outcome: 'stale' });
  }
}

// ---- D048 viewer-initiated suggestion requests ----

export type IntroCandidate = NonNullable<IntroductionRequestRow['candidate']>;

/** One open request with every candidate the view listed for it (view order: card-ref order). */
export interface IntroductionRequest {
  requestId: string;
  viewerRef: string;
  viewerRevision: number;
  expiresAtMs: number;
  candidates: IntroCandidate[];
}

export function groupIntroductionRequests(rows: IntroductionRequestRow[]): IntroductionRequest[] {
  const out = new Map<string, IntroductionRequest>();
  for (const row of rows) {
    const req = out.get(row.requestId) ?? { requestId: row.requestId, viewerRef: row.viewerRef, viewerRevision: row.viewerRevision,
      expiresAtMs: row.expiresAtMs, candidates: [] };
    if (row.candidate && !req.candidates.some(c => c.ref === row.candidate!.ref)) req.candidates.push(row.candidate);
    out.set(row.requestId, req);
  }
  return [...out.values()];
}

/**
 * Interim deterministic rank until DS packages one the worker can import: most published overlap first, then the
 * view's card-ref order. Overlap only: no other profile field exists here to rank on.
 */
export function rankByOverlap(candidates: readonly IntroCandidate[]): IntroCandidate[] {
  return candidates.map((c, i) => ({ c, i })).sort((x, y) => y.c.sharedTags.length - x.c.sharedTags.length || x.i - y.i).map(x => x.c);
}

/** DS shortlist shape (≤ 3, rank order, overlap only). A rank function may reorder or drop candidates, never add one. */
export function toIntroductionShortlist(req: IntroductionRequest,
  rank: (c: readonly IntroCandidate[]) => IntroCandidate[] = rankByOverlap): IntroductionShortlist {
  const known = new Map(req.candidates.map(c => [c.ref, c]));
  const seen = new Set<string>();
  const ranked = rank(req.candidates).flatMap(c => known.has(c.ref) && !seen.has(c.ref) ? (seen.add(c.ref), [known.get(c.ref)!]) : []);
  return {
    schemaVersion: 1, requestId: req.requestId, viewerRef: req.viewerRef, viewerPublicationVersion: req.viewerRevision,
    candidates: ranked.slice(0, MAX_SHORTLIST).map(c => ({ ref: c.ref, publicationVersion: c.revision,
      reasons: ['shared_interest' as const], sharedTags: [...c.sharedTags], sharedEventId: null })),
  };
}

/**
 * DiscoveryEligibilityPort over a fresh read of worker_introduction_requests: a pair is eligible only while the
 * same request is still open and the view still lists that candidate for that viewer (the view applies Cyber's
 * visibility guard, blocks, connections and pending requests). The current revisions come from the same row.
 */
export class SpacetimeIntroEligibility implements DiscoveryEligibilityPort {
  constructor(private readonly source: WorkerStateSource, private readonly requestId: string) {}

  async current(viewerRef: string, candidateRef: string) {
    if (!this.source.introductionRequests) return null;
    const row = mapRows(await this.source.introductionRequests(), toIntroductionRequestRow)
      .find(r => r.requestId === this.requestId && r.viewerRef === viewerRef && r.candidate?.ref === candidateRef);
    return row ? { viewerPublicationVersion: row.viewerRevision, candidatePublicationVersion: row.candidate!.revision } : null;
  }
}

export type IntroductionRequestJobDeps = Omit<IntroductionJobDeps, 'eligibility'> & {
  /** DS: optional candidate ranking; may reorder or drop, never add. Default rankByOverlap. */
  rank?: (c: readonly IntroCandidate[]) => IntroCandidate[];
};

/**
 * One request → at most one suggestion. No candidates (or a viewer who stopped taking part) is `no_candidates`
 * with zero model calls and no commit; otherwise runIntroductionJob (0 calls for one candidate or deterministic
 * mode, ≤ 1 + 1 repair for 2–3) with eligibility rechecked from the live view.
 */
export async function runIntroductionRequest(req: IntroductionRequest, deps: IntroductionRequestJobDeps): Promise<IntroductionOutcome> {
  if (req.candidates.length === 0 || !req.viewerRef) {
    return IntroductionOutcomeSchema.parse({ schemaVersion: 1, requestId: req.requestId, outcome: 'no_candidates',
      shortlisted: 0, eligible: 0, rounds: 0, modelCalls: 0, decidedBy: 'none' });
  }
  return runIntroductionJob(toIntroductionShortlist(req, deps.rank),
    { ...deps, eligibility: new SpacetimeIntroEligibility(deps.source, req.requestId) });
}

export interface IntroductionRequestWatcherOptions {
  run: (req: IntroductionRequest) => Promise<IntroductionOutcome>;
  clock: Clock;
  /** Codes and counts only; never log rows. */
  onOutcome?: (outcome: IntroductionOutcome) => void;
  /** A request past expires_at was closed without running (the viewer asked too long ago). */
  onLapsed?: () => void;
  onError?: (error: unknown) => void;
  /** Failed runs per request before it is closed without a suggestion. Default 3. */
  maxAttempts?: number;
}

/**
 * Turns each open suggestion request into one job, then closes it whatever the outcome, so a request yields at
 * most one suggestion. A request whose job finished is never run again, even if closing it failed (only the
 * close is retried): after a commit the view drops the suggested person, so a rerun could suggest a second one.
 * Lapsed requests and requests that keep failing are closed without a suggestion. Sweeps never overlap.
 */
export class IntroductionRequestWatcher {
  private readonly ran = new Set<string>();
  private readonly closed = new Set<string>();
  private readonly attempts = new Map<string, number>();
  private sweeping: Promise<number> | null = null;

  constructor(private readonly source: WorkerStateSource, private readonly options: IntroductionRequestWatcherOptions) {}

  /** Returns the number of jobs started. */
  sweep(): Promise<number> {
    this.sweeping ??= this.runSweep().finally(() => { this.sweeping = null; });
    return this.sweeping;
  }

  private async runSweep(): Promise<number> {
    const { introductionRequests, closeIntroductionRequest } = this.source;
    if (!introductionRequests || !closeIntroductionRequest) return 0;
    const requests = groupIntroductionRequests(mapRows(await introductionRequests.call(this.source), toIntroductionRequestRow));
    const max = this.options.maxAttempts ?? 3;
    let started = 0;
    for (const req of requests) {
      const id = req.requestId;
      if (this.closed.has(id)) continue;
      try {
        if (!this.ran.has(id)) {
          if (req.expiresAtMs <= this.options.clock.now().getTime()) this.options.onLapsed?.();
          else if ((this.attempts.get(id) ?? 0) < max) {
            started++;
            const outcome = await this.options.run(req);
            this.ran.add(id);
            this.options.onOutcome?.(outcome);
          }
        }
        await closeIntroductionRequest.call(this.source, id);
        this.closed.add(id);
        this.attempts.delete(id);
      } catch (error) {
        // A dropped connection is retried after reconnecting without counting against the request.
        if (!isDisconnected(error) && !this.ran.has(id)) this.attempts.set(id, (this.attempts.get(id) ?? 0) + 1);
        this.options.onError?.(error);
      }
    }
    return started;
  }
}
