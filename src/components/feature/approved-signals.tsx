'use client';

import { useState } from 'react';
import type { ReducerResult, SignalView, UnreadableRow } from '@/lib/backend/ports';
import { useLiveShared } from '@/components/shell/use-live';
import { ResultNotice } from '@/components/shell/result-notice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AVAILABILITY_LABELS, SUPPORT_MODE_LABELS } from './recipient-settings-model';
import { signalStatus } from './share-review-model';

const STATUS_LABEL = { active: 'Active', revoked: 'Revoked', expired: 'Expired' } as const;

function SignalRow({ signal, name }: { signal: SignalView; name: string }) {
  const shared = useLiveShared();
  const [result, setResult] = useState<ReducerResult | null>(null);
  const status = signalStatus(signal, Date.now());
  const fields = [
    signal.supportMode && SUPPORT_MODE_LABELS[signal.supportMode],
    signal.availability && `Timing: ${AVAILABILITY_LABELS[signal.availability]}`,
  ].filter(Boolean).join(' · ');

  return (
    <li className="space-y-2 py-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span>For <span className="font-medium">{name}</span>: {fields}</span>
        <Badge variant={status === 'active' ? 'default' : 'secondary'}>{STATUS_LABEL[status]}</Badge>
      </div>
      <p className="text-muted-foreground">
        {status === 'revoked' && signal.revokedAt
          ? <>Revoked <time dateTime={signal.revokedAt}>{new Date(signal.revokedAt).toLocaleString()}</time></>
          : <>Expires <time dateTime={signal.expiresAt}>{new Date(signal.expiresAt).toLocaleString()}</time></>}
      </p>
      {status === 'active' && (
        <Button size="sm" variant="outline" onClick={() => void shared.revokeSignal(signal.signalId).then(setResult)}>Revoke</Button>
      )}
      <ResultNotice result={result} />
    </li>
  );
}

/** A my_signals row that failed validation: still listed, still revocable, never silently hidden. */
function UnreadableSignalRow({ row }: { row: UnreadableRow }) {
  const shared = useLiveShared();
  const [result, setResult] = useState<ReducerResult | null>(null);
  return (
    <li className="space-y-2 py-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">Unreadable approval</span>
        <Badge variant="destructive">Check</Badge>
      </div>
      <p className="text-muted-foreground">This approval could not be read on this device. Revoke it to be sure nothing is used.</p>
      {row.id && <Button size="sm" variant="outline" onClick={() => void shared.revokeSignal(row.id!).then(setResult)}>Revoke</Button>}
      <ResultNotice result={result} />
    </li>
  );
}

/** Sender-only list of what the caller approved (my_signals, D026), with per-item revoke. */
export function ApprovedSignals() {
  const shared = useLiveShared();
  const signals = shared.mySignals();
  const unreadable = shared.unreadable().signals;
  const names = new Map(shared.myPairs().map((p) => [p.pairId, p.counterpartDisplayName ?? 'Your connection']));
  return (
    <Card>
      <CardHeader>
        <CardTitle>What you have shared</CardTitle>
        <CardDescription>Each approval, who it is for and when it ends. Revoking stops any nudge that has not been sent.</CardDescription>
      </CardHeader>
      <CardContent>
        {signals.length === 0 && unreadable.length === 0 && <p className="text-sm text-muted-foreground">You have not approved anything yet.</p>}
        <ul className="divide-y">
          {unreadable.map((u, i) => <UnreadableSignalRow key={u.id ?? `u-${i}`} row={u} />)}
          {[...signals].sort((a, b) => b.expiresAt.localeCompare(a.expiresAt)).map((s) => (
            <SignalRow key={s.signalId} signal={s} name={names.get(s.pairId) ?? 'A former connection'} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
