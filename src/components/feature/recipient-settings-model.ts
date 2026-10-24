/**
 * Pure helpers for the recipient settings form (D017/D018 delivery opt-in, D035 support consent).
 * The reducers re-validate everything; these only shape input and catch mistakes early.
 */
import { AVAILABILITIES, PREFERENCE_MAX_LIFETIME_MS, SUPPORT_MODES } from '@dor/contracts/policy';
import type { Availability, SupportMode } from '@dor/contracts';
import type { NudgeDeliveryView, SupportPreferencesView } from '@/lib/backend/ports';

const DAY_MS = 24 * 60 * 60 * 1000;

export const SUPPORT_MODE_LABELS: Record<SupportMode, string> = {
  short_call: 'A short call',
  encouraging_note: 'An encouraging note',
  shared_activity: 'Doing something together',
};

export const AVAILABILITY_LABELS: Record<Availability, string> = {
  today: 'Today',
  this_week: 'This week',
  no_preference: 'Any time',
};

/** Consent durations offered; all stay under PREFERENCE_MAX_LIFETIME_MS so clock skew cannot push past it. */
export const CONSENT_DURATION_DAYS = [7, 14, 28] as const;
export type ConsentDurationDays = (typeof CONSENT_DURATION_DAYS)[number];

export { AVAILABILITIES, SUPPORT_MODES };

export function consentExpiry(nowMs: number, days: ConsentDurationDays): string {
  const ms = Math.min(days * DAY_MS, PREFERENCE_MAX_LIFETIME_MS - DAY_MS);
  return new Date(nowMs + ms).toISOString();
}

/** "HH:MM" → minute of day, or null for empty / malformed input. */
export function parseClock(value: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function formatClock(minute: number | null): string {
  if (minute === null) return '';
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/** Browser's current offset in the sign convention the module uses (UTC+2 → 120). */
export function localUtcOffsetMinutes(date: Date = new Date()): number {
  return -date.getTimezoneOffset();
}

export type DeliveryDraft = { optedIn: boolean; quietStart: string; quietEnd: string };

/** Builds set_nudge_delivery input. Quiet hours need both ends or neither. */
export function buildDelivery(
  pairId: string, draft: DeliveryDraft, utcOffsetMinutes: number,
): { ok: true; value: NudgeDeliveryView } | { ok: false; message: string } {
  const start = draft.quietStart.trim() === '' ? null : parseClock(draft.quietStart);
  const end = draft.quietEnd.trim() === '' ? null : parseClock(draft.quietEnd);
  if ((draft.quietStart.trim() !== '' && start === null) || (draft.quietEnd.trim() !== '' && end === null)) {
    return { ok: false, message: 'Quiet hours must be times like 22:00.' };
  }
  if ((start === null) !== (end === null)) return { ok: false, message: 'Set both quiet-hour times, or neither.' };
  return { ok: true, value: { pairId, optedIn: draft.optedIn, quietStartMinute: start, quietEndMinute: end, utcOffsetMinutes } };
}

/** True when the stored consent is current (not revoked, not expired). */
export function isConsentActive(pref: SupportPreferencesView | undefined, nowMs: number): boolean {
  return !!pref && pref.revokedAt === null && Date.parse(pref.expiresAt) > nowMs;
}

/** Version the next set_support_preferences call must send (0 creates). */
export function expectedConsentVersion(pref: SupportPreferencesView | undefined): number {
  return pref?.consentVersion ?? 0;
}

export function toggle<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}
