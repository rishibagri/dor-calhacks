/**
 * Owner-side helpers for the D041 recipient pause. The server is the authority (it refuses, hides and suppresses);
 * this is the client's defence in depth plus the duration choices. No reason is ever asked for or stored.
 */
import type { RecipientPause } from '@/lib/backend/ports';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Module bounds (contracts PAUSE_MAX_LIFETIME_MS = 30 days; minimum 15 minutes). */
export const PAUSE_MAX_MS = 30 * 24 * HOUR;
export const PAUSE_MIN_MS = 15 * MINUTE;

export interface PauseChoice { id: string; label: string; ms: number }
export const PAUSE_CHOICES: readonly PauseChoice[] = [
  { id: 'tonight', label: 'Tonight (12 hours)', ms: 12 * HOUR },
  { id: 'day', label: '24 hours', ms: 24 * HOUR },
  { id: 'three_days', label: '3 days', ms: 72 * HOUR },
  { id: 'week', label: '1 week', ms: 7 * 24 * HOUR },
].map((c) => ({ ...c, ms: Math.min(Math.max(c.ms, PAUSE_MIN_MS), PAUSE_MAX_MS) }));

/** ISO end time for a choice, relative to `now`. */
export function pauseEndsAt(choice: PauseChoice, now: Date): string {
  return new Date(now.getTime() + choice.ms).toISOString();
}

/** In force: the server says active AND the end time has not passed on this clock (views have no clock). */
export function isPauseInForce(pause: RecipientPause | undefined, now: Date): boolean {
  return Boolean(pause && pause.active && Date.parse(pause.expiresAt) > now.getTime());
}

export function pauseFor(pauses: readonly RecipientPause[], pairId: string): RecipientPause | undefined {
  return pauses.find((p) => p.pairId === pairId);
}

/** Version to send as expectedVersion: 0 when never paused. */
export function pauseVersion(pauses: readonly RecipientPause[], pairId: string): number {
  return pauseFor(pauses, pairId)?.version ?? 0;
}

/** Drops recipients whose pair is currently paused. Pure; never selects anyone else. */
export function withoutPaused<T extends { pairId: string }>(
  recipients: readonly T[], pauses: readonly RecipientPause[], now: Date,
): { eligible: T[]; pausedCount: number } {
  const eligible = recipients.filter((r) => !isPauseInForce(pauseFor(pauses, r.pairId), now));
  return { eligible, pausedCount: recipients.length - eligible.length };
}

export const PAUSED_NOT_OFFERED = 'Paused connections are not offered.';
export const PAUSE_PROMISE = 'They are not notified.';

export function pausedUntilLabel(pause: RecipientPause): string {
  return `Paused until ${new Date(pause.expiresAt).toLocaleString()}`;
}
