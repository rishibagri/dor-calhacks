'use client';

/**
 * Event privacy controls (Cyber, CYBER-R3): everything the caller has currently shared about events, each with
 * an immediate withdraw. CS passes `my_event_intents` and `my_activity_approvals` rows, a title lookup from
 * `catalogue_events`, pair names, and an actions port over the generated reducers (README.md).
 */
import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { runEventAction, type ActivityApprovalView, type EventIntentView, type EventPrivacyActionsPort } from './event-consent-model';

export function EventPrivacyControls({ intents, approvals, eventTitle, pairName, actions }: {
  intents: readonly EventIntentView[]; approvals: readonly ActivityApprovalView[];
  eventTitle: (eventId: string) => string | undefined; pairName: (pairId: string) => string | undefined;
  actions: EventPrivacyActionsPort;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (fn: () => Promise<void>) => { setBusy(true); setError(await runEventAction(fn)); setBusy(false); };
  const active = intents.filter((i) => i.active);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Events you've shared</CardTitle>
        <CardDescription>Withdrawing takes effect immediately. Any plan that relied on it can no longer be accepted.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <section aria-labelledby="ev-intents" className="grid gap-2">
          <h3 id="ev-intents" className="font-medium">Events you marked</h3>
          {active.length === 0 && <p className="text-sm text-muted-foreground">None.</p>}
          {active.map((i) => (
            <div key={i.eventId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
              <span>{eventTitle(i.eventId) ?? 'An event'} <span className="text-sm text-muted-foreground">({i.kind}; ends {i.expiresAt.toLocaleString()})</span></span>
              <Button variant="outline" disabled={busy} onClick={() => act(() => actions.revokeIntent(i.eventId))}>Withdraw</Button>
            </div>
          ))}
        </section>
        <section aria-labelledby="ev-approvals" className="grid gap-2">
          <h3 id="ev-approvals" className="font-medium">Activity interests shared with connections</h3>
          {approvals.length === 0 && <p className="text-sm text-muted-foreground">None.</p>}
          {approvals.map((a) => (
            <div key={a.approvalId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
              <span>{pairName(a.pairId) ?? 'A connection'}: {a.topics.map((t) => t.replaceAll('-', ' ')).join(', ')}
                <span className="text-sm text-muted-foreground"> (until {a.expiresAt.toLocaleString()})</span></span>
              <Button variant="outline" disabled={busy} onClick={() => act(() => actions.revokeApproval(a.approvalId))}>Revoke</Button>
            </div>
          ))}
        </section>
      </CardContent>
    </Card>
  );
}
