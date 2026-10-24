/**
 * Owner-only private decision loop (README "Reasoning layer and human-in-the-loop", Core 2, CS).
 *
 * Pure and in-memory. Takes the reflection's private candidate and the owner's own answers to at most two neutral
 * questions, and decides one of the proposed owner-side outcomes (design vocabulary, NOT a shared contract):
 *   no_action | needs_clarification | ready_for_preview
 * `ready_for_preview` only unlocks the existing exact-recipient ShareReview; it never approves or sends anything.
 *
 * Rules enforced here:
 * - A clarification answer is never consent; it can only narrow or stop.
 * - Skip, "space", "no one", an unresolved recipient or the question cap → no_action (never an optimistic fallback).
 * - An episode exclusion ("not Alex this time") removes that person from every later step; nothing re-adds them.
 * - Questions are fixed neutral copy about the owner's own wishes; they never mention a queued nudge, another
 *   person's request, an event, a place or anything from the entry.
 * - Answers, exclusions and the candidate are never persisted or sent; the caller drops this state on lock,
 *   pagehide, sign-out and account switch.
 */
import type { SignalCandidate } from '@dor/contracts';

export const MAX_QUESTIONS = 2;

/** Fixed, neutral copy (README examples). Never interpolated with entry content. */
export const QUESTION_COPY = {
  company: 'Would company feel good right now, or would you prefer some space?',
  who: 'Is there someone you would feel comfortable hearing from?',
} as const;

export const QUESTION_NOTE =
  'Your answers stay on this screen and only shape private suggestions. Nothing is shared unless you approve it separately.';

export type CompanyAnswer = 'company' | 'space' | 'skip';

export interface Recipient { pairId: string; name: string }

export interface LoopState {
  candidate: SignalCandidate | null;
  company: CompanyAnswer | null;
  /** pairId chosen in the "who" step; null = not answered; 'none' = nobody / not sure. */
  chosen: string | 'none' | null;
  /** Episode-only exclusions (pairIds). Narrow-only. */
  excluded: readonly string[];
  /** Distinct questions shown so far. Re-answering one is not a new question; the cap counts distinct ones. */
  asked: readonly (keyof typeof QUESTION_COPY)[];
}

export type Outcome =
  | { kind: 'no_action'; reason: 'nothing_to_share' | 'prefers_space' | 'skipped' | 'no_recipient' | 'no_eligible_recipient' | 'question_cap' }
  | { kind: 'needs_clarification'; question: keyof typeof QUESTION_COPY; options: readonly Recipient[] }
  | { kind: 'ready_for_preview'; recipient: Recipient; candidate: SignalCandidate };

export function startLoop(candidate: SignalCandidate | null): LoopState {
  return { candidate, company: null, chosen: null, excluded: [], asked: [] };
}

const eligible = (s: LoopState, recipients: readonly Recipient[]) => recipients.filter((r) => !s.excluded.includes(r.pairId));

/** Derives the current outcome. `recipients` = accepted connections only (from the caller's own pairs view). */
export function decide(s: LoopState, recipients: readonly Recipient[]): Outcome {
  if (s.candidate === null) return { kind: 'no_action', reason: 'nothing_to_share' };
  if (s.company === 'space') return { kind: 'no_action', reason: 'prefers_space' };
  if (s.company === 'skip') return { kind: 'no_action', reason: 'skipped' };
  const options = eligible(s, recipients);
  if (s.company === null) return ask(s, 'company', options);
  if (options.length === 0) return { kind: 'no_action', reason: 'no_eligible_recipient' };
  if (s.chosen === 'none') return { kind: 'no_action', reason: 'no_recipient' };
  if (s.chosen === null) return ask(s, 'who', options);
  const recipient = options.find((r) => r.pairId === s.chosen);
  // Chosen person no longer eligible (excluded, unlinked): never guess another one.
  if (!recipient) return { kind: 'no_action', reason: 'no_recipient' };
  return { kind: 'ready_for_preview', recipient, candidate: s.candidate };
}

/** A question already shown may be shown again; a new one only while under the cap. */
function ask(s: LoopState, question: keyof typeof QUESTION_COPY, options: readonly Recipient[]): Outcome {
  if (!s.asked.includes(question) && s.asked.length >= MAX_QUESTIONS) return { kind: 'no_action', reason: 'question_cap' };
  return { kind: 'needs_clarification', question, options };
}

const withAsked = (s: LoopState, q: keyof typeof QUESTION_COPY) => (s.asked.includes(q) ? s.asked : [...s.asked, q]);

export function answerCompany(s: LoopState, answer: CompanyAnswer): LoopState {
  // Changing this answer restarts the later step: an earlier choice of person never carries over.
  return { ...s, company: answer, chosen: null, asked: withAsked(s, 'company') };
}

export function answerWho(s: LoopState, pairId: string | 'none'): LoopState {
  if (s.company !== 'company') return s;
  if (pairId !== 'none' && s.excluded.includes(pairId)) return s;
  return { ...s, chosen: pairId, asked: withAsked(s, 'who') };
}

/** "Not this person this time": narrows, clears them if chosen, and is never undone within this episode. */
export function excludeForNow(s: LoopState, pairId: string): LoopState {
  if (s.excluded.includes(pairId)) return s;
  return { ...s, excluded: [...s.excluded, pairId], chosen: s.chosen === pairId ? null : s.chosen };
}

/** Plain owner-facing copy for a no_action outcome; never mentions anyone else or any queued work. */
export const NO_ACTION_COPY: Record<Extract<Outcome, { kind: 'no_action' }>['reason'], string> = {
  nothing_to_share: 'Nothing here needs sharing. Your entry stays private.',
  prefers_space: 'Okay. Nothing will be suggested or shared. Your entry stays private.',
  skipped: 'Skipped. Nothing will be shared.',
  no_recipient: 'Okay, no one right now. Nothing will be shared.',
  no_eligible_recipient: 'There is no one to suggest right now. Nothing will be shared.',
  question_cap: 'Nothing will be shared from this entry.',
};
