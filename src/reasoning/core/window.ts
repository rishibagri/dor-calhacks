/**
 * Context window (REASONING.md §10, revision 3): inferredWindow + confidence + fallbackWindow.
 * The runtime infers how long a situation stays useful; the core only enforces the resulting expiry.
 * Expiry is independent of reveal value: an opportunity can be in-window and still wrong to automate.
 */
import { atLeastMedium } from './vocabulary.ts';
import type { ContextWindow } from './types.ts';

/**
 * Optional fallback defaults, used only when no window is supplied by the caller. Not universal rules: the runtime's
 * inferred window replaces them whenever its confidence is at least medium.
 */
export const FALLBACK_WINDOW_DEFAULTS_MINUTES = {
  academic_setback: 3 * 60,
  work_stress: 6 * 60,
  major_good_news: 48 * 60,
  busy_period: 24 * 60,
  silence: 7 * 24 * 60,
  contact_spike: 24 * 60,
  other: 12 * 60,
} as const;

export function effectiveWindowMinutes(w: ContextWindow): number {
  return w.inferredMinutes !== undefined && atLeastMedium(w.confidence) ? w.inferredMinutes : w.fallbackMinutes;
}

export function contextExpiresAt(w: ContextWindow): string {
  return new Date(Date.parse(w.startedAt) + effectiveWindowMinutes(w) * 60_000).toISOString();
}

/** fresh: first half of the window; aging: second half; expired: at or past expiry. */
export function freshnessOf(w: ContextWindow, now: string): 'fresh' | 'aging' | 'expired' {
  const start = Date.parse(w.startedAt), span = effectiveWindowMinutes(w) * 60_000, t = Date.parse(now);
  if (t >= start + span) return 'expired';
  return t - start > span / 2 ? 'aging' : 'fresh';
}
