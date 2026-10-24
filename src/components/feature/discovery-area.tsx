'use client';

import { useState } from 'react';
import type { MyDiscoveryView, ReducerResult } from '@/lib/backend/ports';
import { useLiveShared } from '@/components/shell/use-live';
import { ResultNotice } from '@/components/shell/result-notice';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { captureAreaOnce, type AreaCapture } from '@/lib/discovery/area';
import { LAUNCH_AREAS, areaLabel } from '@/lib/discovery/config';

const CAPTURE_COPY: Record<Exclude<AreaCapture['kind'], 'area'>, string> = {
  outside: 'You are not inside any area Dor is open in yet. Pick one below if you are nearby, or try again later.',
  denied: 'Location permission was declined. You can pick your area below instead.',
  unavailable: 'Your location could not be read. You can pick your area below instead.',
};

type Props = { me: MyDiscoveryView | null; isAreaLive: boolean; initialAreaKey?: string | null };

/**
 * One-time area participation. "Use my location once" asks the browser a single time; the device turns the sample
 * into an area name and discards it. Only the area key is sent. Choosing from the list sends no location at all.
 */
export function DiscoveryArea({ me, isAreaLive, initialAreaKey }: Props) {
  const shared = useLiveShared();
  const [result, setResult] = useState<ReducerResult | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [picked, setPicked] = useState(LAUNCH_AREAS.find((a) => a.key === initialAreaKey)?.key ?? LAUNCH_AREAS[0]?.key ?? '');
  const current = areaLabel(me?.areaKey ?? null);

  const join = (areaKey: string) => void shared.setDiscoveryArea(areaKey).then(setResult);

  const handleCapture = async () => {
    setIsCapturing(true);
    const c = await captureAreaOnce();
    setIsCapturing(false);
    if (c.kind === 'area') return join(c.areaKey);
    setResult({ ok: false, code: 'unavailable', message: CAPTURE_COPY[c.kind] });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your area</CardTitle>
        <CardDescription>
          {isAreaLive && current && me?.areaExpiresAt
            ? `${current}, until ${new Date(me.areaExpiresAt).toLocaleString()}. It does not refresh in the background.`
            : 'Choose a broad area to see people who opted in there. Your exact location is never sent or stored.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button size="sm" onClick={() => void handleCapture()} disabled={isCapturing}>
          {isCapturing ? 'Checking…' : isAreaLive ? 'Renew with my location once' : 'Use my location once'}
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="area-pick" className="text-sm">Or pick</label>
          <select id="area-pick" className="h-8 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            value={picked} onChange={(e) => setPicked(e.target.value)}>
            {LAUNCH_AREAS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
          <Button size="sm" variant="outline" onClick={() => join(picked)}>Use this area</Button>
        </div>
        <ResultNotice result={result} />
      </CardContent>
    </Card>
  );
}
