'use client';

import { useState } from 'react';
import type { RelationshipPresetKind } from '@dor/contracts';
import type { PairView, ReducerResult } from '@/lib/backend/ports';
import { useLiveShared } from '@/components/shell/use-live';
import { ResultNotice } from '@/components/shell/result-notice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PRESET_KINDS } from './preset-editor';
import { PauseControls } from './pause-controls';
import { RecipientSettings } from './recipient-settings';
import { RelationshipBook } from './relationship-book';

function PairRow({ pair }: { pair: PairView }) {
  const shared = useLiveShared();
  const [kind, setKind] = useState<RelationshipPresetKind>('friend');
  const [result, setResult] = useState<ReducerResult | null>(null);
  const assignment = shared.myPresetAssignments().find((a) => a.pairId === pair.pairId);
  const assigned = shared.myPresets().find((p) => p.policyId === assignment?.presetId);
  const name = pair.counterpartDisplayName ?? 'Pending connection';

  return (
    <li className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200"><Card><CardContent className="space-y-3 pt-6">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{name}</span>
        <Badge variant="secondary" className="capitalize">{pair.status}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        {assigned ? `Assigned: ${assigned.presetKind} preset (${assigned.allowedCategories.join(', ') || 'no categories'}), ask each time.` : pair.status === 'accepted' ? 'Accepted. Assign a preset below; until then nothing can be shared.' : 'No preset assigned: nothing can be shared.'}
      </p>
      {pair.status === 'accepted' && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm" htmlFor={`k-${pair.pairId}`}>Preset for {name}</label>
          <select id={`k-${pair.pairId}`} className="h-8 rounded-md border border-input bg-background px-2 text-sm capitalize focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" value={kind}
            onChange={(e) => setKind(e.target.value as RelationshipPresetKind)}>
            {PRESET_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <Button size="sm" variant="outline" onClick={() => shared.assignRelationshipPreset({
            pairId: pair.pairId, presetKind: kind, expectedAssignmentVersion: assignment?.assignmentVersion ?? 0,
          }).then(setResult)}>Assign</Button>
        </div>
      )}
      <ResultNotice result={result} />
      {pair.status === 'accepted' && <PauseControls pairId={pair.pairId} name={name} />}
      {pair.status === 'accepted' && <RecipientSettings pairId={pair.pairId} name={name} />}
      <RelationshipBook pair={pair} />
      {pair.status !== 'unlinked' && (
        <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => shared.unlinkPair(pair.pairId).then(setResult)}>Unlink</Button>
      )}
    </CardContent></Card></li>
  );
}

export function PairsList() {
  const pairs = useLiveShared().myPairs();
  return (
    <section aria-label="Connections" className="space-y-3">
      <h2 className="text-lg font-semibold">Your connections</h2>
      {pairs.length === 0 && <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">No connections yet. Create an invite above, or paste a token you received.</p>}
      <ul className="space-y-3">{pairs.map((p) => <PairRow key={p.pairId} pair={p} />)}</ul>
    </section>
  );
}
