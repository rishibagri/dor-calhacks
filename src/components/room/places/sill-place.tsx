'use client';

import { RoomLink as Link, navigateRoom } from '../room-link';
import { useState } from 'react';
import { useLiveShared } from '@/components/shell/use-live';
import { IntegrationStatus } from '@/components/shell/integration-status';
import { IntroductionSuggestions } from '@/components/feature/introduction-suggestions';
import { introductionActions, orThrow, toControlRows } from '@/components/feature/introduction-actions';
import { discoverStage, newIntroductionRequestId, nextPageCursor, shortlistFor } from '@/components/feature/discover-model';
import { Button } from '@/components/ui/button';
import { isDiscoverySynthetic } from '@/lib/config';
import { DiscoveryResults } from '@/features/discovery/discovery-results';
import { IntroductionControls } from '@/features/privacy/introduction-controls';
import { runAction } from '@/features/privacy/introduction-model';
import { DiscoveryGate } from '@/components/feature/discovery-gate';
import { FriendsNearby } from '@/components/network/friends-nearby';

export function SillPlace() {
  const shared = useLiveShared();
  const me = shared.myDiscoveryProfile();
  const now = new Date();
  const stage = discoverStage(me, now.getTime());
  const [invited, setInvited] = useState<ReadonlySet<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const rows = shared.discoveryCards();
  const { shortlist, candidates } = shortlistFor(me, rows, now);
  const nextCursor = nextPageCursor(rows);
  const [isPaged, setIsPaged] = useState(false);

  const handlePage = async (afterRef: string) => {
    const err = await runAction(() => orThrow(shared.setDiscoveryPage(afterRef)));
    if (err) return setMessage(err);
    setIsPaged(afterRef !== '');
    setInvited(new Set());
  };
  const isDiscoverable = Boolean(me?.published && !me.withdrawn && !me.expired);

  const handleInvite = async (ref: string) => {
    // Fresh ID per tap (D038); the reducer treats a same-ID retry of the same card as already done.
    const err = await runAction(() => orThrow(shared.sendIntroductionRequest(ref, newIntroductionRequestId())));
    setMessage(err ?? 'Request sent. They will see your name and shared interests, nothing else.');
    if (!err) setInvited(new Set(invited).add(ref));
  };

  const handleBlock = async (ref: string) => {
    const err = await runAction(() => orThrow(shared.blockDiscoveryUser(ref)));
    setMessage(err ?? 'Blocked. You will not see each other here again.');
  };

  const handleEmptyAction = () => navigateRoom('pinboard');

  const safetyControls = (
    <IntroductionControls introductions={toControlRows(shared.myIntroductions())} discoverable={isDiscoverable} actions={introductionActions(shared)} />
  );

  return (
    <DiscoveryGate title="Discover" controls={safetyControls}>
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-2">
        <h2 className="place-title">Discover</h2>
        <p className="max-w-[65ch] text-sm text-muted-foreground">
          Meet people nearby who also chose to be found. Everything here is opt-in, ends on its own, and nobody can contact
          you unless you accept their request.
        </p>
      </header>
      <IntegrationStatus />
      <FriendsNearby />
      {stage === 'disabled' ? (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          Discovery isn't switched on for this area yet. Nothing is shown and nothing can be published.
        </p>
      ) : (
        <>
          {stage === 'needs_profile' && (
            <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              Postcards appear here once your <Link className="underline" href="/?at=pinboard">pinboard</Link> is visible nearby.
            </p>
          )}
          {stage === 'needs_area' && (
            <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              Choose where you&apos;ve landed in the <Link className="underline" href="/onboarding">moving boxes</Link> to see people nearby.
            </p>
          )}
          {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
          {stage === 'ready' && <>
            <IntroductionSuggestions />
            <DiscoveryResults shortlist={shortlist} candidates={candidates} invitedRefs={invited} synthetic={isDiscoverySynthetic}
              onInvite={(ref) => void handleInvite(ref)} onBlock={(ref) => void handleBlock(ref)} onEmptyAction={handleEmptyAction} />
            <p className="text-sm text-muted-foreground">
              Quiet area? <Link className="underline" href="/events">Browse local events</Link> and see who else marked them.
            </p>
            {(nextCursor || isPaged) && (
              <div className="flex gap-2">
                {nextCursor && <Button size="sm" variant="outline" onClick={() => void handlePage(nextCursor)}>Show other people</Button>}
                {isPaged && <Button size="sm" variant="ghost" onClick={() => void handlePage('')}>Back to the start</Button>}
              </div>
            )}
          </>}
        </>
      )}
      <aside className="rounded-lg border p-4 text-sm text-muted-foreground">
        <Link className="font-medium text-foreground underline" href="/connections">Keep in touch with people you already know</Link>
        {' '}— optional, separate from meeting new people.
      </aside>
      {/* Always rendered: withdraw, block and report keep working even when discovery is switched off (D038). */}
      {safetyControls}
    </div>
    </DiscoveryGate>
  );
}
