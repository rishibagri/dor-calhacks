import { createHash } from 'node:crypto';
import { z } from 'zod';
import { IntroductionOutcomeSchema, IntroductionProposalSchema, IntroductionShortlistSchema, type Clock,
  type IntroductionCandidate, type IntroductionOutcome, type IntroductionOutcomeCode, type IntroductionProposal,
  type IntroductionShortlist, type DiscoveryReasonCode } from '@dor/contracts';

export const INTRO_MAX_ROUNDS = 2;
/** A suggestion goes stale after a day; the viewer can always ask again. */
export const INTRO_PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000;

/** All the model sees: per candidate, DS's reason codes, the published tags both chose and whether they share an event. */
export interface IntroProposalInput {
  candidates: { reasons: DiscoveryReasonCode[]; sharedTags: string[]; sharedEvent: boolean }[];
  round: 1 | 2;
}
export const IntroProposalReplySchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('suggest'), candidateIndex: z.number().int().min(0),
    lead: z.enum(['tag', 'event']), tagIndex: z.number().int().min(0).optional() }).strict(),
  z.object({ decision: z.literal('none') }).strict(),
]);
export type IntroProposalReply = z.infer<typeof IntroProposalReplySchema>;

export interface IntroProposerPort {
  /** Untrusted model output; the coordinator validates it and never treats it as authority. */
  propose(input: IntroProposalInput, requestId: string): Promise<unknown>;
}

/**
 * Authoritative, current discovery eligibility for one viewer/candidate pair (CS state + Cyber guards): both
 * publications active and in the permitted audience/area, no block either way. Returns the CURRENT publication
 * versions, or null when the pair is not eligible now. Never cached across checks.
 */
export interface DiscoveryEligibilityPort {
  current(viewerRef: string, candidateRef: string): Promise<{ viewerPublicationVersion: number; candidatePublicationVersion: number } | null>;
}

export interface IntroductionCoordinatorDeps {
  eligibility: DiscoveryEligibilityPort;
  proposer: IntroProposerPort;
  clock: Clock;
  /** Use DS's top eligible candidate when both model rounds fail. Default true; labeled `fixed_template`. */
  fallbackOnProposerFailure?: boolean;
  /** Never call the model (deterministic baseline for evaluation and the cheap path). Default false. */
  deterministicOnly?: boolean;
}

export class InvalidShortlistError extends Error {
  constructor() { super('invalid_shortlist'); this.name = 'InvalidShortlistError'; }
}

interface Choice { candidate: IntroductionCandidate; lead: 'tag' | 'event'; tagIndex: number }
export interface IntroductionResult { proposal?: IntroductionProposal; outcome: IntroductionOutcome }

/**
 * Bounded introduction step (AI-R2). Shortlist (DS) → current eligibility recheck → zero model calls for zero
 * or one eligible candidate → otherwise at most one call plus one repair → eligibility and version recheck →
 * a schema-checked, viewer-only proposal. It never contacts the candidate: the viewer decides whether to invite.
 */
export class IntroductionCoordinator {
  constructor(private readonly deps: IntroductionCoordinatorDeps) {}

