'use client';

/**
 * "Someone Sam knows is nearby" (D045). Friend-of-friend cards in the caller's area: no name until the person
 * accepts the nudge. Sending is always the caller's own tap; the message is theirs, prefilled from shared interests.
 */
import { useState } from 'react';
import { createOpenerClient } from '@dor/agents/client';
import { useLiveShared } from '@/components/shell/use-live';
import { ResultNotice } from '@/components/shell/result-notice';
import { Button } from '@/components/ui/button';
import { RoomLink as Link } from '@/components/room/room-link';
import type { ReducerResult } from '@/lib/backend/ports';
import { knownThrough, type FofCard } from '@/lib/network/types';
import { DEMO_FOF_CARDS, DEMO_PROFILE } from '@/lib/network/demo-fixture';
import { openerInputForCard } from '@/lib/network/opener-input';

const MAX_MESSAGE = 200;
const openers = createOpenerClient();

export function defaultMessage(card: Pick<FofCard, 'viaName' | 'sharedTags'>): string {
  const tag = card.sharedTags[0];
  return tag
    ? `Hi! I'm new around here. ${card.viaName} and I are friends, and it looks like we both like ${tag.replace(/-/g, ' ')}.`
    : `Hi! I'm new around here and ${card.viaName} and I are friends. Fancy saying hello?`;
}

const STATUS_LABEL: Record<FofCard['requestStatus'], string | null> = {
  none: null, pending: 'Nudge sent', incoming: 'They nudged you, check your tray', closed: 'Unavailable right now',
};

function NearbyCard({ card, onSend, synthetic = false }: {
  card: FofCard; onSend: (message: string) => Promise<void>; synthetic?: boolean;
}) {
  const [isWriting, setIsWriting] = useState(false);
  const [message, setMessage] = useState(() => defaultMessage(card));
  const [isSending, setIsSending] = useState(false);
  const [isDrafting, setIsDrafting] = useState(false);
  const [suggestion, setSuggestion] = useState('');
  const status = STATUS_LABEL[card.requestStatus];

  // Claude drafts from the card and the sender's own profile; on any failure the template stays.
  const draft = async () => {
    setIsDrafting(true);
    try {
      const d = await openers.draft(openerInputForCard(card));
      setMessage(d.message);
      setSuggestion(d.suggestion);
    } catch {
      setSuggestion('');
    } finally {
      setIsDrafting(false);
    }
  };

  const send = async () => {
    setIsSending(true);
    await onSend(message);
    setIsSending(false);
    setIsWriting(false);
  };

  return (
    <li className="paper-tile space-y-3 p-4">
      <div>
        <p className="font-hand text-[24px] leading-tight">{knownThrough(card)}</p>
        <p className="text-sm text-muted-foreground">
          {card.mutualCount > 1 && <>{card.mutualCount} of your friends know them. </>}
        </p>
      </div>
      {card.sharedTags.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="You both like">
          {card.sharedTags.map((t) => <li key={t} className="rounded-full border px-2 py-0.5 text-xs">{t.replace(/-/g, ' ')}</li>)}
        </ul>
      )}
      {synthetic ? (
        <Button size="sm" variant="outline" disabled>Demo preview · requests disabled</Button>
      ) : status ? (
        <p className="text-sm font-medium">{status}</p>
      ) : isWriting ? (
        <div className="space-y-2">
          <label className="sr-only" htmlFor={`nudge-${card.candidateRef}`}>Your message</label>
          <textarea id={`nudge-${card.candidateRef}`} value={message} maxLength={MAX_MESSAGE} rows={3}
            onChange={(e) => setMessage(e.target.value)}
            className="w-full rounded-md border bg-background p-2 text-sm" />
          {suggestion && <p className="text-xs text-muted-foreground">Idea: {suggestion}</p>}
          <p className="text-xs text-muted-foreground">Optional Claude drafting sends only your mutual friend&apos;s name and shared interest tags. Your profile and journal stay out of the request.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={isSending || !message.trim()} onClick={() => void send()}>Send nudge</Button>
            <Button size="sm" variant="outline" disabled={isDrafting} onClick={() => void draft()}>
              {isDrafting ? 'Writing…' : 'Help me write it'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setIsWriting(false)}>Not now</Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setIsWriting(true)}>Nudge them</Button>
      )}
    </li>
  );
}

export function FriendsNearby() {
  const shared = useLiveShared();
  const [result, setResult] = useState<ReducerResult | null>(null);
  const synthetic = process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_DOR_NETWORK_DEMO === '1';
  const cards = synthetic ? DEMO_FOF_CARDS : shared.fofCards();
  const profile = synthetic ? DEMO_PROFILE : shared.myProfileDetail();
  const discovery = shared.myDiscoveryProfile();
  const ready = synthetic || Boolean(discovery?.discoveryEnabled && discovery.areaActive && discovery.published && !discovery.withdrawn && !discovery.expired);

  return (
    <section className="space-y-3" aria-labelledby="friends-nearby">
      <h3 id="friends-nearby" className="font-hand text-[28px] leading-none">Friends of friends nearby</h3>
      <ResultNotice result={result} />
      {synthetic && <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">Synthetic demo network. These are fictional people; requests are disabled.</p>}
      {!ready ? (
        <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          <p>Nearby cards use only your active, opted-in public profile and broad area. Turn on nearby discovery to see friends of friends.</p>
          <Button asChild size="sm" variant="outline" className="mt-3"><Link href="/discover">Set up nearby discovery</Link></Button>
        </div>
      ) : cards.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          No eligible friends of friends are showing right now. Link with more people on the shelf to reach further.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {cards.map((c) => (
            <NearbyCard key={c.candidateRef} card={c}
              onSend={async (m) => setResult(await shared.sendNudgeRequest(c.candidateRef, m))} synthetic={synthetic} />
          ))}
        </ul>
      )}
    </section>
  );
}
