import { z } from 'zod';
import { SignalCandidateSchema } from './disclosure.js';

/**
 * C1 owner-only output of transient reflection. Persist only in the local vault; never a shared, peer or Factory
 * payload. The candidate reuses FLOWS.md F2's SignalCandidateSchema; an empty candidate is expressed as null (D019).
 */
/**
 * D040/D050 owner-only assessment (docs/features/PRIVATE_ASSESSMENT.md). Literal names and coarse safety routing are
 * used only on-device. Names/risk never leave the owner context; risk can only stop nudging. Never persisted, logged,
 * or sent to shared state, Factory/Droid or analytics.
 */
export const RECIPIENT_INTENTS = ['wants_connection', 'unclear', 'wants_space'] as const;
export const REFLECTION_RISKS = ['none', 'interpersonal_conflict', 'urgent_support'] as const;
export const MAX_EXCLUDED_NAMES = 5;
export const MAX_PREFERRED_NAMES = 3;
export const MAX_MENTIONED_NAMES = 5;
const PrivateNameSchema = z.string().min(1).max(40)
  .refine(n => n === n.trim() && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(n), 'A plain, trimmed name');
const uniqueFold = (names: string[]) => new Set(names.map(n => n.toLowerCase())).size === names.length;
export const PrivateAssessmentSchema = z.object({
  intent: z.enum(RECIPIENT_INTENTS),
  /** Private safety routing only; any non-none value suppresses relationship nudges for this reflection. */
  risk: z.enum(REFLECTION_RISKS).default('none'),
  /** Names literally mentioned by the owner; used only on-device to resolve an accepted connection. */
  mentionedNames: z.array(PrivateNameSchema).max(MAX_MENTIONED_NAMES).default([]).refine(uniqueFold, 'Duplicate names'),
  excludedNames: z.array(PrivateNameSchema).max(MAX_EXCLUDED_NAMES).refine(uniqueFold, 'Duplicate names'),
  preferredNames: z.array(PrivateNameSchema).max(MAX_PREFERRED_NAMES).refine(uniqueFold, 'Duplicate names'),
}).strict().refine(a => !a.preferredNames.some(p => a.excludedNames.some(e => e.toLowerCase() === p.toLowerCase())),
  'A person cannot be both excluded and preferred');

export const PrivateReflectionSchema = z.object({
  schemaVersion: z.literal(1), reflection: z.string().min(1).max(2000),
  candidate: SignalCandidateSchema.refine(c => c.supportMode !== undefined || c.availability !== undefined,
    'Use null when there is nothing to share').nullable(),
  /**
   * D040 owner-only assessment. D042: required whenever there is a candidate, so a refusal written in the entry
   * ("not Alex") can always be honored; optional only when there is nothing to share (`candidate: null`). The app
   * also fails closed on a missing one (CS `failClosedWithoutAssessment`), and our Claude adapter always sets it.
   */
  assessment: PrivateAssessmentSchema.optional(),
}).strict().refine(r => r.candidate === null || r.assessment !== undefined,
  { message: 'A candidate needs an assessment (D042)', path: ['assessment'] });
export type PrivateAssessment = z.infer<typeof PrivateAssessmentSchema>;
export type RecipientIntent = (typeof RECIPIENT_INTENTS)[number];
export type PrivateReflection = z.infer<typeof PrivateReflectionSchema>;
