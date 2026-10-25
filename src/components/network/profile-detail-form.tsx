'use client';

/** Your own profile details (D045): where you've landed, what you're into. People you link with see all of this. */
import { useState } from 'react';
import { useLiveShared } from '@/components/shell/use-live';
import { ResultNotice } from '@/components/shell/result-notice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ReducerResult } from '@/lib/backend/ports';
import type { ProfileDetail } from '@/lib/network/types';

const EMPTY: ProfileDetail = { bio: '', homeArea: '', availability: '', upTo: '', interests: [], answers: [] };

export const parseInterests = (raw: string): string[] =>
  [...new Set(raw.split(',').map((t) => t.trim().toLowerCase().replace(/\s+/g, '-')).filter(Boolean))].slice(0, 12);

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

export function ProfileDetailForm() {
  const shared = useLiveShared();
  const saved = shared.myProfileDetail() ?? EMPTY;
  return <Form key={JSON.stringify(saved)} saved={saved} onSave={(d) => shared.setProfileDetail(d)} />;
}

function Form({ saved, onSave }: { saved: ProfileDetail; onSave: (d: ProfileDetail) => Promise<ReducerResult> }) {
  const [d, setD] = useState(saved);
  const [interests, setInterests] = useState(saved.interests.join(', '));
  const [result, setResult] = useState<ReducerResult | null>(null);
  const set = (patch: Partial<ProfileDetail>) => setD((prev) => ({ ...prev, ...patch }));

  const save = async () => setResult(await onSave({ ...d, interests: parseInterests(interests) }));

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <p className="text-sm text-muted-foreground">
        People you link with see these details. Nearby discovery uses the separate public-profile and area controls in Discover.
      </p>
      <Field id="pd-area" label="Where have you landed?">
        <Input id="pd-area" value={d.homeArea} maxLength={64} placeholder="austin" onChange={(e) => set({ homeArea: e.target.value })} />
      </Field>
      <Field id="pd-interests" label="Things you're into (comma separated)">
        <Input id="pd-interests" value={interests} placeholder="climbing, coffee, board games" onChange={(e) => setInterests(e.target.value)} />
      </Field>
      <Field id="pd-bio" label="A line about you">
        <textarea id="pd-bio" value={d.bio} maxLength={280} rows={3} onChange={(e) => set({ bio: e.target.value })}
          className="w-full rounded-md border bg-background p-2 text-sm" />
      </Field>
      <Field id="pd-up" label="What you're up to lately">
        <Input id="pd-up" value={d.upTo} maxLength={120} placeholder="Settling into a new job" onChange={(e) => set({ upTo: e.target.value })} />
      </Field>
      <Field id="pd-free" label="When you're usually free">
        <Input id="pd-free" value={d.availability} maxLength={120} placeholder="Weekday evenings" onChange={(e) => set({ availability: e.target.value })} />
      </Field>
      <Button type="submit">Save</Button>
      <ResultNotice result={result} />
    </form>
  );
}
