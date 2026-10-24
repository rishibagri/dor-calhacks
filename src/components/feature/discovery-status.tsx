'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLiveShared } from '@/components/shell/use-live';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { tagLabel } from '@/features/discovery/view-model';
import { runAction } from '@/features/privacy/introduction-model';
import { areaLabel } from '@/lib/discovery/config';
import { orThrow } from './introduction-actions';

/** Privacy view of the caller's own discovery publication: what is public, to whom, until when, and stop now. */
export function DiscoveryStatus() {
  const shared = useLiveShared();
  const me = shared.myDiscoveryProfile();
  const [message, setMessage] = useState<string | null>(null);
  const isPublic = Boolean(me?.published && !me.withdrawn && !me.expired && me.expiresAt && Date.parse(me.expiresAt) > Date.now());
  const area = areaLabel(me?.areaKey ?? null);

  const handleWithdraw = async () =>
    setMessage(await runAction(() => orThrow(shared.withdrawDiscoveryProfile())) ?? 'You are no longer discoverable.');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Discovery</CardTitle>
        <CardDescription>Your public profile for meeting people nearby. Separate from your journal and your connections.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!isPublic && <p className="text-muted-foreground">Not discoverable. Nothing about you is shown to people nearby.</p>}
        {isPublic && me && <>
          <dl className="space-y-1">
            <div><dt className="inline font-medium">Shown as: </dt><dd className="inline">{me.displayName} · {me.interestTags.map(tagLabel).join(', ')}</dd></div>
            <div><dt className="inline font-medium">Seen by: </dt><dd className="inline">signed-in people who also opted in{area && me.areaActive ? `, in ${area}` : ''}</dd></div>
            <div><dt className="inline font-medium">Until: </dt><dd className="inline">{new Date(me.expiresAt!).toLocaleString()}</dd></div>
          </dl>
          <p className="text-muted-foreground">Never shown: your location, distance, contact details, connections or journal.</p>
        </>}
        <div className="flex flex-wrap gap-2">
          {isPublic && <Button size="sm" variant="outline" onClick={() => void handleWithdraw()}>Stop being discoverable now</Button>}
          <Button size="sm" variant="ghost" asChild><Link href="/discover">Open Discover</Link></Button>
        </div>
        {message && <p role="status" className="text-muted-foreground">{message}</p>}
      </CardContent>
    </Card>
  );
}
