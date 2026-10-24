'use client';

import Link from 'next/link';
import { useLiveShared } from '@/components/shell/use-live';
import { IntegrationStatus } from '@/components/shell/integration-status';
import { EventCard } from '@/components/feature/event-card';
import { PlansList } from '@/components/feature/plans-list';
import { discoverStage } from '@/components/feature/discover-model';
import { eventCards } from '@/components/feature/events-model';
import { isDiscoverySynthetic } from '@/lib/config';
import { ExtensionGate } from '@/components/feature/extension-gate';
import { areaLabel } from '@/lib/discovery/config';

export default function EventsPage() {
  const shared = useLiveShared();
  const me = shared.myDiscoveryProfile();
  const now = new Date();
  const stage = discoverStage(me, now.getTime());
  const cards = eventCards({
    me, events: shared.catalogueEvents(), intents: shared.myEventIntents(), companions: shared.eventCompanions(),
    cards: shared.discoveryCards(), now,
  });
  const area = areaLabel(me?.areaKey ?? null);

  return (
    <ExtensionGate title="Events" controls={<PlansList />}>
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Events</h1>
        <p className="max-w-[65ch] text-sm text-muted-foreground">
          Public local events from a listed source. Mark the ones you would go to and see who else nearby marked them.
          Dor never RSVPs, buys tickets or contacts organizers.
        </p>
      </header>
      <IntegrationStatus />
      {stage === 'disabled' && <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">Events are not switched on yet.</p>}
      {(stage === 'needs_profile' || stage === 'needs_area') && (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          Set up your discoverable profile and area on <Link className="underline" href="/discover">Discover</Link> to see events near you.
        </p>
      )}
      {stage === 'ready' && (
        <section aria-label="Upcoming events" className="space-y-3">
          <h2 className="text-lg font-semibold">Coming up{area ? ` in ${area}` : ''}</h2>
          {isDiscoverySynthetic && <p className="text-xs text-muted-foreground">Test data: events and people here may be synthetic.</p>}
          {cards.length === 0 && (
            <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              No upcoming events from the listed source in your area right now. Listings refresh a few times a day.
            </p>
          )}
          <ul className="space-y-3">{cards.map((c) => <EventCard key={c.event.eventId} card={c} synthetic={isDiscoverySynthetic} />)}</ul>
        </section>
      )}
      <PlansList />
    </div>
    </ExtensionGate>
  );
}
