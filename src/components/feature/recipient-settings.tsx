'use client';

import { useState } from 'react';
import type { Availability, SupportMode } from '@dor/contracts';
import type { ReducerResult } from '@/lib/backend/ports';
import { useLiveShared } from '@/components/shell/use-live';
import { ResultNotice } from '@/components/shell/result-notice';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AVAILABILITIES, AVAILABILITY_LABELS, CONSENT_DURATION_DAYS, SUPPORT_MODES, SUPPORT_MODE_LABELS,
  buildDelivery, consentExpiry, offsetNote, expectedConsentVersion, formatClock, isConsentActive, localUtcOffsetMinutes, toggle,
  type ConsentDurationDays,
} from './recipient-settings-model';

type Props = { pairId: string; name: string };

/**
 * The caller's OWN recipient settings for one accepted pair: whether nudges may reach them at all
 * (default on, with an immediate opt-out) and which kinds of support they prefer from this person. Nobody else can set these.
 */
export function RecipientSettings({ pairId, name }: Props) {
  return (
    <div className="space-y-4 rounded-lg border p-4">
      <h3 className="text-sm font-semibold">What {name} may offer you</h3>
      <DeliveryForm pairId={pairId} />
      <PreferencesForm pairId={pairId} />
    </div>
  );
}

/** Shown instead of a form when the stored row exists but could not be read: no default, only a safe off switch. */
function Unreadable({ what, actionLabel, onAction }: { what: string; actionLabel: string; onAction: () => Promise<ReducerResult> }) {
  const [result, setResult] = useState<ReducerResult | null>(null);
  return (
    <div className="space-y-2" role="alert">
      <p className="text-sm">Couldn’t read your {what}. They may still be on.</p>
      <Button size="sm" variant="outline" onClick={() => void onAction().then(setResult)}>{actionLabel}</Button>
      <ResultNotice result={result} />
    </div>
  );
}

function DeliveryForm({ pairId }: { pairId: string }) {
  const shared = useLiveShared();
  if (shared.unreadable().nudgeDelivery.some((u) => u.pairId === pairId)) {
    return <Unreadable what="nudge settings" actionLabel="Turn off nudges" onAction={() => shared.setNudgeDelivery({
      pairId, optedIn: false, quietStartMinute: null, quietEndMinute: null, utcOffsetMinutes: localUtcOffsetMinutes(),
    })} />;
  }
  return <DeliveryFields pairId={pairId} />;
}

function DeliveryFields({ pairId }: { pairId: string }) {
  const shared = useLiveShared();
  const current = shared.myNudgeDelivery().find((d) => d.pairId === pairId);
  const [optedIn, setOptedIn] = useState<boolean | null>(null);
  const [quietStart, setQuietStart] = useState<string | null>(null);
  const [quietEnd, setQuietEnd] = useState<string | null>(null);
  const [result, setResult] = useState<ReducerResult | null>(null);
  const draft = {
    optedIn: optedIn ?? current?.optedIn ?? true,
    quietStart: quietStart ?? formatClock(current?.quietStartMinute ?? null),
    quietEnd: quietEnd ?? formatClock(current?.quietEndMinute ?? null),
  };

  const handleSave = () => {
    const built = buildDelivery(pairId, draft, localUtcOffsetMinutes());
    if (!built.ok) return setResult({ ok: false, code: 'invalid', message: built.message });
    void shared.setNudgeDelivery(built.value).then(setResult);
  };

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Nudges</legend>
      <div className="flex items-center gap-2">
        <Checkbox id={`opt-${pairId}`} checked={draft.optedIn} onCheckedChange={(v) => setOptedIn(v === true)} />
        <Label htmlFor={`opt-${pairId}`}>Let in-app nudges from this connection reach me</Label>
      </div>
      <p className="text-xs text-muted-foreground">On for accepted connections by default. Turn it off any time; pending nudges will be hidden.</p>
      <p className="text-xs text-muted-foreground">{offsetNote(current?.utcOffsetMinutes ?? null, localUtcOffsetMinutes())}</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor={`qs-${pairId}`} className="text-xs">Quiet from</Label>
          <Input id={`qs-${pairId}`} type="time" className="h-8 w-28" value={draft.quietStart} onChange={(e) => setQuietStart(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`qe-${pairId}`} className="text-xs">until</Label>
          <Input id={`qe-${pairId}`} type="time" className="h-8 w-28" value={draft.quietEnd} onChange={(e) => setQuietEnd(e.target.value)} />
        </div>
        <Button size="sm" variant="outline" onClick={handleSave}>Save nudge settings</Button>
      </div>
      <ResultNotice result={result} />
    </fieldset>
  );
}

