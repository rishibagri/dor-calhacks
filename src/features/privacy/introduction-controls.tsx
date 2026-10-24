'use client';

/**
 * Drop-in introduction and discovery safety controls (Cyber, CYBER-R2). CS passes `my_introductions` rows and
 * an actions port over the generated reducers (README.md). Accept/decline are the recipient's own action;
 * block and report are one tap from any request; withdraw stops discovery immediately. Shows only what the
 * view returns: public name snapshot and shared published interests, never identities or locations.
 */
import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  groupIntroductions, REPORT_REASON_LABELS, REPORT_REASONS, runAction,
  type IntroductionActionsPort, type IntroductionView,
} from './introduction-model';
import type { DiscoveryReportReason } from '@dor/contracts';

function Tags({ tags }: { tags: readonly string[] }) {
  if (tags.length === 0) return null;
  return <div className="flex flex-wrap gap-1">{tags.map((t) => <Badge key={t} variant="secondary">{t.replaceAll('-', ' ')}</Badge>)}</div>;
}

function ReportForm({ onReport, busy }: { onReport: (r: DiscoveryReportReason) => void; busy: boolean }) {
  const [reason, setReason] = useState<DiscoveryReportReason>('spam');
  return (
    <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); onReport(reason); }}>
      <Label htmlFor="report-reason">Why are you reporting?</Label>
      <select id="report-reason" className="h-9 rounded-md border bg-background px-2 text-sm" value={reason}
        onChange={(e) => setReason(e.target.value as DiscoveryReportReason)}>
        {REPORT_REASONS.map((r) => <option key={r} value={r}>{REPORT_REASON_LABELS[r]}</option>)}
      </select>
      <p className="text-sm text-muted-foreground">Reporting also blocks them. They are not told who reported or why.</p>
      <Button type="submit" variant="destructive" disabled={busy}>Report and block</Button>
    </form>
  );
}

export function IntroductionControls({ introductions, discoverable, actions }: {
  introductions: readonly IntroductionView[]; discoverable: boolean; actions: IntroductionActionsPort;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const g = groupIntroductions(introductions);

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setError(null);
    const message = await runAction(fn);
    setBusy(null); setError(message);
    if (!message) setReporting(null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Introductions</CardTitle>
        <CardDescription>
          Only people you accept can connect with you. Accepting shares nothing else: no contact details, journal or support settings.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

        <section aria-labelledby="intro-incoming" className="grid gap-3">
          <h3 id="intro-incoming" className="font-medium">Requests to you</h3>
          {g.incoming.length === 0 && <p className="text-sm text-muted-foreground">No open requests.</p>}
          {g.incoming.map((r) => (
            <div key={r.introId} className="grid gap-2 rounded-lg border p-3">
              <p><span className="font-medium">{r.counterpartName}</span> would like to connect.</p>
              {r.sharedTags.length > 0 && <p className="text-sm text-muted-foreground">You both chose:</p>}
              <Tags tags={r.sharedTags} />
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy !== null} onClick={() => act(r.introId, () => actions.respond(r.introId, true))}>Accept</Button>
                <Button variant="outline" disabled={busy !== null} onClick={() => act(r.introId, () => actions.respond(r.introId, false))}>Decline</Button>
                <Button variant="ghost" disabled={busy !== null} onClick={() => act(r.introId, () => actions.block(r.introId))}>Block</Button>
                <Button variant="ghost" disabled={busy !== null} onClick={() => setReporting(reporting === r.introId ? null : r.introId)}>Report</Button>
              </div>
              {reporting === r.introId && (
                <ReportForm busy={busy !== null} onReport={(reason) => act(r.introId, () => actions.report(r.introId, reason))} />
              )}
            </div>
          ))}
          <p className="text-xs text-muted-foreground">Declining is private: they are not told.</p>
        </section>

        <section aria-labelledby="intro-outgoing" className="grid gap-3">
          <h3 id="intro-outgoing" className="font-medium">Requests you sent</h3>
          {g.outgoing.length === 0 && <p className="text-sm text-muted-foreground">None waiting.</p>}
          {g.outgoing.map((r) => (
            <div key={r.introId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
              <Tags tags={r.sharedTags} />
              <Button variant="outline" disabled={busy !== null} onClick={() => act(r.introId, () => actions.cancel(r.introId))}>Cancel request</Button>
            </div>
          ))}
        </section>

        <section aria-labelledby="intro-connected" className="grid gap-3">
          <h3 id="intro-connected" className="font-medium">Connected</h3>
          {g.connected.length === 0 && <p className="text-sm text-muted-foreground">No connections yet.</p>}
          {g.connected.map((r) => (
            <div key={r.introId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
              <span className="font-medium">{r.counterpartName}</span>
              <div className="flex gap-2">
                <Button variant="ghost" disabled={busy !== null} onClick={() => act(r.introId, () => actions.block(r.introId))}>Block</Button>
                <Button variant="ghost" disabled={busy !== null} onClick={() => setReporting(reporting === r.introId ? null : r.introId)}>Report</Button>
              </div>
              {reporting === r.introId && (
                <ReportForm busy={busy !== null} onReport={(reason) => act(r.introId, () => actions.report(r.introId, reason))} />
              )}
            </div>
          ))}
        </section>

        <section aria-labelledby="intro-discoverable" className="grid gap-2 border-t pt-4">
          <h3 id="intro-discoverable" className="font-medium">Discoverability</h3>
          <p className="text-sm text-muted-foreground">
            {discoverable ? 'People nearby who also opted in can see your public name and interests.' : 'You are not discoverable.'}
          </p>
          {discoverable && (
            <Button variant="outline" disabled={busy !== null} onClick={() => act('withdraw', () => actions.withdraw())}>
              Stop being discoverable now
            </Button>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
