'use client';

import { useState } from 'react';
import { useLiveShared } from '@/components/shell/use-live';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { tagLabel } from '@/features/discovery/view-model';
import { runAction } from '@/features/privacy/introduction-model';
import { intentPreviewCopy, runEventAction, sourceAgeLabel } from '@/features/privacy/event-consent-model';
import { orThrow } from './introduction-actions';
import { newIntroductionRequestId } from './discover-model';
import { formatWhen, isIntentActive, nextIntentVersion, type EventCard as EventCardData } from './events-model';

type Kind = 'interested' | 'going';
const KIND_LABEL: Record<Kind, string> = { interested: 'Interested', going: 'Planning to go' };

/**
 * One source-backed public event. Marking it is an explicit, previewed C8 intent (Cyber's exact copy); it never
 * RSVPs or contacts the organizer. People shown here are mutual overlap only: they marked it too and you can
 * already see their public card.
 */
export function EventCard({ card, synthetic }: { card: EventCardData; synthetic: boolean }) {
  const shared = useLiveShared();
  const { event, intent, link, companions } = card;
  const [pending, setPending] = useState<Kind | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [invited, setInvited] = useState<ReadonlySet<string>>(new Set());
  const active = isIntentActive(intent, Date.now());

  const handleConfirm = async () => {
    if (!pending) return;
    const err = await runEventAction(() => orThrow(shared.publishEventIntent(event.eventId, pending, nextIntentVersion(intent))));
    setMessage(err ?? 'Marked. Only people who also marked it, and can already see your profile, will know.');
    setPending(null);
  };
  const handleWithdraw = async () =>
    setMessage(await runEventAction(() => orThrow(shared.revokeEventIntent(event.eventId))) ?? 'Withdrawn.');
  const handleInvite = async (ref: string) => {
    const err = await runAction(() => orThrow(shared.sendIntroductionRequest(ref, newIntroductionRequestId())));
    setMessage(err ?? 'Request sent.');
    if (!err) setInvited(new Set(invited).add(ref));
  };

  return (
    <li><Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-base leading-snug">{event.title}</CardTitle>
        <p className="text-sm text-muted-foreground">
          <time dateTime={event.startsAt}>{formatWhen(event.startsAt)}</time> · {event.topics.map(tagLabel).join(', ')}
        </p>
        <p className="text-xs text-muted-foreground">
          {synthetic ? 'Test event, not a real listing' : sourceAgeLabel(Date.parse(event.fetchedAt), Date.now())}
          {link && <> · <a className="underline" href={link} target="_blank" rel="noopener noreferrer nofollow">Event page</a></>}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {active && intent && <Badge variant="secondary">You marked: {KIND_LABEL[intent.kind]}</Badge>}
        {!pending && (
          <div className="flex flex-wrap gap-2">
            {(['interested', 'going'] as const).filter((k) => !(active && intent?.kind === k)).map((k) => (
              <Button key={k} size="sm" variant={k === 'going' ? 'default' : 'outline'} onClick={() => setPending(k)}>{KIND_LABEL[k]}</Button>
            ))}
            {active && <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => void handleWithdraw()}>Withdraw</Button>}
          </div>
        )}
        {pending && (
          <Alert>
            <AlertTitle>Before you mark this</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>{intentPreviewCopy(event.title)}</p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void handleConfirm()}>Mark as {KIND_LABEL[pending].toLowerCase()}</Button>
                <Button size="sm" variant="ghost" onClick={() => setPending(null)}>Cancel</Button>
              </div>
            </AlertDescription>
          </Alert>
        )}
        {active && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Others who marked it</p>
            {companions.length === 0 && <p className="text-sm text-muted-foreground">Nobody you can see has marked this yet.</p>}
            <ul className="space-y-2">
              {companions.map((c) => (
                <li key={c.cardRef} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
                  <span><span className="font-medium">{c.displayName}</span>{c.sharedTags.length > 0 && ` · also likes ${c.sharedTags.map(tagLabel).join(', ')}`}</span>
                  <Button size="sm" variant="outline" disabled={invited.has(c.cardRef)} onClick={() => void handleInvite(c.cardRef)}>
                    {invited.has(c.cardRef) ? 'Requested' : 'Introduce yourself'}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
      </CardContent>
    </Card></li>
  );
}
