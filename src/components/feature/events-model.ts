/**
 * Pure helpers for the Events page (CS-R3, C7/C8, D039). Eligibility is DS's `eligibleEvents` over the exact
 * CatalogueEventRef keys; the module re-checks everything at write time.
 */
import { safeCatalogueUrl } from '@dor/contracts';
import { eligibleEvents } from '../../evaluation/events.ts';
import type {
  CatalogueEventView, DiscoveryCardRow, EventCompanionRow, EventIntentRow, MyDiscoveryView, PlanView,
} from '../../lib/backend/ports.ts';
import { DISCOVERY_TAGS } from '../../lib/discovery/config.ts';
import { SOURCE_HOSTS } from '../../lib/catalogue/feeds.ts';
import { looksLikeInstruction } from '../../lib/catalogue/ingest-text.ts';

export interface EventCard {
  event: CatalogueEventView;
  /** https link on the allowlisted host, or null (never shown raw). */
  link: string | null;
  intent: EventIntentRow | null;
  companions: DiscoveryCardRow[];
}

const toListing = (e: CatalogueEventView) => ({
  eventId: e.eventId, startsAt: e.startsAt, ...(e.endsAt ? { endsAt: e.endsAt } : {}), status: 'scheduled' as const,
  fetchedAt: e.fetchedAt, topics: e.topics, format: e.format, areaKey: e.areaKey,
});

/**
 * Events for the viewer's current area (DS eligibility: area, lead time, horizon, freshness, dedupe), soonest first.
 * Instruction-like titles are dropped defensively even though ingestion already refuses them.
 */
export function eventCards(input: {
  me: MyDiscoveryView | null; events: readonly CatalogueEventView[]; intents: readonly EventIntentRow[];
  companions: readonly EventCompanionRow[]; cards: readonly DiscoveryCardRow[]; now: Date;
}): EventCard[] {
  const areaKey = input.me?.areaActive ? input.me.areaKey : null;
  const safe = input.events.filter((e) => !looksLikeInstruction(e.title));
  const { eligible } = eligibleEvents(safe.map(toListing), areaKey, [...DISCOVERY_TAGS], input.now);
  const byId = new Map(safe.map((e) => [e.eventId, e]));
  const cardByRef = new Map(input.cards.map((c) => [c.cardRef, c]));
  return eligible.map((l) => l.eventId).flatMap((id) => {
    const event = byId.get(id);
    if (!event) return [];
    const companions = input.companions.filter((c) => c.eventId === id).flatMap((c) => cardByRef.get(c.cardRef) ?? []);
    return [{
      event, link: event.sourceUrl ? safeCatalogueUrl(event.sourceUrl, SOURCE_HOSTS) : null,
      intent: input.intents.find((i) => i.eventId === id) ?? null, companions: companions.slice(0, 3),
    }];
  });
}

/** Version to send to publish_event_intent: the current one (withdrawn rows included), 0 when never marked. */
export function nextIntentVersion(intent: EventIntentRow | null): number {
  return intent?.version ?? 0;
}

export function isIntentActive(intent: EventIntentRow | null, nowMs: number): boolean {
  return Boolean(intent?.active && Date.parse(intent.expiresAt) > nowMs);
}

/** Plans worth acting on first: pending ones awaiting me, then confirmed, then the rest; soonest event first. */
export function orderPlans(plans: readonly PlanView[]): PlanView[] {
  const rank = (p: PlanView) => (p.status === 'pending' && !p.myAcceptance ? 0 : p.status === 'pending' ? 1 : p.status === 'confirmed' ? 2 : 3);
  return [...plans].sort((a, b) => rank(a) - rank(b) || a.eventStartsAt.localeCompare(b.eventStartsAt));
}

export function canAccept(p: PlanView): boolean {
  return p.status === 'pending' && !p.myAcceptance;
}

export function canCancel(p: PlanView): boolean {
  return p.status === 'pending' || p.status === 'confirmed' || p.status === 'stale';
}

export function formatWhen(iso: string, locale?: string): string {
  return new Date(iso).toLocaleString(locale, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
