'use client';

import { RoomLink as Link } from '../room-link';
import { useState } from 'react';
import { NUDGE_TEMPLATE_COPY } from '@dor/contracts';
import type { ReducerResult } from '@/lib/backend/ports';
import { useLiveShared } from '@/components/shell/use-live';
import { ResultNotice } from '@/components/shell/result-notice';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { NudgeRequests } from '@/components/network/nudge-requests';

// Recipient copy comes from the contract so it is identical to what the owner previewed (FLOWS F3/F7).
const COPY = NUDGE_TEMPLATE_COPY;
const SNOOZE_MS = 24 * 60 * 60 * 1000;
const ENTER = 'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-200';

export function TrayPlace() {
  const shared = useLiveShared();
  const [result, setResult] = useState<ReducerResult | null>(null);
  const nudges = shared.myNudges();

  const snooze = (id: string) =>
    shared.snoozeNudge(id, new Date(Date.now() + SNOOZE_MS).toISOString()).then(setResult);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-2">
        <h2 className="place-title">Nudges</h2>
        <p className="max-w-[65ch] text-sm text-muted-foreground">
          Gentle suggestions, only when someone has chosen to share a signal with you. There is no pressure to act on any of them.
        </p>
      </header>
      <ResultNotice result={result} />
      <NudgeRequests />
      {nudges.length === 0 && (
        <div className={`rounded-lg border border-dashed p-8 text-center ${ENTER}`}>
          <p className="font-medium">Nothing waiting for you</p>
          <p className="mx-auto mt-1 max-w-[48ch] text-sm text-muted-foreground">
            No nudges right now. Nudges only reach you from connections you have turned them on for, and only for kinds
            of support you accept. Set both per connection in <Link className="underline" href="/connections">Connections</Link>.
          </p>
        </div>
      )}
      <ul className="space-y-3">
        {nudges.map((n) => (
          <li key={n.id} className={ENTER}>
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-medium leading-snug text-balance">{COPY[n.templateId]}</CardTitle>
                {n.hook && <p className="text-sm text-muted-foreground">{n.hook}</p>}
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="active:scale-[0.97] motion-safe:transition-transform"
                  onClick={() => shared.dismissNudge(n.id).then(setResult)}>Dismiss</Button>
                <Button size="sm" variant="ghost" className="active:scale-[0.97] motion-safe:transition-transform"
                  onClick={() => snooze(n.id)}>Snooze 1 day</Button>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
