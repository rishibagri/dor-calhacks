/**
 * D040: Claude's owner-only private assessment → CS's private decision loop (docs/features/PRIVATE_ASSESSMENT.md).
 *
 * Pure and in memory. A unique literal mention can route directly to one accepted connection; risk, wants_space,
 * exclusions or invalid data can only stop/narrow the loop. Ambiguous names ask the owner. It never approves or sends
 * anything itself. These helpers treat a missing
 * assessment as "none" (pure building blocks); the product fails closed on it (D042): the contract requires an
 * assessment whenever there is a candidate, and CS's DecisionLoop wraps the start in `failClosedWithoutAssessment`.
 */
import { PrivateAssessmentSchema, type PrivateAssessment, type SignalCandidate } from '@dor/contracts';
import { answerCompany, startLoop, type LoopState, type Recipient } from '../../components/feature/decision-loop-model.ts';

/** Lowercased, accent-free words of a name: "José-Luis O'Neil" → ["jose", "luis", "oneil"]. */
function words(name: string): string[] {
  return name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’]/g, '')
    .split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/**
 * Whether a name the owner wrote refers to this connection: the whole name matches, or every word of it appears in
 * the connection's name ("Alex" ↔ "Alex Kim", "Alex Kim" ↔ "Alex Kim"). Whole words only, never prefixes ("Al").
 */
export function nameMatches(written: string, recipientName: string): boolean {
  const w = words(written), r = words(recipientName);
  return w.length > 0 && w.every(part => r.includes(part));
}

/**
 * Exclusion matching is deliberately looser, because leaving someone out is the safe direction: each written word
 * must match a word of the connection's name whole or as a prefix of 3+ characters either way ("Alexander" ↔
 * "Alex", "Sam" ↔ "Samantha"). Two-letter fragments ("Al") never match. Preferences keep strict whole words.
 */
export function exclusionMatches(written: string, recipientName: string): boolean {
  const w = words(written), r = words(recipientName);
  const close = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a)));
  return w.length > 0 && w.every(part => r.some(word => close(part, word)));
}

/** Validated assessment, or null for "none". Anything malformed is reported as invalid so callers fail closed. */
function parse(assessment: unknown): { ok: true; value: PrivateAssessment | null } | { ok: false } {
  if (assessment === undefined || assessment === null) return { ok: true, value: null };
  const parsed = PrivateAssessmentSchema.safeParse(assessment);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
}

/** True when the reflection should offer no "Review what to share" step at all. */
export function suggestsNothing(candidate: SignalCandidate | null, assessment: unknown): boolean {
  if (candidate === null) return true;
  const a = parse(assessment);
  return !a.ok || a.value?.intent === 'wants_space' || (a.value !== null && a.value.risk !== 'none');
}

/** The loop's starting state for this reflection episode. Never sets `chosen`. */
export function initialLoopState(candidate: SignalCandidate | null, assessment: unknown): LoopState {
  if (suggestsNothing(candidate, assessment)) return startLoop(null);
  const a = parse(assessment);
  const start = startLoop(candidate);
  // A mentioned person is the trigger; if names are ambiguous, clarify which person rather than whether connection matters.
  return a.ok && a.value && (a.value.intent === 'wants_connection' || a.value.mentionedNames.length > 0)
    ? answerCompany(start, 'company') : start;
}

/**
 * The connections the loop may offer, re-derived on every render from the live list. Explicitly excluded people are
 * removed (an ambiguous name removes every match); preferred people are listed first. Narrow-only: it never adds
 * anyone, and with an invalid assessment it offers no one.
 */
export function assessedRecipients(recipients: readonly Recipient[], assessment: unknown): Recipient[] {
  const a = parse(assessment);
  if (!a.ok) return [];
  if (!a.value) return [...recipients];
  const { excludedNames, preferredNames } = a.value;
  const kept = recipients.filter(r => !excludedNames.some(n => exclusionMatches(n, r.name)));
  const rank = (r: Recipient) => {
    const i = preferredNames.findIndex(n => nameMatches(n, r.name));
    return i === -1 ? preferredNames.length : i;
  };
  return kept.map((r, i) => ({ r, i })).sort((x, y) => rank(x.r) - rank(y.r) || x.i - y.i).map(({ r }) => r);
}

/** One uniquely mentioned accepted connection can proceed automatically; ambiguous or inferred names cannot. */
export function uniquelyPreferredRecipient(recipients: readonly Recipient[], assessment: unknown): Recipient | null {
  const a = parse(assessment);
  if (!a.ok || !a.value || a.value.intent === 'wants_space' || a.value.risk !== 'none') return null;
  const names = a.value.mentionedNames.length > 0 ? a.value.mentionedNames : a.value.preferredNames;
  if (names.length !== 1) return null;
  const matches = recipients.filter(r => nameMatches(names[0]!, r.name));
  return matches.length === 1 ? matches[0]! : null;
}

/**
 * High-recall local safety fallback. This is not a diagnosis or a risk score: recognizable serious-distress terms
 * show the resource card and suppress this reflection's relationship flow even if Claude misses the signal.
 * It never sends the matched text or term anywhere.
 */
export function requiresImmediateSupport(text: string): boolean {
  return /\b(?:depress(?:ion|ed)?|suicid(?:e|al)|self[- ]harm|hurt(?:ing)? myself|kill myself|end my life|don['’]t want to live|do not want to live|can['’]t go on|cannot go on|in immediate danger|feel unsafe)\b/i
    .test(text.normalize('NFKC'));
}

/** Connections left out because of the entry, for the owner-only note "Leaving out X for now, based on your entry." */
export function leftOutByAssessment(recipients: readonly Recipient[], assessment: unknown): Recipient[] {
  const a = parse(assessment);
  if (!a.ok || !a.value) return [];
  return recipients.filter(r => a.value!.excludedNames.some(n => exclusionMatches(n, r.name)));
}

/**
 * Excluded names that match none of the owner's connections (a nickname, a typo, or someone not on dor). CS can
 * show the owner a neutral, owner-only note or ask "Who did you mean?" (counted against the question cap). The
 * owner stays the only one who picks a person, so an unmatched exclusion never silently becomes a choice.
 */
export function unmatchedExclusions(recipients: readonly Recipient[], assessment: unknown): string[] {
  const a = parse(assessment);
  if (!a.ok || !a.value) return [];
  return a.value.excludedNames.filter(n => !recipients.some(r => exclusionMatches(n, r.name)));
}
