import { IntroductionOutcomeSchema, IntroductionShortlistSchema, type Clock, type IntroductionOutcome,
  type IntroductionShortlist } from '@dor/contracts';
import { IntroductionCoordinator, InvalidShortlistError, type DiscoveryEligibilityPort } from '@dor/agents';
import type { CommitIntroductionArgs, WorkerStateSource } from './spacetime/adapters.js';
import { DroidIntroProposer, type DroidRunner } from './droid-proposer.js';
import { DEFAULT_JOB_DEADLINE_MS } from './live.js';

/**
 * Introduction path (AI-R2, D033/D038): DS shortlist → IntroductionCoordinator → commit_introduction_proposal,
 * which rechecks visibility, both publication versions, tag overlap, blocks and existing requests in its own
 * transaction. The result is a suggestion in the viewer's private list only; the candidate is never contacted.
 *
 * The shortlist and current eligibility must come from authoritative state the worker can read. The module has
 * no worker view for discovery candidates yet, so both are supplied by the caller (DiscoveryEligibilityPort).
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
