/**
 * Exact consent copy and withdrawal model for events (Cyber, CYBER-R3, D039). UI-free so it runs under
 * node --test; `event-privacy-controls.tsx` renders the withdraw/revoke list. CS uses the preview strings
 * verbatim on the confirm step before calling `publish_event_intent` or `approve_activity_interest`, and the
 * plan copy next to accept. Copy states what is shared, with whom, for how long, and what dor never does.
 */
import { CATALOGUE_MAX_SOURCE_AGE_MS } from '@dor/contracts';

const list = (items: readonly string[]) => items.length <= 1 ? (items[0] ?? '') :
  `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
const label = (slug: string) => slug.replaceAll('-', ' ');

/** Shown before publish_event_intent. The kind is never shown to others, so the copy doesn't promise it is. */
export function intentPreviewCopy(eventTitle: string): string {
  return `People nearby who also marked "${eventTitle}", and who can already see your public profile, will see that you marked it too. ` +
    'They won\'t see whether you chose interested or going. This ends when the event ends, and you can withdraw it any time. ' +
    'Marking an event doesn\'t RSVP, buy a ticket or tell the organizer anything.';
}

/** Shown before approve_activity_interest (C7, existing connection). Mirrors ACTIVITY_CONSENT.md §2 wording. */
export function activityApprovalPreviewCopy(counterpartName: string, topics: readonly string[]): string {
  return `${counterpartName} may learn that you're interested in ${list(topics.map(label))}. A shared plan suggestion can reveal this. ` +
    'This lasts up to 24 hours, ends sooner if you change your sharing settings for them, and you can revoke it any time.';
}

/** Shown next to Accept on a plan. */
export function planAcceptCopy(counterpartName: string): string {
  return `Accepting tells ${counterpartName} you'd like to go together, but only once you have both accepted this version of the plan. ` +
    'dor doesn\'t book, RSVP, buy tickets or send messages for you.';
}

/** Truthful source freshness for a catalogue record. Never implies a live feed. */
export function sourceAgeLabel(fetchedAtMs: number, nowMs: number): string {
  const age = Math.max(0, nowMs - fetchedAtMs);
  if (age > CATALOGUE_MAX_SOURCE_AGE_MS) return 'Event details may be out of date';
  const hours = Math.floor(age / 3_600_000);
  return hours < 1 ? 'Event details updated less than an hour ago' : `Event details updated ${hours} h ago`;
}

export const PLAN_STATUS_COPY: Record<string, string> = {
  pending: 'Waiting for both of you to accept',
  confirmed: 'You both accepted',
  stale: 'Something changed (the event, an intent or sharing settings), so this plan can\'t be accepted',
  expired: 'This plan has expired',
  declined: 'You declined this plan',
  cancelled: 'You cancelled this plan',
  closed: 'This plan is closed',
};

export const EVENT_ACTION_MESSAGES = {
  stale_source: 'Something changed, so this plan can no longer be accepted.',
  stale_revision: 'This plan was updated. Please review the new version.',
  closed: 'This plan is closed.',
  expired: 'This has expired.',
  already_accepted: 'You already accepted.',
  event_cancelled: 'This event was cancelled.',
  event_started: 'This event has already started.',
  source_stale: 'This event\'s details are out of date.',
  no_preset_category: 'Turn on activity sharing for this person in your sharing settings first.',
  rate_limited: 'You have reached today\'s limit for this action. Try again tomorrow.',
  unavailable: 'Events are switched off right now.',
  not_found: 'This is no longer available.',
  generic: 'That didn\'t work. Please try again.',
} as const;

/** Fixed copy for a refusal; server text is never shown. */
export function messageForEventError(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const m = /^([a-z_]+): ([a-z_]+)$/.exec(raw);
  if (!m) return EVENT_ACTION_MESSAGES.generic;
  const [, code, reason] = m;
  if (reason && reason in EVENT_ACTION_MESSAGES) return EVENT_ACTION_MESSAGES[reason as keyof typeof EVENT_ACTION_MESSAGES];
  if (code === 'rate_limited' || code === 'unavailable' || code === 'not_found') return EVENT_ACTION_MESSAGES[code];
  return EVENT_ACTION_MESSAGES.generic;
}

/** `my_event_intents` row (camelCase). */
export interface EventIntentView { eventId: string; kind: string; version: number; active: boolean; expiresAt: Date }
/** `my_activity_approvals` row (camelCase). */
export interface ActivityApprovalView { approvalId: string; pairId: string; topics: readonly string[]; expiresAt: Date }
export interface EventPrivacyActionsPort {
  revokeIntent(eventId: string): Promise<void>;
  revokeApproval(approvalId: string): Promise<void>;
}

export async function runEventAction(fn: () => Promise<void>): Promise<string | null> {
  try { await fn(); return null; } catch (e) { return messageForEventError(e); }
}
