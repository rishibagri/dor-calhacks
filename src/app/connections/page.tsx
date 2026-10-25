'use client';

import { AccountInvites } from '@/components/feature/account-invites';
import { PairsList } from '@/components/feature/pairs-list';
import { PresetEditor } from '@/components/feature/preset-editor';
import { introductionActions, toControlRows } from '@/components/feature/introduction-actions';
import { useLiveShared } from '@/components/shell/use-live';
import { IntroductionControls } from '@/features/privacy/introduction-controls';
import { IntegrationStatus } from '@/components/shell/integration-status';

const STEPS = [
  'One of you creates an invite and sends the token.',
  'The other accepts it with the token.',
  'Each of you assigns a preset to the other. Until you do, nothing can be shared.',
];

export default function ConnectionsPage() {
  const shared = useLiveShared();
  const me = shared.myDiscoveryProfile();
  const isDiscoverable = Boolean(me?.published && !me.withdrawn && !me.expired);
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Connections</h1>
        <p className="max-w-[65ch] text-sm text-muted-foreground">
          Presets are per relationship type, not per person. You assign a confirmed preset to each named connection;
          presets limit which gentle in-app nudges dor may offer automatically. Your journal stays private, and each
          person can turn nudges off for a connection at any time.
        </p>
        <ol className="max-w-[65ch] list-decimal space-y-1 pl-5 text-sm text-foreground/80 marker:text-muted-foreground">
          {STEPS.map((s) => <li key={s}>{s}</li>)}
        </ol>
      </header>
      <IntegrationStatus />
      <IntroductionControls introductions={toControlRows(shared.myIntroductions())} discoverable={isDiscoverable} actions={introductionActions(shared)} />
      <AccountInvites />
      <PairsList />
      <PresetEditor />
    </div>
  );
}
