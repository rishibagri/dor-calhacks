import { z } from 'zod';

/**
 * PROPOSED C8 shapes for the AI introduction step (D033; CS/Cyber producer review and DS consumer review
 * pending). Not runtime-enabled: no reducer, view or delivery uses them yet, and publication, area, event
 * intent and block records remain CS/Cyber's to define (specs/DISCOVERY.md).
 *
 * The step sits between DS's deterministic shortlist and the viewer's own decision to send an invitation:
 * shortlist (≤ 3 eligible candidates, opaque refs, overlap only) → bounded selection → a proposal shown to the
 * viewer alone. A proposal is a suggestion, never a message, invitation or disclosure to the candidate.
 */
const id = z.string().min(1).max(128);
const version = z.number().int().positive();
const time = z.string().datetime({ offset: true });
const unique = <T>(values: T[]) => new Set(values).size === values.length;

/**
 * A published interest tag as a bounded slug: the same shape as the catalogue topic allowlist (catalogue.ts) and
 * DS's discovery ranker. The allowlist itself is CS/Cyber's C8 publication contract.
 */
export const DiscoveryTagSchema = z.string().regex(/^[a-z][a-z0-9-]{1,31}$/);
/** DS shortlist explanation codes (src/features/discovery/types.ts REASON_CODES). No compatibility percentage. */
export const DISCOVERY_REASON_CODES = ['shared_interest', 'same_event', 'event_fits_shared_interest'] as const;
export const DiscoveryReasonCodeSchema = z.enum(DISCOVERY_REASON_CODES);
export const INTRODUCTION_REASON_CODES = ['shared_interest', 'same_event'] as const;
export const IntroductionReasonCodeSchema = z.enum(INTRODUCTION_REASON_CODES);
export const INTRODUCTION_OPENER_IDS = ['suggest_shared_interest', 'suggest_event_together'] as const;
export const IntroductionOpenerIdSchema = z.enum(INTRODUCTION_OPENER_IDS);
/** Fixed viewer-facing copy; `{tag}` is a published tag label resolved by the UI. No model-written text. */
export const INTRODUCTION_OPENER_COPY: Record<(typeof INTRODUCTION_OPENER_IDS)[number], string> = {
  suggest_shared_interest: 'You both chose {tag}. Want to send an introduction?',
  suggest_event_together: 'You are both interested in the same event. Want to suggest going together?',
};
export const MAX_SHORTLIST = 3;

/**
 * One DS-shortlisted, already-eligible candidate: DS's ShortlistEntry (ref, reasons, sharedTags, sharedEventId)
 * plus the publication version it was ranked against. Overlap only: never the candidate's other card fields.
 */
export const IntroductionCandidateSchema = z.object({
  ref: id, publicationVersion: version,
  reasons: z.array(DiscoveryReasonCodeSchema).min(1).max(3).refine(unique, 'Duplicate reasons'),
  sharedTags: z.array(DiscoveryTagSchema).max(10).refine(unique, 'Duplicate tags'),
  /** Canonical C7 event both people currently published intent for, if any. */
  sharedEventId: id.nullable(),
}).strict()
  .refine(c => c.sharedTags.length > 0 || c.sharedEventId !== null, 'A candidate needs a stated overlap')
  .refine(c => c.reasons.includes('same_event') === (c.sharedEventId !== null), 'same_event reason needs exactly the shared event');

/** DS → AI. Candidates are in DS rank order and were filtered in authoritative state before ranking. */
export const IntroductionShortlistSchema = z.object({
  schemaVersion: z.literal(1), requestId: id, viewerRef: id, viewerPublicationVersion: version,
  candidates: z.array(IntroductionCandidateSchema).max(MAX_SHORTLIST)
    .refine(cs => unique(cs.map(c => c.ref)), 'Duplicate candidates'),
}).strict().refine(s => s.candidates.every(c => c.ref !== s.viewerRef), 'The viewer cannot be their own candidate');

/** AI → viewer-only proposal state (CS) and guarded finalization (Cyber). Versions bind it to what was published. */
export const IntroductionProposalSchema = z.object({
  schemaVersion: z.literal(1), proposalId: id, requestId: id, viewerRef: id, candidateRef: id,
  viewerPublicationVersion: version, candidatePublicationVersion: version,
  reasonCode: IntroductionReasonCodeSchema, sharedTags: z.array(DiscoveryTagSchema).max(3).refine(unique, 'Duplicate tags'),
  eventId: id.optional(), openerId: IntroductionOpenerIdSchema, revision: version,
  createdAt: time, expiresAt: time, decidedBy: z.enum(['deterministic', 'agent', 'fixed_template']),
}).strict()
  .refine(p => p.viewerRef !== p.candidateRef, 'Self-introduction')
  .refine(p => (p.reasonCode === 'same_event') === (p.eventId !== undefined), 'same_event needs exactly one event')
  .refine(p => p.reasonCode === 'same_event' || p.sharedTags.length > 0, 'shared_interest needs a tag')
  .refine(p => (p.openerId === 'suggest_event_together') === (p.reasonCode === 'same_event'), 'Opener must match reason');

export const IntroductionOutcomeCodeSchema = z.enum(['proposed', 'no_candidates', 'not_eligible', 'no_fit', 'stale',
  'proposer_failed_fallback', 'proposer_failed_no_suggestion']);
/** Ops/evaluation record: codes, counts and IDs only. Never shown to the candidate. */
export const IntroductionOutcomeSchema = z.object({
  schemaVersion: z.literal(1), requestId: id, outcome: IntroductionOutcomeCodeSchema,
  shortlisted: z.number().int().min(0).max(MAX_SHORTLIST), eligible: z.number().int().min(0).max(MAX_SHORTLIST),
  rounds: z.number().int().min(0).max(2), modelCalls: z.number().int().min(0).max(2),
  decidedBy: z.enum(['none', 'deterministic', 'agent', 'fixed_template']), proposalId: id.optional(),
}).strict();

export type DiscoveryTag = z.infer<typeof DiscoveryTagSchema>;
export type DiscoveryReasonCode = z.infer<typeof DiscoveryReasonCodeSchema>;
export type IntroductionCandidate = z.infer<typeof IntroductionCandidateSchema>;
export type IntroductionShortlist = z.infer<typeof IntroductionShortlistSchema>;
export type IntroductionProposal = z.infer<typeof IntroductionProposalSchema>;
export type IntroductionOutcome = z.infer<typeof IntroductionOutcomeSchema>;
export type IntroductionOutcomeCode = z.infer<typeof IntroductionOutcomeCodeSchema>;
