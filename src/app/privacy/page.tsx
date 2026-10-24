'use client';

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

export default function PrivacyPage() {
  const vault = useVault();
  const receipts = useLiveShared().myReceipts();
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
      <Card>
        <CardHeader>
          <CardTitle>Approved signals and receipts</CardTitle>
          <CardDescription>Exactly which fields were used, for whom, and when.</CardDescription>
        </CardHeader>
        <CardContent>
          {receipts.length === 0 && <p className="text-sm text-muted-foreground">No signals approved yet.</p>}
          <ul className="divide-y">
            {receipts.map((r) => (
              <li key={r.receiptId} className="space-y-0.5 py-3 text-sm">
                <p><span className="font-medium">{r.action}</span> to {r.recipientId}</p>
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
