'use client';

import { useState } from 'react';
import { SharingCategorySchema } from '@kinetic/contracts';
import type { RelationshipPresetKind, SharingCategory } from '@kinetic/contracts';
import type { ReducerResult } from '@/lib/backend/ports';
import { useLiveShared } from '@/components/shell/use-live';
import { ResultNotice } from '@/components/shell/result-notice';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { CATEGORY_LABELS, toggle } from './quiz-model';

export const PRESET_KINDS: RelationshipPresetKind[] = ['partner', 'friend', 'family'];
const CATEGORIES = SharingCategorySchema.options;
const EXPIRY_MS = 90 * 24 * 60 * 60 * 1000;

function PresetCard({ kind }: { kind: RelationshipPresetKind }) {
  const shared = useLiveShared();
  const current = shared.myPresets().find((p) => p.presetKind === kind && !p.revokedAt);
  const [cats, setCats] = useState<SharingCategory[] | null>(null);
  const [result, setResult] = useState<ReducerResult | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const draft = cats ?? current?.allowedCategories ?? [];
  const assignedCount = shared.myPresetAssignments().filter((a) => a.presetId === current?.policyId).length;

  const confirm = () =>
    shared.setRelationshipPreset({
      presetKind: kind,
      allowedCategories: draft,
      expectedVersion: current?.version ?? 0,
      expiresAt: new Date(Date.now() + EXPIRY_MS).toISOString(),
    }).then((r) => { setResult(r); setReviewing(false); });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="capitalize">{kind} preset</CardTitle>
        <CardDescription>
          {current ? `Version ${current.version}.` : 'Not confirmed: all categories blocked.'} Editing affects every
          connection assigned to this preset. An allowed category is only a ceiling; each signal still needs your approval.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {CATEGORIES.map((c) => (
          <div key={c} className="flex items-center gap-2">
            <Checkbox id={`${kind}-${c}`} checked={draft.includes(c)}
              onCheckedChange={(on) => { setReviewing(false); setCats(toggle(draft, c, on === true)); }} />
            <Label htmlFor={`${kind}-${c}`}>{CATEGORY_LABELS[c]}</Label>
          </div>
        ))}
        <ResultNotice result={result} />
        {reviewing ? (
          <div role="group" aria-label={`Confirm ${kind} preset`}
            className="space-y-3 rounded-md border bg-muted p-3 text-sm motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200">
            <p>
              You are the owner of this preset. Confirming applies it to everyone assigned the {kind} preset
              ({assignedCount} now); each item still needs your approval before anything is shared.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="active:scale-[0.97] motion-safe:transition-transform" onClick={confirm}>Confirm for everyone assigned</Button>
              <Button size="sm" variant="ghost" onClick={() => setReviewing(false)}>Keep editing</Button>
            </div>
          </div>
        ) : (
          <Button size="sm" className="active:scale-[0.97] motion-safe:transition-transform" onClick={() => setReviewing(true)}>Review {kind} preset</Button>
        )}
      </CardContent>
    </Card>
  );
}

export function PresetEditor() {
  return (
    <section aria-label="Relationship presets" className="space-y-3">
      <h2 className="text-lg font-semibold">Relationship presets</h2>
      <p className="max-w-[65ch] text-sm text-muted-foreground">A preset is a ceiling per relationship type. Editing one changes every connection assigned to it.</p>
      {PRESET_KINDS.map((k) => <PresetCard key={k} kind={k} />)}
    </section>
  );
}
