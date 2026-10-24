'use client';

import { useState } from 'react';
import type { MyDiscoveryView, ReducerResult } from '@/lib/backend/ports';
import { useLiveShared } from '@/components/shell/use-live';
import { ResultNotice } from '@/components/shell/result-notice';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { tagLabel } from '@/features/discovery/view-model';
import { DISCOVERY_TAGS } from '@/lib/discovery/config';
import { toggle } from './recipient-settings-model';
import { PUBLICATION_DAYS, checkProfileDraft, publicationExpiry, type PublicationDays } from './discover-model';

type Props = { me: MyDiscoveryView | null; isLive: boolean };

/** Publish (exact preview, explicit confirm) or withdraw the caller's own public discovery profile. */
export function DiscoveryProfile({ me, isLive }: Props) {
  const shared = useLiveShared();
  const [name, setName] = useState<string | null>(null);
  const [tags, setTags] = useState<string[] | null>(null);
  const [days, setDays] = useState<PublicationDays>(3);
  const [isReviewing, setIsReviewing] = useState(false);
  const [result, setResult] = useState<ReducerResult | null>(null);
  const draft = { displayName: name ?? me?.displayName ?? '', interestTags: tags ?? me?.interestTags ?? [] };

  const handleReview = () => {
    const check = checkProfileDraft(draft, publicationExpiry(Date.now(), days), Date.now());
    if (!check.ok) return setResult({ ok: false, code: 'invalid', message: check.message });
    setResult(null);
    setIsReviewing(true);
  };

  const handlePublish = () => {
    void shared.publishDiscoveryProfile({
      displayName: draft.displayName.trim(), interestTags: draft.interestTags,
      expiresAt: publicationExpiry(Date.now(), days), expectedRevision: me?.revision ?? 0,
    }).then((r) => { setResult(r); setIsReviewing(false); if (r.ok) { setName(null); setTags(null); } });
  };

  return (
    <Card id="discovery-profile">
      <CardHeader>
        <CardTitle>Your discoverable profile</CardTitle>
        <CardDescription>
          {isLive && me?.expiresAt
            ? `Visible to people in your area who also opted in, until ${new Date(me.expiresAt).toLocaleString()}.`
            : 'Not visible to anyone. Publishing is optional and ends on its own.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="disc-name">Name to show</Label>
          <Input id="disc-name" maxLength={40} value={draft.displayName} autoComplete="given-name"
            onChange={(e) => { setName(e.target.value); setIsReviewing(false); }} />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Interests</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {DISCOVERY_TAGS.map((t) => (
              <div key={t} className="flex items-center gap-2">
                <Checkbox id={`tag-${t}`} checked={draft.interestTags.includes(t)}
                  onCheckedChange={() => { setTags(toggle(draft.interestTags, t)); setIsReviewing(false); }} />
                <Label htmlFor={`tag-${t}`}>{tagLabel(t)}</Label>
              </div>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="disc-days" className="text-sm">Visible for</label>
          <select id="disc-days" className="h-8 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            value={days} onChange={(e) => { setDays(Number(e.target.value) as PublicationDays); setIsReviewing(false); }}>
            {PUBLICATION_DAYS.map((d) => <option key={d} value={d}>{d === 1 ? '1 day' : `${d} days`}</option>)}
          </select>
          {!isReviewing && <Button size="sm" onClick={handleReview}>{isLive ? 'Review changes' : 'Review and publish'}</Button>}
        </div>
        {isReviewing && (
          <Alert>
            <AlertTitle>Others nearby will see exactly this</AlertTitle>
            <AlertDescription className="space-y-2">
              <p><span className="font-medium text-foreground">{draft.displayName.trim()}</span> · {draft.interestTags.map(tagLabel).join(', ')}</p>
              <p>Not your location, distance, contact details, connections or anything from your journal. You can withdraw at any time.</p>
              <div className="flex gap-2 pt-1">
                <Button size="sm" onClick={handlePublish}>Publish</Button>
                <Button size="sm" variant="ghost" onClick={() => setIsReviewing(false)}>Cancel</Button>
              </div>
            </AlertDescription>
          </Alert>
        )}
        <ResultNotice result={result} />
      </CardContent>
    </Card>
  );
}