function PreferencesForm({ pairId }: { pairId: string }) {
  const shared = useLiveShared();
  if (shared.unreadable().supportPreferences.some((u) => u.pairId === pairId)) {
    return <Unreadable what="support preferences" actionLabel="Revoke" onAction={() => shared.revokeSupportPreferences(pairId)} />;
  }
  return <PreferencesFields pairId={pairId} />;
}

function PreferencesFields({ pairId }: { pairId: string }) {
  const shared = useLiveShared();
  const current = shared.mySupportPreferences().find((p) => p.pairId === pairId);
  const active = isConsentActive(current, Date.now());
  const [modes, setModes] = useState<SupportMode[] | null>(null);
  const [windows, setWindows] = useState<Availability[] | null>(null);
  const [days, setDays] = useState<ConsentDurationDays>(14);
  const [result, setResult] = useState<ReducerResult | null>(null);
  const draftModes = modes ?? (active ? current!.supportModes : [...SUPPORT_MODES]);
  const draftWindows = windows ?? (active ? current!.availability : []);

  const handleSave = () => {
    if (draftModes.length === 0) {
      return setResult({ ok: false, code: 'invalid', message: 'Pick at least one kind of support, or revoke instead.' });
    }
    void shared.setSupportPreferences({
      pairId, supportModes: draftModes, availability: draftWindows,
      expiresAt: consentExpiry(Date.now(), days), expectedVersion: expectedConsentVersion(current),
    }).then((r) => { setResult(r); if (r.ok) { setModes(null); setWindows(null); } });
  };

  const handleRevoke = () =>
    void shared.revokeSupportPreferences(pairId).then((r) => { setResult(r); if (r.ok) { setModes(null); setWindows(null); } });

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Kinds of support I accept</legend>
      <p className="text-xs text-muted-foreground">
        {active ? `Customized until ${new Date(current!.expiresAt).toLocaleDateString()}.` : 'Standard support styles are active unless you customize them here.'}
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {SUPPORT_MODES.map((m) => (
          <div key={m} className="flex items-center gap-2">
            <Checkbox id={`m-${pairId}-${m}`} checked={draftModes.includes(m)} onCheckedChange={() => setModes(toggle(draftModes, m))} />
            <Label htmlFor={`m-${pairId}-${m}`}>{SUPPORT_MODE_LABELS[m]}</Label>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {AVAILABILITIES.map((a) => (
          <div key={a} className="flex items-center gap-2">
            <Checkbox id={`a-${pairId}-${a}`} checked={draftWindows.includes(a)} onCheckedChange={() => setWindows(toggle(draftWindows, a))} />
            <Label htmlFor={`a-${pairId}-${a}`}>{AVAILABILITY_LABELS[a]}</Label>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm" htmlFor={`d-${pairId}`}>Keep for</label>
        <select id={`d-${pairId}`} className="h-8 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          value={days} onChange={(e) => setDays(Number(e.target.value) as ConsentDurationDays)}>
          {CONSENT_DURATION_DAYS.map((d) => <option key={d} value={d}>{d} days</option>)}
        </select>
        <Button size="sm" variant="outline" onClick={handleSave}>Save</Button>
        {active && <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={handleRevoke}>Reset to standard styles</Button>}
      </div>
      <ResultNotice result={result} />
    </fieldset>
  );
}
