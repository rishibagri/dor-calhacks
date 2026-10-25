'use client';

import { RoomLink as Link } from '../room-link';
import { useLiveShared } from '@/components/shell/use-live';
import { IntegrationStatus } from '@/components/shell/integration-status';
import { EventCard } from '@/components/feature/event-card';
import { PlansList } from '@/components/feature/plans-list';
import { discoverStage } from '@/components/feature/discover-model';
import { CATALOGUE_MAX_SOURCE_AGE_MS } from '@dor/contracts';
import { eventCards, formatWhen, sourceState } from '@/components/feature/events-model';
import { isDiscoverySynthetic } from '@/lib/config';
import { DiscoveryGate } from '@/components/feature/discovery-gate';
import { areaLabel } from '@/lib/discovery/config';

export function WindowPlace() {
  const shared = useLiveShared();
  const me = shared.myDiscoveryProfile();
  const now = new Date();
  const stage = discoverStage(me, now.getTime());
  const cards = eventCards({
    me, events: shared.catalogueEvents(), intents: shared.myEventIntents(), companions: shared.eventCompanions(),
    cards: shared.discoveryCards(), now,
  });
  const area = areaLabel(me?.areaKey ?? null);
  const source = sourceState(shared.catalogueStatus(), me?.areaActive ? me.areaKey : null, now.getTime(), CATALOGUE_MAX_SOURCE_AGE_MS);
  const sourceNote = source.kind === 'never_loaded' ? 'No listings have been loaded for this area yet.'
    : source.kind === 'unavailable' ? `The event source is unavailable right now${source.lastSuccessAt ? `; showing listings from ${formatWhen(source.lastSuccessAt)}` : ''}.`
    : source.kind === 'stale' ? `Listings were last updated ${formatWhen(source.lastSuccessAt)} and may be out of date.`
    : null;

  return (
    <DiscoveryGate title="Events" controls={<PlansList />}>
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-2">
        <h2 className="place-title">Events</h2>
        <p className="max-w-[65ch] text-sm text-muted-foreground">
          Public local events from a listed source. Mark the ones you would go to and see who else nearby marked them.
          Dor never RSVPs, buys tickets or contacts organizers.
        </p>
      </header>
      <IntegrationStatus />
      {stage === 'disabled' && <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">Discovery isn't switched on for this area yet. No events are shown.</p>}
      {(stage === 'needs_profile' || stage === 'needs_area') && (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          Set up your discoverable profile and area on <Link className="underline" href="/discover">Discover</Link> to see events near you.
        </p>
      )}
      {stage === 'ready' && (
        <section aria-label="Upcoming events" className="space-y-3">
          <h2 className="text-lg font-semibold">Coming up{area ? ` in ${area}` : ''}</h2>
          {isDiscoverySynthetic && <p className="text-xs text-muted-foreground">Test data: events and people here may be synthetic.</p>}
          {sourceNote && <p role="status" className="text-sm text-muted-foreground">{sourceNote}</p>}
          {cards.length === 0 && source.kind === 'ok' && (
            <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              No upcoming events from the listed source in your area right now. Listings refresh a few times a day.
            </p>
          )}
          <ul className="space-y-3">{cards.map((c) => <EventCard key={c.event.eventId} card={c} synthetic={isDiscoverySynthetic} />)}</ul>
        </section>
      )}
      <PlansList />
    </div>
    </DiscoveryGate>
  );
}
