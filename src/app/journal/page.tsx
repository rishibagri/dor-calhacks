'use client';

import { useState } from 'react';
import { useReflection, useVault } from '@/lib/backend';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export default function JournalPage() {
  const vault = useVault();
  const reflection = useReflection();
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [reflectionText, setReflectionText] = useState<string | null>(null);
  const canSave = vault.status.kind === 'live' && !vault.locked && draft.trim().length > 0;
  const canReflect = reflection.status.kind === 'live' && draft.trim().length > 0;

  async function save() {
    try {
      await vault.saveJournal({ localId: crypto.randomUUID(), text: draft });
      setDraft('');
      setStatus('Saved to your local vault.');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Could not save entry.');
    }
  }

  async function reflect() {
    try {
      const r = await reflection.reflect(draft, crypto.randomUUID());
      setReflectionText(r.reflection);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Reflection failed.');
    }
  }

  const vaultNote = vault.status.kind !== 'live' ? 'Vault pending (Cyber): saving disabled.'
    : vault.locked ? 'Vault is locked: saving disabled.' : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-balance text-2xl font-semibold tracking-tight">Journal</h1>
        <p className="text-muted-foreground">A private place to think out loud.</p>
      </header>
      <section aria-labelledby="entry-heading" className="space-y-3">
        <h2 id="entry-heading" className="sr-only">New entry</h2>
        <Label htmlFor="entry" className="text-sm text-muted-foreground">
          New entry. This draft lives only in this tab&apos;s memory until the vault can store it.
        </Label>
        <Textarea id="entry" rows={14} value={draft} onChange={(e) => setDraft(e.target.value)}
          placeholder="What is on your mind?"
          className="min-h-72 resize-y p-4 text-base leading-relaxed md:text-base" />
        <div className="flex flex-wrap gap-2">
          <Button onClick={save} disabled={!canSave}>Save to vault</Button>
          <Button variant="secondary" onClick={reflect} disabled={!canReflect}>Reflect</Button>
          <Button variant="outline" disabled>Voice (Cartesia adapter pending (AI))</Button>
        </div>
        <div className="space-y-1 text-sm text-muted-foreground">
          {vaultNote && <p>{vaultNote}</p>}
          {reflection.status.kind !== 'live' && <p>Reflection adapter pending (AI).</p>}
        </div>
        {status && <p role="status" className="text-sm text-foreground">{status}</p>}
      </section>
      {reflectionText && (
        <Card><CardHeader><CardTitle>Reflection</CardTitle></CardHeader>
          <CardContent className="leading-relaxed">{reflectionText}</CardContent></Card>
      )}
      <Alert>
        <AlertTitle>Provider processing notice</AlertTitle>
        <AlertDescription className="text-pretty">
          Writing is private. If you ask for a reflection, only the text you selected is sent transiently to our
          processing providers (Claude; Cartesia for voice) to provide that feature. Your connections never see it.
        </AlertDescription>
      </Alert>
    </div>
  );
}
