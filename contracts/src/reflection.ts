import { z } from 'zod';
import { SignalCandidateSchema } from './disclosure.js';

/**
 * C1 owner-only output of transient reflection. Persist only in the local vault; never a shared, peer or Factory
 * payload. The candidate reuses FLOWS.md F2's SignalCandidateSchema; an empty candidate is expressed as null (D019).
 */
export const PrivateReflectionSchema = z.object({
  schemaVersion: z.literal(1), reflection: z.string().min(1).max(2000),
  candidate: SignalCandidateSchema.refine(c => c.supportMode !== undefined || c.availability !== undefined,
    'Use null when there is nothing to share').nullable(),
}).strict();
export type PrivateReflection = z.infer<typeof PrivateReflectionSchema>;
