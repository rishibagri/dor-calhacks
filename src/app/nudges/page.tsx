'use client';

import { useState } from 'react';
import type { Nudge } from '@kinetic/contracts';
import type { ReducerResult } from '@/lib/backend/ports';
import { useLiveShared } from '@/components/shell/use-live';
import { ResultNotice } from '@/components/shell/result-notice';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const COPY: Record<Nudge['templateId'], string> = {
  offer_short_call: 'Someone you are connected with would welcome a short call. Want to offer one?',
  offer_note: 'Someone you are connected with would welcome a kind note. Want to send one?',
  offer_shared_activity: 'Someone you are connected with would welcome a shared activity. Want to suggest one?',
};
const SNOOZE_MS = 24 * 60 * 60 * 1000;
const ENTER = 'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-200';

export default function NudgesPage() {
  const shared = useLiveShared();
  const [result, setResult] = useState<ReducerResult | null>(null);
  const nudges = shared.myNudges();

  const snooze = (id: string) =>
    shared.snoozeNudge(id, new Date(Date.now() + SNOOZE_MS).toISOString()).then(setResult);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Nudges</h1>
        <p className="max-w-[65ch] text-sm text-muted-foreground">
          Gentle suggestions, only when someone has chosen to share a signal with you. There is no pressure to act on any of them.
        </p>
      </header>
      <ResultNotice result={result} />
      {nudges.length === 0 && (
        <div className={`rounded-lg border border-dashed p-8 text-center ${ENTER}`}>
          <p className="font-medium">Nothing waiting for you</p>
          <p className="mx-auto mt-1 max-w-[48ch] text-sm text-muted-foreground">
            No nudges right now. When someone approves a signal for you, a gentle suggestion appears here.
          </p>
        </div>
      )}
      <ul className="space-y-3">
        {nudges.map((n) => (
          <li key={n.id} className={ENTER}>
            <Card>
              <CardHeader><CardTitle className="text-base font-medium leading-snug text-balance">{COPY[n.templateId]}</CardTitle></CardHeader>
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
