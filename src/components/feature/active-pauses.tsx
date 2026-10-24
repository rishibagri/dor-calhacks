'use client';

import { useState } from 'react';
import type { ReducerResult } from '@/lib/backend/ports';
import { useLiveShared } from '@/components/shell/use-live';
import { ResultNotice } from '@/components/shell/result-notice';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PAUSE_PROMISE, isPauseInForce, pausedUntilLabel } from './pause-model';

/** Owner-only list of the caller's active pauses, each with Resume. Hidden when there are none. */
export function ActivePauses() {
  const shared = useLiveShared();
  const [result, setResult] = useState<ReducerResult | null>(null);
  const now = new Date();
  const active = shared.myRecipientPauses().filter((p) => isPauseInForce(p, now));
  if (active.length === 0) return null;
  const names = new Map(shared.myPairs().map((p) => [p.pairId, p.counterpartDisplayName ?? 'A former connection'] as const));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Paused connections</CardTitle>
        <CardDescription>Only you can see this. {PAUSE_PROMISE}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <ul className="divide-y">
          {active.map((p) => (
            <li key={p.pairId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span><span className="font-medium">{names.get(p.pairId) ?? 'A former connection'}</span> <span className="text-muted-foreground">{pausedUntilLabel(p)}</span></span>
              <Button size="sm" variant="outline" onClick={() => shared.resumeRecipient(p.pairId, p.version).then(setResult)}>Resume</Button>
            </li>
          ))}
        </ul>
        <ResultNotice result={result} />
      </CardContent>
    </Card>
  );
}
