'use client';

/** Incoming friend-of-friend nudges (accept links you; decline reveals nothing) and the caller's own outgoing ones. */
import { useState } from 'react';
import { useLiveShared } from '@/components/shell/use-live';
import { ResultNotice } from '@/components/shell/result-notice';
import { Button } from '@/components/ui/button';
import type { ReducerResult } from '@/lib/backend/ports';
import { knownThrough, type NudgeRequestView } from '@/lib/network/types';

function Incoming({ r, onRespond }: { r: NudgeRequestView; onRespond: (accept: boolean) => void }) {
  return (
    <li className="paper-tile space-y-2 p-4">
      <p className="font-hand text-[24px] leading-tight">{r.counterpartName ?? 'Someone'} says hi</p>
      <p className="text-sm text-muted-foreground">They know {r.viaName}.{r.sharedTags.length > 0 && <> You both like {r.sharedTags.join(', ').replace(/-/g, ' ')}.</>}</p>
      {r.message && <blockquote className="border-l-2 pl-3 text-sm">{r.message}</blockquote>}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => onRespond(true)}>Say hi back</Button>
        <Button size="sm" variant="ghost" onClick={() => onRespond(false)}>Not now</Button>
      </div>
    </li>
  );
}

const OUT_LABEL: Record<NudgeRequestView['status'], string> = {
  pending: 'Waiting for them', accepted: 'Linked. Find them on your shelf', declined: 'Request closed', cancelled: 'Request closed', closed: 'Request closed',
};

export function NudgeRequests() {
  const shared = useLiveShared();
  const [result, setResult] = useState<ReducerResult | null>(null);
  const all = shared.myNudgeRequests();
  const incoming = all.filter((r) => r.direction === 'incoming' && r.status === 'pending');
  const outgoing = all.filter((r) => r.direction === 'outgoing' && r.status !== 'cancelled');
  if (incoming.length === 0 && outgoing.length === 0) return null;

  return (
    <section className="space-y-3" aria-labelledby="nudge-requests">
      <h3 id="nudge-requests" className="font-hand text-[28px] leading-none">People saying hi</h3>
      <ResultNotice result={result} />
      <ul className="space-y-3">
        {incoming.map((r) => (
          <Incoming key={r.requestId} r={r}
            onRespond={(accept) => void shared.respondNudgeRequest(r.requestId, accept).then(setResult)} />
        ))}
      </ul>
      {outgoing.length > 0 && (
        <ul className="space-y-2 text-sm">
          {outgoing.map((r) => (
            <li key={r.requestId} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
              <span>{r.counterpartName ?? knownThrough(r)}: {OUT_LABEL[r.status]}</span>
              {r.status === 'pending' && (
                <Button size="sm" variant="ghost" onClick={() => void shared.cancelNudgeRequest(r.requestId).then(setResult)}>Cancel</Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
