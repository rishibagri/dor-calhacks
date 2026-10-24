'use client';

import { useState } from 'react';
import type { ReducerResult } from '@/lib/backend/ports';
import { useLiveShared } from '@/components/shell/use-live';
import { ResultNotice } from '@/components/shell/result-notice';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function AccountInvites() {
  const shared = useLiveShared();
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [result, setResult] = useState<ReducerResult | null>(null);
  const account = shared.myAccount();
  const invites = shared.myInvites();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account and invites</CardTitle>
        <CardDescription>
          {account ? `Registered as ${account.displayName}.` : 'Register a display name connections will see.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ResultNotice result={result} />
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); shared.registerAccount(name.trim()).then(setResult); }}>
          <div className="min-w-48 flex-1 space-y-1.5"><Label htmlFor="dn">Display name</Label>
            <Input id="dn" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} /></div>
          <Button type="submit" disabled={name.trim().length === 0}>Register</Button>
        </form>
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Invite someone, then send them the token yourself. It expires, and it only links your accounts.</p>
          <Button variant="outline" onClick={() => shared.createPairInvite().then(setResult)}>Create invite</Button>
          {invites.map((i) => (
            <p key={i.inviteToken} className="rounded-md bg-muted p-3 text-sm motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200">Invite token: <code className="break-all font-mono">{i.inviteToken}</code> <span className="text-muted-foreground">(expires {new Date(i.expiresAt).toLocaleString()})</span></p>
          ))}
        </div>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); shared.acceptPairInvite(token.trim()).then(setResult); }}>
          <div className="min-w-48 flex-1 space-y-1.5"><Label htmlFor="tok">Have an invite? Paste the token</Label>
            <Input id="tok" autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} /></div>
          <Button type="submit" disabled={token.trim().length === 0}>Accept</Button>
        </form>
      </CardContent>
    </Card>
  );
}
