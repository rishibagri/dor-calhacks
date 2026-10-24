/**
 * DS Core 1/2 evaluator for the owner-only decision loop (README "Reasoning layer", PRIVATE_DECISION_LOOP.md).
 *
 * Replays a case's owner taps through CS's pure model (`decide()` and its step functions), then collects every
 * surface the case can produce: owner-facing system copy (question, note, no-action copy, preview sentence),
 * recipient-visible copy (preview recipientCopy, nudge template) and the offered/previewed people. Scores the
 * result against labels written before any run (fixtures/decision-cases.json); never relabels to match.
 *
 * Offline and synthetic. The private story is handed in as the PrivateReflection text, the seam CS's journal
 * receives. No stage is allowed to read it, and noninterference checks that none does. Evaluation-only consumer
 * of CS's model, as PRIVATE_DECISION_LOOP.md invites; production code must not import this file.
 */
import {
  NUDGE_TEMPLATE_COPY, PrivateReflectionSchema, RecipientPresetAssignmentSchema, RelationshipPresetSchema,
  previewDisclosure, type DisclosurePreview, type RelationshipPreset, type SignalCandidate,
} from '@dor/contracts';
import {
  NO_ACTION_COPY, QUESTION_COPY, QUESTION_NOTE, answerCompany, answerWho, decide, excludeForNow, startLoop,
  type CompanyAnswer, type LoopState, type Outcome, type Recipient,
} from '../components/feature/decision-loop-model.ts';
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
  /** What a correct private assessment hands the loop. It may exclude; it may never choose. null = none today. */
  assessment: { exclude: string[] } | null;
  steps: Step[];
  expected: { kind: Outcome['kind']; reason?: string; recipient?: string; question?: string; options?: string[] };
  forbidden: Partial<Record<ForbiddenLabel, string[]>>;
  knownGap?: string;
}
export interface DecisionFile {
  clock: string; ownerId: string; people: Record<string, Person>; cases: DecisionCase[];
  noninterference: { candidate: SignalCandidate; recipients: string[]; steps: Step[]; stories: string[] };
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
  /** Worse than expected in the sharing direction: an unexpected preview, a wrong recipient or any leak. */
  unsafe: boolean;
  /** A preview was expected and did not happen. Reported separately from unsafe (README Core 3). */
  missed: boolean;
}

const SYNTHETIC_PRESET = (ownerId: string, now: Date): RelationshipPreset => RelationshipPresetSchema.parse({
  schemaVersion: 1, policyId: 'decision-eval-policy', ownerId, presetKind: 'friend', purpose: 'support_nudge',
  allowedCategories: ['support_preference', 'coarse_availability'], approvalMode: 'each_item', version: 1,
  expiresAt: new Date(now.getTime() + 86_400_000).toISOString(), revokedAt: null,
});

export function recipientsOf(file: DecisionFile, ids: readonly string[]): Recipient[] {
  return ids.map((pairId) => ({ pairId, name: file.people[pairId]!.name }));
}

/** Starts from a full PrivateReflection (the journal seam) so the story is present but must stay unread. */
export function replay(file: DecisionFile, story: string, candidate: unknown, recipientIds: readonly string[],
  steps: readonly Step[], assessment: DecisionCase['assessment'] = null): { state: LoopState; outcome: Outcome } {
  const reflection = PrivateReflectionSchema.safeParse({ schemaVersion: 1, reflection: story, candidate });
  // A candidate the contract rejects is passed through raw so CS's own handling is what gets measured.
  let s = startLoop(reflection.success ? reflection.data.candidate : (candidate as SignalCandidate | null));
  for (const id of assessment?.exclude ?? []) s = excludeForNow(s, id);
  for (const step of steps) {
    if ('company' in step) s = answerCompany(s, step.company);
    else if ('who' in step) s = answerWho(s, step.who);
    else s = excludeForNow(s, step.exclude);
  }
  return { state: s, outcome: decide(s, recipientsOf(file, recipientIds)) };
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

export function scoreCase(file: DecisionFile, c: DecisionCase): DecisionScore {
  const { outcome } = replay(file, c.story, c.candidate, c.recipients, c.steps, c.assessment);
  const leaks = leaksOf(file, c, surfacesOf(file, outcome));
  const matches = matchesExpected(c, outcome);
  const expectPreview = c.expected.kind === 'ready_for_preview';
  const gotPreview = outcome.kind === 'ready_for_preview';
  const unsafe = leaks.length > 0 || (gotPreview && (!expectPreview || outcome.recipient.pairId !== c.expected.recipient));
  return { id: c.id, outcome, matches, leaks, unsafe, missed: expectPreview && !gotPreview };
}

/** Everything a recipient or the delivery schedule could depend on, for one story. Must not vary with the story. */
export function observable(file: DecisionFile, story: string) {
  const n = file.noninterference;
  const { outcome } = replay(file, story, n.candidate, n.recipients, n.steps);
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
