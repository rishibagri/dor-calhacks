/**
 * What the room shows at a glance, derived only from the caller's own views (spec, "Signals"). Counts drive how many
 * objects appear: postcards on the sill, envelopes on the mat, planes in the tray. Pure and unit-tested.
 *
 * Privacy: nothing here reveals another person's state. Outgoing declines already read as pending (D038), and an
 * outgoing introduction never shows as an envelope.
 */
import type {
  CatalogueEventView, DiscoveryCardRow, IntroductionView, MyDiscoveryView, PairView, PlanView, RecipientNudgeView,
} from '../../lib/backend/ports.ts';

export const MAX_OBJECTS = 5;

export interface RoomSignalInput {
  me: MyDiscoveryView | null;
  cards: readonly DiscoveryCardRow[];
  events: readonly CatalogueEventView[];
  introductions: readonly IntroductionView[];
  pairs: readonly PairView[];
  plans: readonly PlanView[];
  nudges: readonly RecipientNudgeView[];
  nowMs: number;
}

export interface RoomSignals {
  flyers: number;
  postcards: number;
  envelopes: number;
  planes: number;
  /** Accepted existing ties: painted books on the shelf. */
  books: number;
  /** Invited but not accepted yet: pencil books with a "waiting for them" tag. */
  pendingBooks: number;
  /** New people met through an accepted introduction: loose pages on the "New here" side. */
  loosePages: number;
  /** Plans on the calendar: confirmed are painted dots, pending are pencil outlines. */
  confirmedPlans: number;
  pendingPlans: number;
  pinboardPublished: boolean;
  /** One lit city window per real connection; never decreases within a session by design of the inputs. */
  cityLights: number;
}

const cap = (n: number) => Math.min(Math.max(n, 0), MAX_OBJECTS);

export function roomSignals(i: RoomSignalInput): RoomSignals {
  const upcoming = i.events.filter((e) => Date.parse(e.endsAt ?? e.startsAt) > i.nowMs);
  const incoming = i.introductions.filter((x) => x.direction === 'incoming' && x.status === 'pending');
  const met = i.introductions.filter((x) => x.status === 'accepted');
  const accepted = i.pairs.filter((p) => p.status === 'accepted');
  const pending = i.pairs.filter((p) => p.status === 'pending');
  const visibleNudges = i.nudges.filter((n) => Date.parse(n.visibleUntil) > i.nowMs);
  const confirmed = i.plans.filter((p) => p.status === 'confirmed');
  const waiting = i.plans.filter((p) => p.status === 'pending');
  const published = Boolean(i.me?.published && !i.me.withdrawn && !i.me.expired);
  return {
    flyers: cap(upcoming.length),
    postcards: cap(published ? i.cards.length : 0),
    envelopes: cap(incoming.length),
    planes: cap(visibleNudges.length),
    books: Math.min(accepted.length, 9),
    pendingBooks: Math.min(pending.length, 3),
    loosePages: cap(met.length),
    confirmedPlans: cap(confirmed.length),
    pendingPlans: cap(waiting.length),
    pinboardPublished: published,
    cityLights: Math.min(accepted.length + met.length, 12),
  };
}

/** Badge counts per place: something new is waiting there. */
export function placeBadges(s: RoomSignals): Partial<Record<'window' | 'sill' | 'mat' | 'tray' | 'calendar', number>> {
  return { window: s.flyers, sill: s.postcards, mat: s.envelopes, tray: s.planes, calendar: s.pendingPlans };
}
