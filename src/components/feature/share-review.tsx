'use client';

import { useEffect, useRef, useState } from 'react';
import type { SignalCandidate } from '@dor/contracts';
import type { ReducerResult } from '@/lib/backend/ports';
import { useLiveShared } from '@/components/shell/use-live';
import { ResultNotice } from '@/components/shell/result-notice';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { describeNotReady, prepareShare, requestIdFor, shareRecipients, type RequestIdSlot } from './share-review-model';

type Props = {
  /** In memory only, from VoiceReflection's onCandidate. Never stored. */
  candidate: SignalCandidate;
  /** A uniquely resolved connection, or the person chosen after a private clarification. */
  recipientPairId: string;
  onClose: () => void;
  onAutomaticPendingChange?: (pending: boolean) => void;
};

/**
 * Automatic-by-default existing-connection flow. Only a resolved accepted pair with a current sharing preset can
 * receive the enum-only payload. The local delay allows the owner to exclude this person before it is submitted.
 */
export function ShareReview({ candidate, recipientPairId, onClose, onAutomaticPendingChange }: Props) {
  const shared = useLiveShared();
  const recipients = shareRecipients(shared.myPairs());
  const [result, setResult] = useState<ReducerResult | null>(null);
  const [automaticState, setAutomaticState] = useState<'queued' | 'sending' | 'failed' | null>(null);
  const requestId = useRef<RequestIdSlot | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptedAutomatic = useRef<string | null>(null);

  const selected = recipients.find((r) => r.pairId === recipientPairId);
  const name = selected?.name ?? 'your connection';
  const ownerHex = shared.connection.phase === 'connected' ? shared.connection.identityHex : null;
  const pair = selected && shared.myPairs().find((p) => p.pairId === selected.pairId);
  const prepared = pair && ownerHex ? prepareShare({
    candidate, ownerHex, pair, presets: shared.myPresets(), assignments: shared.myPresetAssignments(), now: new Date(),
  }, name) : null;

  const paused = shared.myRecipientPauses().some((p) => p.pairId === recipientPairId && p.active && Date.parse(p.expiresAt) > Date.now());
  const automaticApproval = prepared?.kind === 'ready' && !paused ? prepared.approval : null;
  const automaticKey = automaticApproval ? `${recipientPairId}:${automaticApproval.payloadRevision}` : null;

  useEffect(() => {
    if (!automaticApproval || !automaticKey) return;
    if (attemptedAutomatic.current === automaticKey) return;
    attemptedAutomatic.current = automaticKey;
    setAutomaticState('queued');
    requestId.current = requestIdFor(automaticApproval, requestId.current);
    timer.current = setTimeout(() => {
      setAutomaticState('sending');
      onAutomaticPendingChange?.(true);
      void shared.approveSignal({ ...automaticApproval, clientRequestId: requestId.current!.id }).then((r) => {
        onAutomaticPendingChange?.(false);
        if (r.ok) onClose();
        else { setResult(r); setAutomaticState('failed'); }
      }).catch(() => {
        onAutomaticPendingChange?.(false);
        setResult({ ok: false, code: 'unavailable', message: 'The agents could not start a nudge. Nothing was sent.' });
        setAutomaticState('failed');
      });
    }, 900);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [automaticApproval, automaticKey, onAutomaticPendingChange, onClose, shared]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connection check</CardTitle>
        <CardDescription>{automaticApproval
          ? 'The two agents are checking whether a gentle nudge makes sense. Your journal entry stays private.'
          : 'Nothing is shared unless the current relationship preset allows it.'}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!selected && <p className="text-sm text-muted-foreground">This person is no longer one of your accepted connections, so nothing can be shared.</p>}
        {selected && !ownerHex && <p className="text-sm text-muted-foreground">Not connected to the server, so this cannot be checked yet.</p>}
        {prepared?.kind === 'not_ready' && <p className="text-sm">{describeNotReady(prepared)}</p>}
        {automaticState === 'failed' && <p className="text-sm">No nudge was started. Check your connection or sharing preset and try again later.</p>}
        <ResultNotice result={result} />
        {automaticState === 'queued' && <p className="text-sm text-muted-foreground" role="status">Starting the private agent conversation…</p>}
        {automaticState === 'sending' && <p className="text-sm text-muted-foreground" role="status">The agents are considering it…</p>}
        <div className="flex gap-2">
          <Button variant="ghost" disabled={automaticState === 'sending'} onClick={onClose}>{automaticState === 'sending' ? 'Working…' : 'Close'}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
