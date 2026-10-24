import { z } from 'zod';
import { DiscoveryTagSchema } from './introduction.js';

/**
 * PROPOSED C7/C8 shared-plan shapes for the AI plan step (D034; CS catalogue/state, Cyber guard and DS consumer
 * review pending; not runtime-enabled). The catalogue item itself is CS's C7 record; `CatalogueEventRef` is only
 * the subset the plan step may consume. Scraped titles, descriptions and URLs are deliberately absent: the
 * model never reads source text, and nothing here can trigger a web, booking, RSVP or messaging action.
 */
const id = z.string().min(1).max(128);
const version = z.number().int().positive();
const time = z.string().datetime({ offset: true });
const unique = <T>(values: T[]) => new Set(values).size === values.length;

export const CatalogueEventRefSchema = z.object({
  eventId: id, startsAt: time, endsAt: time.optional(),
  status: z.enum(['scheduled', 'cancelled', 'unknown']),
  /** When CS's ingestion last fetched this record from the source. */
  fetchedAt: time,
  /** Normalized topic slugs from the catalogue allowlist (never user text or source text). */
  topics: z.array(DiscoveryTagSchema).max(5).refine(unique, 'Duplicate topics'),
  format: z.enum(['in_person', 'online']),
}).strict();

/** One participant's explicitly published event intents (C8), bound to the version they published. */
export const PlanParticipantSchema = z.object({
  ref: id, intentVersion: version, eventIds: z.array(id).max(20).refine(unique, 'Duplicate events'),
}).strict();

/** Request for a plan between two people who already have a basis to meet. */
export const PlanRequestSchema = z.object({
  schemaVersion: z.literal(1), requestId: id,
  /** An accepted introduction, or an existing pair whose C7 activity approval covers events (separate consent). */
  basis: z.object({ kind: z.enum(['introduction', 'existing_connection']), ref: id }).strict(),
  participants: z.tuple([PlanParticipantSchema, PlanParticipantSchema])
    .refine(([a, b]) => a.ref !== b.ref, 'Two different people'),
  /** Catalogue records for candidate events, in DS rank order; the step drops any not in both intents. */
  events: z.array(CatalogueEventRefSchema).max(20).refine(es => unique(es.map(e => e.eventId)), 'Duplicate events'),
}).strict();

export const SharedPlanProposalSchema = z.object({
  schemaVersion: z.literal(1), planId: id, revision: version, requestId: id,
  basis: z.object({ kind: z.enum(['introduction', 'existing_connection']), ref: id }).strict(),
  /** Sorted participant refs with the intent versions the plan was built from. */
  participants: z.tuple([
    z.object({ ref: id, intentVersion: version }).strict(),
    z.object({ ref: id, intentVersion: version }).strict(),
  ]).refine(([a, b]) => a.ref < b.ref, 'Participants sorted and distinct'),
  eventId: id, eventStartsAt: time, sourceFetchedAt: time,
  createdAt: time, expiresAt: time, decidedBy: z.enum(['deterministic', 'agent', 'fixed_template']),
}).strict()
  .refine(p => Date.parse(p.expiresAt) <= Date.parse(p.eventStartsAt), 'A plan must close before the event starts')
  .refine(p => Date.parse(p.createdAt) < Date.parse(p.expiresAt), 'Already expired');

export const PlanOutcomeCodeSchema = z.enum(['proposed', 'no_shared_event', 'source_stale', 'not_current', 'no_fit',
  'proposer_failed_fallback', 'proposer_failed_no_suggestion']);
export const PlanOutcomeSchema = z.object({
  schemaVersion: z.literal(1), requestId: id, outcome: PlanOutcomeCodeSchema,
  mutualEvents: z.number().int().min(0).max(20), usableEvents: z.number().int().min(0).max(20),
  rounds: z.number().int().min(0).max(2), modelCalls: z.number().int().min(0).max(2),
  decidedBy: z.enum(['none', 'deterministic', 'agent', 'fixed_template']), planId: id.optional(),
}).strict();

export type CatalogueEventRef = z.infer<typeof CatalogueEventRefSchema>;
export type PlanParticipant = z.infer<typeof PlanParticipantSchema>;
export type PlanRequest = z.infer<typeof PlanRequestSchema>;
export type SharedPlanProposal = z.infer<typeof SharedPlanProposalSchema>;
export type PlanOutcome = z.infer<typeof PlanOutcomeSchema>;
export type PlanOutcomeCode = z.infer<typeof PlanOutcomeCodeSchema>;
