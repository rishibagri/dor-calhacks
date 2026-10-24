import type { PrivateAssessment, PrivateReflection, SignalCandidate } from '@dor/contracts';

/**
 * Pure rules for the voice/reflection feature (AI-owned). No React, no network: the component composes these.
 * Privacy rules they encode (D021 review, src/privacy/REVIEWS.md):
 * - only the text the owner selected is sent for reflection;
 * - the reflection text may be persisted locally; the candidate never is (it stays in memory);
 * - a dictated transcript is just draft text the owner can correct before anything is sent.
 */

/** Mirrors MAX_SELECTED_TEXT_CHARS in src/agents (reflection route rejects longer input). */
export const MAX_REFLECT_CHARS = 8000;
/** Cartesia TTS input bound for read-aloud; the reflection schema caps output at 2000 already. */
export const MAX_SPEAK_CHARS = 2000;

export interface Selection { start: number; end: number }

/** Insert a finished transcript at the caret (or replace the selected range), spacing it from its neighbours. */
export function insertTranscript(draft: string, transcript: string, at: Selection = { start: draft.length, end: draft.length }):
  { text: string; caret: number } {
  const spoken = transcript.trim();
  const start = clamp(at.start, 0, draft.length), end = clamp(Math.max(at.end, start), 0, draft.length);
  if (!spoken) return { text: draft, caret: end };
  const before = draft.slice(0, start), after = draft.slice(end);
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  const trail = after && !/^\s/.test(after) ? ' ' : '';
  const text = before + lead + spoken + trail + after;
  return { text, caret: before.length + lead.length + spoken.length };
}

export type ReflectInput = { ok: true; text: string; scope: 'selection' | 'entry' } | { ok: false; reason: 'empty' | 'too_long' };

/** What would be sent: the highlighted range if there is one, otherwise the whole entry. */
export function textToReflect(draft: string, selection?: Selection): ReflectInput {
  const hasSelection = selection !== undefined && selection.end > selection.start;
  const text = (hasSelection ? draft.slice(selection.start, selection.end) : draft).trim();
  if (!text) return { ok: false, reason: 'empty' };
  if (text.length > MAX_REFLECT_CHARS) return { ok: false, reason: 'too_long' };
  return { ok: true, text, scope: hasSelection ? 'selection' : 'entry' };
}

/** Splits a route result into what may be stored locally and what must stay in memory. */
export function splitReflection(result: PrivateReflection): {
  persist: { reflection: string }; memoryOnly: SignalCandidate | null; assessment: PrivateAssessment | undefined;
} {
  // Only the reflection text is ever persisted; the candidate and the D040 assessment stay in memory.
  return { persist: { reflection: result.reflection }, memoryOnly: result.candidate, assessment: result.assessment };
}

const MODE_COPY: Record<string, string> = {
  short_call: 'a short call', encouraging_note: 'an encouraging note', shared_activity: 'doing something together',
};
const AVAILABILITY_COPY: Record<string, string> = {
  today: 'today', this_week: 'this week', no_preference: 'whenever works',
};

/** Plain-language suggestion. It is a suggestion to review, never something already shared. */
export function describeCandidate(candidate: SignalCandidate | null): string | null {
  if (!candidate || (!candidate.supportMode && !candidate.availability)) return null;
  const mode = candidate.supportMode ? MODE_COPY[candidate.supportMode] : null;
  const when = candidate.availability ? AVAILABILITY_COPY[candidate.availability] : null;
  if (mode && when) return `You might welcome ${mode}, ${when}.`;
  if (mode) return `You might welcome ${mode}.`;
  return `You mentioned being free ${when}.`;
}

/** Bounded read-aloud text, cut at a sentence or word boundary when possible. */
export function speakableText(text: string): string {
  const clean = text.trim();
  if (clean.length <= MAX_SPEAK_CHARS) return clean;
  const cut = clean.slice(0, MAX_SPEAK_CHARS);
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (sentence > MAX_SPEAK_CHARS / 2) return cut.slice(0, sentence + 1);
  const word = cut.lastIndexOf(' ');
  return word > 0 ? cut.slice(0, word) : cut;
}

export type VoiceFailure = 'mic_denied' | 'mic_unavailable' | 'unauthenticated' | 'rate_limited' | 'unavailable'
  | 'network' | 'provider';

/** Every failure keeps typed entry available; copy never echoes provider detail. */
export function voiceFailureCopy(code: VoiceFailure | string): string {
  switch (code) {
    case 'mic_denied': return 'Microphone access was blocked. You can keep typing, or allow the microphone in your browser settings.';
    case 'mic_unavailable': return 'No microphone is available here. You can keep typing.';
    case 'unauthenticated': return 'Your session has ended. Sign in again to use voice; typing still works.';
    case 'rate_limited': return 'Voice is busy right now. Try again in a minute, or keep typing.';
    default: return 'Voice is unavailable right now. Anything already transcribed is kept; you can keep typing.';
  }
}

export function reflectFailureCopy(code: string): string {
  switch (code) {
    case 'unauthenticated': return 'Your session has ended. Sign in again to reflect.';
    case 'rate_limited': return 'Too many reflections in a short time. Try again in a minute.';
    case 'invalid': case 'invalid_input': case 'refused': return 'That text could not be reflected on. Try a shorter or different passage.';
    case 'aborted': return 'Reflection cancelled.';
    default: return 'Reflection is unavailable right now. Your entry is unchanged.';
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : hi));
}
