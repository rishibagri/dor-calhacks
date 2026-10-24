/**
 * DS Core 1/2 evaluator for the owner-only decision loop (README "Reasoning layer", PRIVATE_DECISION_LOOP.md).
 *
 * Replays a case through the D040 path the journal uses: `initialLoopState(candidate, assessment)` (AI), the owner's
 * taps (CS step functions), then `decide(state, assessedRecipients(recipients, assessment))`. It collects every
 * surface the case can produce: owner-facing system copy (question, note, no-action copy, preview sentence),
 * recipient-visible copy (preview recipientCopy, nudge template) and the offered/previewed people. Scores the
 * result against labels written before any run (fixtures/decision-cases.json); never relabels to match.
 *
 * Offline and synthetic. The private story is handed in as the PrivateReflection text, the seam CS's journal
 * receives. No stage is allowed to read it, and noninterference checks that none does. Evaluation-only consumer
 * of CS's model and AI's assessment helpers, as PRIVATE_DECISION_LOOP.md / PRIVATE_ASSESSMENT.md §4 invite;
 * production code must not import this file.
 */
import {
  NUDGE_TEMPLATE_COPY, PrivateReflectionSchema, RecipientPresetAssignmentSchema, RelationshipPresetSchema,
  previewDisclosure, type DisclosurePreview, type RelationshipPreset, type SignalCandidate,
} from '@dor/contracts';
import {
  NO_ACTION_COPY, QUESTION_COPY, QUESTION_NOTE, answerCompany, answerWho, decide, excludeForNow,
  type CompanyAnswer, type LoopState, type Outcome, type Recipient,
} from '../components/feature/decision-loop-model.ts';
import { assessedRecipients, initialLoopState, leftOutByAssessment } from '../features/voice/assessment.ts';
import { buildNudge, matchSignal } from './matching.ts';

export const FORBIDDEN_LABELS = [
  'unapproved_recipient', 'private_activity', 'location', 'excuse', 'relationship_tension', 'timing_detail',
] as const;
export type ForbiddenLabel = typeof FORBIDDEN_LABELS[number];

export type Step = { company: CompanyAnswer } | { who: string } | { exclude: string };
export interface Person { name: string; recipientId: string; relationship: string }
export interface DecisionCase {
  id: string; pair: string; group: 'support' | 'avoid' | 'uncertain'; relationship: string;
  story: string;
  candidate: unknown;
  recipients: string[];
  /** D040 PrivateAssessment handed to the loop (may be deliberately invalid); null = missing. */
  assessment: unknown;
  steps: Step[];
  expected: { kind: Outcome['kind']; reason?: string; recipient?: string; question?: string; options?: string[] };
  forbidden: Partial<Record<ForbiddenLabel, string[]>>;
  knownGap?: string;
}
/** A fixture row: either inline story/candidate/assessment, or a reference into AI's reflection fixture. */
export type DecisionRow = Omit<DecisionCase, 'story' | 'candidate' | 'assessment'> & Partial<DecisionCase> & {
  reflectionRef?: string; candidateOverride?: unknown; assessmentOverride?: unknown;
};
export interface ReflectionFixture { cases: { id: string; input: string; output: { candidate: unknown; assessment?: unknown } }[] }
export interface DecisionFile {
  clock: string; ownerId: string; people: Record<string, Person>; cases: DecisionCase[];
  noninterference: { candidate: SignalCandidate; assessment: unknown; recipients: string[]; steps: Step[]; stories: string[] };
}

/** Fills reflectionRef rows from AI's fixture (no copy kept in DS), applying DS overrides. Unknown refs throw. */
export function resolveCases(file: Omit<DecisionFile, 'cases'> & { cases: DecisionRow[] }, reflections: ReflectionFixture): DecisionFile {
  const cases = file.cases.map((row): DecisionCase => {
    if (!row.reflectionRef) return row as DecisionCase;
    const r = reflections.cases.find((c) => c.id === row.reflectionRef);
    if (!r) throw new Error(`unknown reflectionRef ${row.reflectionRef}`);
    return {
      ...row, story: r.input,
      candidate: 'candidateOverride' in row ? row.candidateOverride : r.output.candidate,
      assessment: 'assessmentOverride' in row ? row.assessmentOverride : (r.output.assessment ?? null),
    } as DecisionCase;
  });
  return { ...file, cases };
}

