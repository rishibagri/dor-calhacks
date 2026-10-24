'use client';

import Link from 'next/link';
import { SavedJournals } from '@/components/feature/saved-journals';
import { useBackendUserId, useVault } from '@/lib/backend';
import { VoiceReflection } from '@/features/voice/voice-reflection';
import { VaultControls } from '@/features/privacy/vault-controls';

export default function JournalPage() {
  const vault = useVault();
  const userId = useBackendUserId();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-balance text-2xl font-semibold tracking-tight">Journal</h1>
        <p className="text-muted-foreground">A private place to think out loud.</p>
      </header>
      {!userId ? <p>Sign in to open your account’s local journal.</p> : <>
        <VaultControls vault={vault} />
        <p className="text-sm text-muted-foreground">
          Recording sends audio to Cartesia. Reflection sends the selected text to Claude;
          read-aloud sends the reflection to Cartesia. None of these actions shares it with a connection.
        </p>
        {vault.status.kind === 'live' && !vault.locked
          ? <div key={userId} className="space-y-8"><VoiceReflection vault={vault} /><SavedJournals vault={vault} version={vault.getVersion()} /></div>
          : <p>Unlock your vault to write or record. Locking clears the open draft and stops recording.</p>}
        <p className="text-sm text-muted-foreground">
          AI suggestions stay on this screen. Sharing still requires a separate explicit approval.
          Manage shared permissions in <Link className="underline" href="/privacy">Privacy</Link>.
        </p>
      </>}
    </div>
  );
}
