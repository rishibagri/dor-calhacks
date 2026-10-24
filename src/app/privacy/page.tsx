'use client';

import { ApprovedSignals } from '@/components/feature/approved-signals';
import { DiscoveryStatus } from '@/components/feature/discovery-status';
import { EventPrivacy } from '@/components/feature/event-privacy';
import { areExtensionsEnabled } from '@/lib/config';
import { useLiveShared } from '@/components/shell/use-live';
import { IntegrationStatus } from '@/components/shell/integration-status';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useVault } from '@/lib/backend';
import { VaultControls } from '@/features/privacy/vault-controls';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const FACTS = [
  ['Your journal stays yours', 'It is not shared with your connection.'],
  ['You choose the signals', 'Only limited signals you approve can be used for nudges.'],
  ['Providers process content', 'Our processing providers handle audio and text to provide the service.'],
  ['Nudges can still imply', 'A nudge may let someone infer that you would welcome support.'],
] as const;

function hasDiscoveryFootprint(shared: ReturnType<typeof useLiveShared>): boolean {
  const me = shared.myDiscoveryProfile();
  return Boolean(me?.published && !me.withdrawn) || shared.myEventIntents().some((i) => i.active) ||
    shared.myActivityApprovals().length > 0;
}

export default function PrivacyPage() {
  const vault = useVault();
  const shared = useLiveShared();
  const receipts = shared.myReceipts();
  const names = new Map(shared.myPairs().flatMap((p) => p.counterpartIdentityHex ? [[p.counterpartIdentityHex, p.counterpartDisplayName ?? 'Your connection'] as const] : []));
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Privacy</h1>
        <p className="max-w-[65ch] text-sm text-muted-foreground">What is kept, what is shared, and a record of every time it was.</p>
      </header>
      <Alert>
        <AlertTitle>What this means</AlertTitle>
        <AlertDescription>
          <dl className="mt-2 space-y-2">
            {FACTS.map(([t, d]) => (
              <div key={t}><dt className="font-medium text-foreground">{t}</dt><dd>{d}</dd></div>
            ))}
          </dl>
          <p className="mt-3">
            This is data minimization and access control, not a mathematical privacy guarantee or end-to-end encrypted inference.
          </p>
        </AlertDescription>
      </Alert>
      <ApprovedSignals />
      {/* Extensions: shown when enabled, or whenever there is still something of yours to withdraw. */}
      {(areExtensionsEnabled || hasDiscoveryFootprint(shared)) && <><DiscoveryStatus /><EventPrivacy /></>}
      <Card>
        <CardHeader>
          <CardTitle>Receipts</CardTitle>
          <CardDescription>Every time an approval was made, used, revoked or suppressed.</CardDescription>
        </CardHeader>
        <CardContent>
          {receipts.length === 0 && <p className="text-sm text-muted-foreground">No receipts yet.</p>}
          <ul className="divide-y">
            {receipts.map((r) => (
              <li key={r.receiptId} className="space-y-0.5 py-3 text-sm">
                <p><span className="font-medium capitalize">{r.action}</span> for {names.get(r.recipientId) ?? 'a former connection'}</p>
                <p className="text-muted-foreground">
                  {r.categories.join(', ')} <span aria-hidden>&middot;</span>{' '}
                  <time dateTime={r.createdAt}>{new Date(r.createdAt).toLocaleString()}</time>
                </p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <VaultControls vault={vault} />
      <Card>
        <CardHeader><CardTitle>Integration status</CardTitle></CardHeader>
        <CardContent><IntegrationStatus /></CardContent>
      </Card>
    </div>
  );
}