  async propose(rawShortlist: unknown): Promise<IntroductionResult> {
    const parsed = IntroductionShortlistSchema.safeParse(rawShortlist);
    if (!parsed.success) throw new InvalidShortlistError();
    const shortlist = parsed.data;
    let rounds = 0, modelCalls = 0, eligibleCount = 0;
    const outcome = (code: IntroductionOutcomeCode, decidedBy: IntroductionOutcome['decidedBy'] = 'none', proposalId?: string) =>
      IntroductionOutcomeSchema.parse({ schemaVersion: 1, requestId: shortlist.requestId, outcome: code,
        shortlisted: shortlist.candidates.length, eligible: eligibleCount, rounds, modelCalls, decidedBy,
        ...(proposalId ? { proposalId } : {}) });

    if (shortlist.candidates.length === 0) return { outcome: outcome('no_candidates') };
    const eligible: IntroductionCandidate[] = [];
    for (const c of shortlist.candidates) if (await this.stillEligible(shortlist, c)) eligible.push(c);
    eligibleCount = eligible.length;
    if (eligible.length === 0) return { outcome: outcome('not_eligible') };

    let choice: Choice | undefined, decidedBy: IntroductionOutcome['decidedBy'] = 'deterministic';
    let code: IntroductionOutcomeCode = 'proposed';
    if (eligible.length === 1 || this.deps.deterministicOnly) {
      choice = deterministicChoice(eligible[0]!);
    } else {
      const input = { candidates: eligible.map(c => ({ reasons: [...c.reasons], sharedTags: [...c.sharedTags],
        sharedEvent: c.sharedEventId !== null })) };
      for (let round = 1; round <= INTRO_MAX_ROUNDS && !choice; round++) {
        rounds = round; modelCalls++;
        let raw: unknown;
        try {
          raw = await this.deps.proposer.propose({ ...input, round: round as 1 | 2 }, shortlist.requestId);
        } catch {
          continue;
        }
        const reply = IntroProposalReplySchema.safeParse(raw);
        if (!reply.success) continue;
        if (reply.data.decision === 'none') return { outcome: outcome('no_fit', 'agent') };
        choice = validChoice(eligible, reply.data);
      }
      decidedBy = 'agent';
      if (!choice) {
        if (this.deps.fallbackOnProposerFailure === false) return { outcome: outcome('proposer_failed_no_suggestion') };
        choice = deterministicChoice(eligible[0]!);
        decidedBy = 'fixed_template'; code = 'proposer_failed_fallback';
      }
    }

    // Either person may have withdrawn, blocked or edited their profile while the model ran.
    if (!(await this.stillEligible(shortlist, choice.candidate))) return { outcome: outcome('stale', decidedBy) };

    const now = this.deps.clock.now();
    const c = choice.candidate;
    const event = choice.lead === 'event' ? c.sharedEventId ?? undefined : undefined;
    const tags = event ? [] : [c.sharedTags[choice.tagIndex]!, ...c.sharedTags.filter((_, i) => i !== choice.tagIndex)].slice(0, 3);
    const proposal = IntroductionProposalSchema.parse({
      schemaVersion: 1, proposalId: proposalId(shortlist, c), requestId: shortlist.requestId, viewerRef: shortlist.viewerRef,
      candidateRef: c.ref, viewerPublicationVersion: shortlist.viewerPublicationVersion,
      candidatePublicationVersion: c.publicationVersion, reasonCode: event ? 'same_event' : 'shared_interest',
      sharedTags: tags, ...(event ? { eventId: event } : {}),
      openerId: event ? 'suggest_event_together' : 'suggest_shared_interest', revision: 1,
      createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + INTRO_PROPOSAL_TTL_MS).toISOString(), decidedBy,
    });
    return { proposal, outcome: outcome(code, decidedBy, proposal.proposalId) };
  }

  /** Fail closed: a throwing port, a missing pair or any version change since the shortlist means not eligible. */
  private async stillEligible(shortlist: IntroductionShortlist, c: IntroductionCandidate): Promise<boolean> {
    try {
      const now = await this.deps.eligibility.current(shortlist.viewerRef, c.ref);
      return now !== null && now.viewerPublicationVersion === shortlist.viewerPublicationVersion &&
        now.candidatePublicationVersion === c.publicationVersion;
    } catch {
      return false;
    }
  }
}

/** A shared event is the more concrete opening; otherwise DS's first overlap tag. */
function deterministicChoice(candidate: IntroductionCandidate): Choice {
  return { candidate, lead: candidate.sharedEventId !== null ? 'event' : 'tag', tagIndex: 0 };
}

/** The model may only point at options it was given; anything else is unusable output. */
function validChoice(eligible: IntroductionCandidate[], reply: Extract<IntroProposalReply, { decision: 'suggest' }>): Choice | undefined {
  const candidate = eligible[reply.candidateIndex];
  if (!candidate) return undefined;
  if (reply.lead === 'event') return candidate.sharedEventId !== null ? { candidate, lead: 'event', tagIndex: 0 } : undefined;
  const tagIndex = reply.tagIndex ?? 0;
  return tagIndex < candidate.sharedTags.length ? { candidate, lead: 'tag', tagIndex } : undefined;
}

/** Stable for the same request and versions, so a retried request proposes the same ID. */
function proposalId(s: IntroductionShortlist, c: IntroductionCandidate): string {
  return 'intro_' + createHash('sha256').update([s.requestId, s.viewerRef, s.viewerPublicationVersion, c.ref,
    c.publicationVersion].join('\n')).digest('hex').slice(0, 32);
}