export interface Surfaces {
  /** Fixed system copy shown to the owner for this outcome (never the entry itself). */
  owner: string[];
  /** Anything the recipient could see if the owner later approved this preview. */
  recipient: string[];
  /** pairIds offered in a who-question, or previewed. */
  offered: string[];
  preview: DisclosurePreview | null;
}
export interface Leak { label: ForbiddenLabel; term: string; surface: 'owner' | 'recipient' | 'offered' }
export interface DecisionScore {
  id: string; outcome: Outcome; matches: boolean; leaks: Leak[];
  /** Unsafe suggestion: a preview where none was expected, or for the wrong person. Leaks are counted separately. */
  unsafe: boolean;
  /** Missed suggestion: a preview was expected and did not happen (README Core 3). */
  missed: boolean;
  /** Appropriate silence: no_action expected and produced. */
  silence: boolean;
  /** People the episode excluded (owner taps or assessment) who were offered or previewed anyway. */
  excludedSurfaced: string[];
}

const SYNTHETIC_PRESET = (ownerId: string, now: Date): RelationshipPreset => RelationshipPresetSchema.parse({
  schemaVersion: 1, policyId: 'decision-eval-policy', ownerId, presetKind: 'friend', purpose: 'support_nudge',
  allowedCategories: ['support_preference', 'coarse_availability'], approvalMode: 'each_item', version: 1,
  expiresAt: new Date(now.getTime() + 86_400_000).toISOString(), revokedAt: null,
});

export function recipientsOf(file: DecisionFile, ids: readonly string[]): Recipient[] {
  return ids.map((pairId) => ({ pairId, name: file.people[pairId]!.name }));
}

/**
 * Starts from a full PrivateReflection (the journal seam) so the story is present but must stay unread. Inputs the
 * contract rejects are passed through raw, so what is measured is the loop's own handling of them.
 */
export function replay(file: DecisionFile, story: string, candidate: unknown, recipientIds: readonly string[],
  steps: readonly Step[], assessment: unknown = null): { state: LoopState; outcome: Outcome; excluded: string[] } {
  const reflection = PrivateReflectionSchema.safeParse({ schemaVersion: 1, reflection: story, candidate,
    ...(assessment === null ? {} : { assessment }) });
  const c = reflection.success ? reflection.data.candidate : (candidate as SignalCandidate | null);
  const a = reflection.success ? reflection.data.assessment : assessment;
  let s = initialLoopState(c, a);
  for (const step of steps) {
    if ('company' in step) s = answerCompany(s, step.company);
    else if ('who' in step) s = answerWho(s, step.who);
    else s = excludeForNow(s, step.exclude);
  }
  const recipients = recipientsOf(file, recipientIds);
  const excluded = [...new Set([...s.excluded, ...leftOutByAssessment(recipients, a).map((r) => r.pairId)])];
  return { state: s, outcome: decide(s, assessedRecipients(recipients, a)), excluded };
}

export function surfacesOf(file: DecisionFile, outcome: Outcome): Surfaces {
  if (outcome.kind === 'no_action') return { owner: [NO_ACTION_COPY[outcome.reason]], recipient: [], offered: [], preview: null };
  if (outcome.kind === 'needs_clarification')
    return { owner: [QUESTION_COPY[outcome.question], QUESTION_NOTE], recipient: [], offered: outcome.options.map((o) => o.pairId), preview: null };
  const now = new Date(file.clock);
  const person = file.people[outcome.recipient.pairId]!;
  const preset = SYNTHETIC_PRESET(file.ownerId, now);
  const assignment = RecipientPresetAssignmentSchema.parse({
    schemaVersion: 1, ownerId: file.ownerId, recipientId: person.recipientId, pairId: outcome.recipient.pairId,
    presetId: preset.policyId, assignmentVersion: 1,
  });
  const preview = previewDisclosure({
    candidate: outcome.candidate, ownerId: file.ownerId, recipientId: person.recipientId, pairId: outcome.recipient.pairId,
    pairStatus: 'accepted', preset, assignment, now,
  }, outcome.recipient.name);
  return {
    owner: preview.kind === 'shareable' ? [preview.ownerSentence] : [],
    recipient: preview.kind === 'shareable' && preview.recipientCopy ? [preview.recipientCopy] : [],
    offered: [outcome.recipient.pairId],
    preview,
  };
}

const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (text: string, term: string) => new RegExp(`(^|\\W)${escape(term)}($|\\W)`, 'i').test(text);

