'use client';

import { useState } from 'react';
import type { ReducerResult } from '@/lib/backend/ports';
import { useLiveShared } from '@/components/shell/use-live';
import { ResultNotice } from '@/components/shell/result-notice';
import { Button } from '@/components/ui/button';
import {
  PAUSE_CHOICES, PAUSE_PROMISE, isPauseInForce, pauseEndsAt, pauseFor, pauseVersion, pausedUntilLabel,
} from './pause-model';

/**
 * Owner-only "pause for now" for one accepted connection (D041). No reason is asked for or kept. The only
 * promise made is that they are not notified; nothing here suggests anyone else.
 */
export function PauseControls({ pairId, name }: { pairId: string; name: string }) {
  const shared = useLiveShared();
  const [choice, setChoice] = useState(PAUSE_CHOICES[0].id);
  const [result, setResult] = useState<ReducerResult | null>(null);
  const pauses = shared.myRecipientPauses();
  const pause = pauseFor(pauses, pairId);
  const inForce = isPauseInForce(pause, new Date());
  const version = pauseVersion(pauses, pairId);

  return (
    <div className="space-y-2">
      {inForce && pause ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm">{pausedUntilLabel(pause)}</p>
          <Button size="sm" variant="outline" onClick={() => shared.resumeRecipient(pairId, version).then(setResult)}>Resume</Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm" htmlFor={`pause-${pairId}`}>Pause {name} for</label>
          <select id={`pause-${pairId}`} className="h-8 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            value={choice} onChange={(e) => setChoice(e.target.value)}>
            {PAUSE_CHOICES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <Button size="sm" variant="outline" onClick={() => {
            const c = PAUSE_CHOICES.find((x) => x.id === choice) ?? PAUSE_CHOICES[0];
            void shared.pauseRecipient(pairId, pauseEndsAt(c, new Date()), version).then(setResult);
          }}>Pause for now</Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{PAUSE_PROMISE}</p>
      <ResultNotice result={result} />
    </div>
  );
}
