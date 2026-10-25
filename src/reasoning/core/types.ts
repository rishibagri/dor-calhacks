/**
 * Reasoning v1 types (REASONING.md §10). Local to Reasoning until a second workstream consumes ReasoningDecision;
 * then it moves to @dor/contracts with review.
 *
 * Seam: ranked CandidateProposal[] (from the agentic runtime; in v1 tests, the labeled reference policy) →
 * finalize() → ReasoningDecision.
 */
import type { Nudge, SharingCategory, SupportMode } from '@dor/contracts';
import type {
  ActionSurface, CandidateAction, Factor, Level, ReasonCode, ReassessCondition, ReasoningMode, Risk,
} from './vocabulary.ts';

/** Opaque, owner-local evidence reference, e.g. 'assessment:intent', 'pattern:p1', 'book:b3'. */
export type EvidenceRef = string;

/**
 * Useful window of the situation. The runtime infers it with a confidence; the core falls back to `fallbackMinutes`
 * when confidence is below medium. Independent of reveal value.
 */
export interface ContextWindow {
  startedAt: string;
  inferredMinutes?: number;
  confidence: Level;
  fallbackMinutes: number;
}

/** Mirror of the current authoritative gates (REASONING.md §8 L4), read from the owner's caller-filtered views. */
export interface GateMirror {
  paused: boolean;
  optedOut: boolean | 'unknown';
  cooldownUntil?: string;
  quietHoursNow: boolean | 'unknown';
  presetRevoked: boolean;
  /** The default preset allows both categories. */
  presetCategories: SharingCategory[];
}

export interface RelationshipInput {
  ref: string;
  gates: GateMirror;
  conflict: 'none' | 'unresolved' | 'unknown';
  sensitiveTopics: string[] | 'unknown';
}

export interface ReasoningEpisodeInput {
  schemaVersion: 1;
  episodeId: string;
  now: string;
  hardStops: { risk: Risk; assessmentValid: boolean };
  /** The owner's own words and taps. Outranks every inferred pattern (P11). */
  explicitIntent: { wantsSpace: boolean; doesNotWantToTalk: boolean; excludedRefs: string[]; namedRefs: string[] };
  window: ContextWindow;
  relationships: RelationshipInput[];
  /** Every evidence ref available in this episode; proposals may cite only these. */
  evidence: EvidenceRef[];
}

export interface CandidateProposal {
  /** Proposer's preference order; lower is preferred. The core never re-ranks by score. */
  rank: number;
  action: CandidateAction;
  targetRef?: string;
  requestedMode: ReasoningMode;
  evidenceRefs: EvidenceRef[];
  /** §2.5 factor judgments, recorded for audit, never summed. */
  judgments: Partial<Record<Factor, Level>>;
  revealValue: Level;
  /** Preferred existing support mode for a deliverable action; must be allowed for the action (ACTION_SUPPORT_MODES). */
  supportMode?: SupportMode;
  /** Topic of the situation, checked against the relationship's sensitive topics. */
  topic?: string;
  timing: { kind: 'now' | 'after_delay' | 'not_now'; delayMinutes?: number };
  reassess?: { afterMinutes: number; condition: ReassessCondition };
  alternativeInterpretation?: ReasonCode;
  confidence: Level;
  rationale: ReasonCode[];
  /** The proposer considered this and set it aside; recorded as rejected, never selected. */
  dismissed?: ReasonCode;
}

export interface FinalizeOptions {
  /** Offline/test-only (REASONING.md §9 C1b): allow `act` toward a connection the user did not name. Default false. */
  allowUnnamedTargets?: boolean;
}

export interface RejectedCandidate { action: CandidateAction; targetRef?: string; reason: ReasonCode }

export interface ReasoningDecision {
  schemaVersion: 1;
  episodeId: string;
  mode: ReasoningMode;
  action?: CandidateAction;
  targetRef?: string;
  surface?: ActionSurface;
  deliveryMapping?: { supportMode: SupportMode; intendedTemplate: Nudge['templateId'] };
  evidenceRefs: EvidenceRef[];
  freshness: 'fresh' | 'aging' | 'expired';
  timing: 'now' | 'after_delay' | 'not_now' | 'n/a';
  timingDelayMinutes?: number;
  alternativeInterpretation?: ReasonCode;
  confidence: Level;
  contextExpiresAt: string;
  /** Present only for defer; never carries an action (P9, P14). */
  reassess?: { afterMinutes: number; condition: ReassessCondition };
  capped?: { from: ReasoningMode; by: ReasonCode };
  reasons: ReasonCode[];
  summary: string;
  rejected: RejectedCandidate[];
}
