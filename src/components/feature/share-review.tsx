'use client';

import { useRef, useState } from 'react';
import type { SignalCandidate } from '@dor/contracts';
import type { ReducerResult } from '@/lib/backend/ports';
import { useLiveShared } from '@/components/shell/use-live';
import { ResultNotice } from '@/components/shell/result-notice';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { describeNotReady, prepareShare, requestIdFor, shareRecipients, type RequestIdSlot } from './share-review-model';

type Props = {
  /** In memory only, from VoiceReflection's onCandidate. Never stored. */
  candidate: SignalCandidate;
  /** The one person the owner chose in the private step. Never defaulted: a different person needs a new preview. */
  recipientPairId: string;
  onClose: () => void;
};

/**
 * F3/F4: preview on this device exactly what one named connection may learn, then approve or decline.
 * Nothing is sent until "Approve"; declining sends nothing at all.
 */
export function ShareReview({ candidate, recipientPairId, onClose }: Props) {
  const shared = useLiveShared();
  const recipients = shareRecipients(shared.myPairs());
  const [result, setResult] = useState<ReducerResult | null>(null);
  const [isSending, setIsSending] = useState(false);
  const requestId = useRef<RequestIdSlot | null>(null);

  const selected = recipients.find((r) => r.pairId === recipientPairId);
  const name = selected?.name ?? 'your connection';
  const ownerHex = shared.connection.phase === 'connected' ? shared.connection.identityHex : null;
  const pair = selected && shared.myPairs().find((p) => p.pairId === selected.pairId);
  const prepared = pair && ownerHex ? prepareShare({
    candidate, ownerHex, pair, presets: shared.myPresets(), assignments: shared.myPresetAssignments(), now: new Date(),
  }, name) : null;

  const handleApprove = () => {
    if (prepared?.kind !== 'ready') return;
    setIsSending(true);
    requestId.current = requestIdFor(prepared.approval, requestId.current);
    void shared.approveSignal({ ...prepared.approval, clientRequestId: requestId.current.id }).then((r) => { setResult(r); setIsSending(false); });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Review what to share</CardTitle>
        <CardDescription>Checked on this device. Nothing leaves until you approve, and you can revoke later in Privacy.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!selected && <p className="text-sm text-muted-foreground">This person is no longer one of your accepted connections, so nothing can be shared.</p>}
        {selected && !ownerHex && <p className="text-sm text-muted-foreground">Not connected to the server, so this cannot be checked yet.</p>}
        {prepared?.kind === 'not_ready' && <p className="text-sm">{describeNotReady(prepared)}</p>}
        {prepared?.kind === 'ready' && (
          <div className="space-y-3">
            <p className="text-sm">{prepared.preview.ownerSentence}</p>
            {prepared.preview.blocked.length > 0 && (
              <p className="text-sm text-muted-foreground">Left out by your preset: {prepared.preview.blocked.join(', ')}.</p>
            )}
            <Alert>
              <AlertTitle>{name} would see</AlertTitle>
              <AlertDescription>{prepared.preview.recipientCopy ?? 'No nudge. Availability alone is used only to coordinate timing.'}</AlertDescription>
            </Alert>
          </div>
        )}
        <ResultNotice result={result} />
        <div className="flex gap-2">
          {prepared?.kind === 'ready' && !result?.ok && (
            <Button onClick={handleApprove} disabled={isSending}>Approve for {name}</Button>
          )}
          <Button variant="ghost" onClick={onClose}>{result?.ok ? 'Close' : 'Don’t share'}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