export function leaksOf(file: DecisionFile, c: DecisionCase, s: Surfaces): Leak[] {
  const leaks: Leak[] = [];
  for (const label of FORBIDDEN_LABELS) for (const term of c.forbidden[label] ?? []) {
    for (const text of s.owner) if (mentions(text, term)) leaks.push({ label, term, surface: 'owner' });
    for (const text of s.recipient) if (mentions(text, term)) leaks.push({ label, term, surface: 'recipient' });
    if (label === 'unapproved_recipient')
      for (const id of s.offered) if (id === term || file.people[id]?.name.toLowerCase() === term.toLowerCase())
        leaks.push({ label, term, surface: 'offered' });
  }
  return leaks;
}

function matchesExpected(c: DecisionCase, o: Outcome): boolean {
  const e = c.expected;
  if (o.kind !== e.kind) return false;
  if (e.reason !== undefined && (o.kind !== 'no_action' || o.reason !== e.reason)) return false;
  if (e.recipient !== undefined && (o.kind !== 'ready_for_preview' || o.recipient.pairId !== e.recipient)) return false;
  if (e.question !== undefined && (o.kind !== 'needs_clarification' || o.question !== e.question)) return false;
  if (e.options !== undefined && (o.kind !== 'needs_clarification'
    || JSON.stringify(o.options.map((r) => r.pairId)) !== JSON.stringify(e.options))) return false;
  return true;
}

/** A deterministic system under evaluation: one case in, the outcome the owner would see out. */
export type DecisionSystem = (file: DecisionFile, c: DecisionCase) => Outcome;

/** The current pipeline: D040 assessment → owner taps → CS decide(). */
export const d040Loop: DecisionSystem = (file, c) => replay(file, c.story, c.candidate, c.recipients, c.steps, c.assessment).outcome;

/**
 * Scores one system on one case. Who the episode excluded (owner taps + entry assessment) is taken from the D040
 * replay for every system, so a baseline that ignores an exclusion is charged for surfacing that person.
 */
export function scoreCase(file: DecisionFile, c: DecisionCase, system: DecisionSystem = d040Loop): DecisionScore {
  const { excluded } = replay(file, c.story, c.candidate, c.recipients, c.steps, c.assessment);
  const outcome = system(file, c);
  const surfaces = surfacesOf(file, outcome);
  const leaks = leaksOf(file, c, surfaces);
  const matches = matchesExpected(c, outcome);
  const expectPreview = c.expected.kind === 'ready_for_preview';
  const gotPreview = outcome.kind === 'ready_for_preview';
  const unsafe = gotPreview && (!expectPreview || outcome.recipient.pairId !== c.expected.recipient);
  return {
    id: c.id, outcome, matches, leaks, unsafe, missed: expectPreview && !gotPreview,
    silence: c.expected.kind === 'no_action' && outcome.kind === 'no_action',
    excludedSurfaced: surfaces.offered.filter((id) => excluded.includes(id)),
  };
}

/** Everything a recipient or the delivery schedule could depend on, for one story. Must not vary with the story. */
export function observable(file: DecisionFile, story: string) {
  const n = file.noninterference;
  const { outcome } = replay(file, story, n.candidate, n.recipients, n.steps, n.assessment);
  const s = surfacesOf(file, outcome);
  let nudge: unknown = null;
  if (s.preview?.kind === 'shareable' && outcome.kind === 'ready_for_preview') {
    const now = new Date(file.clock);
    const person = file.people[outcome.recipient.pairId]!;
    const signal = {
      schemaVersion: 2, signalId: 'sig-noninterference', pairId: outcome.recipient.pairId, senderId: file.ownerId,
      recipientId: person.recipientId, purpose: 'support_nudge', ...s.preview.payload, consentVersion: 1,
      recipientPolicyId: 'decision-eval-policy', recipientPolicyVersion: 1, presetAssignmentVersion: 1,
      expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
    };
    const ack = { schemaVersion: 1, signalId: signal.signalId, recipientConsentId: 'consent-1', recipientConsentVersion: 1,
      decision: 'compatible', ...s.preview.payload };
    const m = matchSignal({ signal, policy: { allowed: true, reason: 'ok' }, ack, now, inQuietHours: false, lastNudgeAt: null });
    nudge = m.outcome === 'nudge'
      ? { ...buildNudge(signal as never, ack as never, m, { id: 'nudge-noninterference', now }), copy: NUDGE_TEMPLATE_COPY[m.templateId] }
      : m;
  }
  return { outcome, surfaces: s, nudge };
}
