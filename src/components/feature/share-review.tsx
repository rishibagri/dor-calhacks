'use client';

import { useEffect, useRef, useState } from 'react';
import type { SignalCandidate } from '@dor/contracts';
import type { ReducerResult } from '@/lib/backend/ports';
import { useLiveShared } from '@/components/shell/use-live';
import { ResultNotice } from '@/components/shell/result-notice';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { describeNotReady, prepareShare, requestIdFor, shareRecipients, standingRuleCovers, type RequestIdSlot } from './share-review-model';

type Props = {
  /** In memory only, from VoiceReflection's onCandidate. Never stored. */
  candidate: SignalCandidate;
  /** The one person the owner chose in the private step. Never defaulted: a different person needs a new preview. */
  recipientPairId: string;
  onClose: () => void;
  onAutomaticPendingChange?: (pending: boolean) => void;
};

/**
 * F3/F4/D044: only the person chosen in the private decision loop can receive the enum-only payload.
 * Manual preview is the default; a current, category-covering standing rule can skip it for this pair.
 */
export function ShareReview({ candidate, recipientPairId, onClose, onAutomaticPendingChange }: Props) {
  const shared = useLiveShared();
  const recipients = shareRecipients(shared.myPairs());
  const [result, setResult] = useState<ReducerResult | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [automaticState, setAutomaticState] = useState<'sending' | 'manual' | null>(null);
  const requestId = useRef<RequestIdSlot | null>(null);
  const attemptedAutomatic = useRef<string | null>(null);

  const selected = recipients.find((r) => r.pairId === recipientPairId);
  const name = selected?.name ?? 'your connection';
  const ownerHex = shared.connection.phase === 'connected' ? shared.connection.identityHex : null;
  const pair = selected && shared.myPairs().find((p) => p.pairId === selected.pairId);
  const prepared = pair && ownerHex ? prepareShare({
    candidate, ownerHex, pair, presets: shared.myPresets(), assignments: shared.myPresetAssignments(), now: new Date(),
  }, name) : null;

  const rule = shared.myStandingConsents().find((r) => r.pairId === recipientPairId) ?? null;
  const paused = shared.myRecipientPauses().some((p) => p.pairId === recipientPairId && p.active && Date.parse(p.expiresAt) > Date.now());
  const automaticApproval = prepared?.kind === 'ready' && !paused && standingRuleCovers(rule, recipientPairId, prepared.approval, Date.now())
    ? prepared.approval : null;
  const automaticKey = automaticApproval && rule ? `${recipientPairId}:${rule.version}:${automaticApproval.payloadRevision}` : null;

  useEffect(() => {
    if (!automaticApproval || !rule || !automaticKey) {
      if (automaticState === 'sending') {
        onAutomaticPendingChange?.(false);
        setAutomaticState('manual');
      }
      return;
    }
    if (attemptedAutomatic.current === automaticKey) return;
    attemptedAutomatic.current = automaticKey;
    setAutomaticState('sending');
    onAutomaticPendingChange?.(true);
    requestId.current = requestIdFor(automaticApproval, requestId.current);
    void shared.approveSignalStanding({
      pairId: recipientPairId,
      ...(automaticApproval.supportMode ? { supportMode: automaticApproval.supportMode } : {}),
      ...(automaticApproval.availability ? { availability: automaticApproval.availability } : {}),
      clientRequestId: requestId.current.id,
      ruleVersion: rule.version,
    }).then((r) => {
      onAutomaticPendingChange?.(false);
      if (r.ok) onClose();
      else { setResult(r); setAutomaticState('manual'); }
    }).catch(() => {
      onAutomaticPendingChange?.(false);
      setResult({ ok: false, code: 'unavailable', message: 'Automatic approval could not be confirmed. Review it manually.' });
      setAutomaticState('manual');
    });
  }, [automaticApproval, automaticKey, automaticState, onAutomaticPendingChange, onClose, recipientPairId, rule, shared]);

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
        <CardDescription>{automaticApproval && automaticState !== 'manual'
          ? 'Applying your saved permission for this named connection.'
          : 'Checked on this device. Nothing leaves until you approve, and you can revoke later in Connections.'}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!selected && <p className="text-sm text-muted-foreground">This person is no longer one of your accepted connections, so nothing can be shared.</p>}
        {selected && !ownerHex && <p className="text-sm text-muted-foreground">Not connected to the server, so this cannot be checked yet.</p>}
        {prepared?.kind === 'not_ready' && <p className="text-sm">{describeNotReady(prepared)}</p>}
        {prepared?.kind === 'ready' && (!automaticApproval || automaticState === 'manual') && (
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
        {automaticState === 'sending' && <p className="text-sm text-muted-foreground" role="status">Applying your saved permission…</p>}
        <div className="flex gap-2">
          {prepared?.kind === 'ready' && !result?.ok && (!automaticApproval || automaticState === 'manual') && (
            <Button onClick={handleApprove} disabled={isSending}>Approve for {name}</Button>
          )}
          <Button variant="ghost" disabled={isSending || automaticState === 'sending'} onClick={onClose}>{result?.ok ? 'Close' : 'Don’t share'}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
