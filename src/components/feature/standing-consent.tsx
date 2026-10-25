'use client';

import { useMemo, useState } from 'react';
import { SHARING_CATEGORIES, type SharingCategory } from '@dor/contracts';
import { useLiveShared } from '@/components/shell/use-live';
import { ResultNotice } from '@/components/shell/result-notice';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ReducerResult, StandingConsentView } from '@/lib/backend/ports';
import { STANDING_CONSENT_VERSION, STANDING_RULE_MAX_LIFETIME_MS, STANDING_RULE_MIN_LIFETIME_MS } from '@dor/contracts/policy';
import { shareRecipients, standingRuleStatus, type StandingRuleStatus } from './share-review-model';

const CATEGORY_LABEL: Record<SharingCategory, string> = {
  support_preference: 'Support preference',
  coarse_availability: 'Coarse availability',
};

/** Why a rule for a current connection no longer applies. Only states the client can actually see are named. */
function endedCopy(status: Exclude<StandingRuleStatus, 'active'>, name: string, expiresAt: string): string {
  switch (status) {
    case 'expired': return `Ended ${new Date(expiresAt).toLocaleString()}: the time limit you chose has passed.`;
    case 'paused': return `Not active while ${name} is paused. Resuming does not turn it back on.`;
    case 'preset_expired': return `Not active: your preset for ${name} has expired. Renew it in Relationship presets first.`;
    case 'inactive': return 'No longer active. A permission ends when it is turned off, the person is paused or unlinked, or their preset or assignment changes.';
  }
}

function localInputValue(date: Date): string {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

export function StandingConsentSettings() {
  const shared = useLiveShared();
  const recipients = shareRecipients(shared.myPairs());
  const ownerId = shared.connection.phase === 'connected' ? shared.connection.identityHex : null;
  const [pairId, setPairId] = useState('');
  const [categories, setCategories] = useState<SharingCategory[]>([]);
  const [expiresAt, setExpiresAt] = useState(() => localInputValue(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)));
  const [result, setResult] = useState<ReducerResult | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = recipients.find((r) => r.pairId === pairId);
  const pair = shared.myPairs().find((p) => p.pairId === pairId && p.status === 'accepted');
  const assignment = shared.myPresetAssignments().find((a) =>
    a.pairId === pairId && a.ownerId === ownerId && a.recipientId === pair?.counterpartIdentityHex);
  const preset = assignment ? shared.myPresets().find((p) => p.policyId === assignment.presetId) : undefined;
  const currentRule = shared.myStandingConsents().find((r) => r.pairId === pairId);
  const pause = shared.myRecipientPauses().find((p) => p.pairId === pairId && p.active && Date.parse(p.expiresAt) > Date.now());
  const presetUsable = Boolean(preset && !preset.revokedAt && Date.parse(preset.expiresAt) > Date.now());
  const available = useMemo(() => SHARING_CATEGORIES.filter((c) => presetUsable && preset?.allowedCategories.includes(c)), [presetUsable, preset?.policyId, preset?.version]);
  const expiresMs = Date.parse(expiresAt);
  const minMs = Date.now() + STANDING_RULE_MIN_LIFETIME_MS;
  const maxMs = Date.now() + STANDING_RULE_MAX_LIFETIME_MS;
  const presetExpiryMs = preset ? Date.parse(preset.expiresAt) : Number.NaN;
  const effectiveMaxMs = Math.min(maxMs, presetExpiryMs);
  const canSave = Boolean(selected && pair && preset && assignment && presetUsable && !pause && categories.length > 0 &&
    Number.isFinite(expiresMs) && expiresMs >= minMs && expiresMs <= effectiveMaxMs);

  // One row per current connection's rule: active ones can be turned off; ended ones explain why and offer a fresh setup.
  const nowMs = Date.now();
  const statusOf = (rule: StandingConsentView) => {
    const p = shared.myPairs().find((x) => x.pairId === rule.pairId && x.status === 'accepted');
    const a = shared.myPresetAssignments().find((x) =>
      x.pairId === rule.pairId && x.ownerId === ownerId && x.recipientId === p?.counterpartIdentityHex);
    const pr = a ? shared.myPresets().find((x) => x.policyId === a.presetId) : undefined;
    const paused = shared.myRecipientPauses().some((x) => x.pairId === rule.pairId && x.active && Date.parse(x.expiresAt) > nowMs);
    return standingRuleStatus(rule, { paused, presetExpiresAt: pr?.expiresAt ?? null }, nowMs);
  };
  const listed = shared.myStandingConsents()
    .filter((rule) => recipients.some((r) => r.pairId === rule.pairId))
    .map((rule) => ({ rule, status: statusOf(rule), name: recipients.find((r) => r.pairId === rule.pairId)?.name ?? 'this person' }));
  const activeRules = listed.filter((x) => x.status === 'active');
  const endedRules = listed.filter((x): x is typeof x & { status: Exclude<StandingRuleStatus, 'active'> } => x.status !== 'active');

  const save = async () => {
    if (!canSave || !preset || !assignment) return;
    setBusy(true);
    setResult(null);
    const r = await shared.setStandingConsent({
      pairId, categories, expiresAt: new Date(expiresMs).toISOString(), expectedVersion: currentRule?.version ?? 0,
      expectedPolicyVersion: preset.version, expectedAssignmentVersion: assignment.assignmentVersion,
      noticeVersion: STANDING_CONSENT_VERSION,
    });
    setResult(r);
    setBusy(false);
  };

  const revoke = async (targetPairId: string) => {
    setBusy(true);
    setResult(null);
    const r = await shared.revokeStandingConsent(targetPairId);
    setResult(r);
    setBusy(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Automatic nudges</CardTitle>
        <CardDescription>Choose one connection and exactly what dor may use. This is optional and separate from your journal.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <section className="space-y-3" aria-labelledby="active-standing-rules">
          <h3 id="active-standing-rules" className="text-sm font-semibold">Active permissions</h3>
          {activeRules.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active automatic-nudge permissions.</p>
          ) : (
            <ul className="space-y-2">
              {activeRules.map(({ rule, name }) => (
                <li key={rule.pairId} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{name} · until {new Date(rule.expiresAt).toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{rule.categories.map((c) => CATEGORY_LABEL[c]).join(', ')}</p>
                  </div>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void revoke(rule.pairId)}>Turn off</Button>
                </li>
              ))}
            </ul>
          )}
          {endedRules.length > 0 && (
            <ul className="space-y-2" aria-label="Permissions that are no longer active">
              {endedRules.map(({ rule, status, name }) => (
                <li key={rule.pairId} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed p-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{name} · not active</p>
                    <p className="text-xs text-muted-foreground">{endedCopy(status, name, rule.expiresAt)}</p>
                  </div>
                  <Button size="sm" variant="ghost" disabled={busy}
                    onClick={() => { setPairId(rule.pairId); setCategories([]); setResult(null); }}>Set up again</Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3 border-t pt-4" aria-labelledby="standing-setup-title">
          <h3 id="standing-setup-title" className="text-sm font-semibold">Set up a permission</h3>
          <div className="space-y-1">
            <Label htmlFor="standing-pair">One accepted connection</Label>
            <select id="standing-pair" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={pairId}
              onChange={(e) => { setPairId(e.target.value); setCategories([]); setResult(null); }}>
              <option value="">Choose a person</option>
              {recipients.map((r) => <option key={r.pairId} value={r.pairId}>{r.name}</option>)}
            </select>
          </div>
          {selected && !presetUsable && <p className="text-sm text-muted-foreground">Assign an active relationship preset to {selected.name} first. A preset sets the maximum categories this permission can cover.</p>}
          {selected && presetUsable && <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Allowed categories</legend>
            {available.map((category) => <div key={category} className="flex items-center gap-2">
              <Checkbox id={`standing-${category}`} checked={categories.includes(category)} disabled={busy}
                onCheckedChange={(checked) => setCategories((current) => checked
                  ? [...new Set([...current, category])]
                  : current.filter((c) => c !== category))} />
              <Label htmlFor={`standing-${category}`}>{CATEGORY_LABEL[category]}</Label>
            </div>)}
            {available.length === 0 && <p className="text-sm text-muted-foreground">Your preset does not allow these nudge categories.</p>}
          </fieldset>}
          {selected && <div className="space-y-1">
            <Label htmlFor="standing-expiry">Permission expires</Label>
            <Input id="standing-expiry" type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)}
              min={localInputValue(new Date(minMs))} max={Number.isFinite(effectiveMaxMs) ? localInputValue(new Date(effectiveMaxMs)) : undefined} />
            <p className="text-xs text-muted-foreground">At least 1 hour and at most 30 days, capped by your preset.</p>
          </div>}
          {selected && <p className="rounded-md bg-muted p-3 text-sm">
            Let dor send {selected.name} matching nudges without asking you each time, for {categories.length ? categories.map((c) => CATEGORY_LABEL[c]).join(' and ') : 'the categories you select'}, until {expiresAt ? new Date(expiresAt).toLocaleString() : 'the date you choose'}. You can turn this off any time. {selected.name} still controls whether they receive nudges.
          </p>}
          {pause && <p className="text-sm text-muted-foreground">This permission cannot be enabled while {selected?.name} is paused.</p>}
          {currentRule?.active && <p className="text-xs text-muted-foreground">Saving replaces the current rule and revokes its unused approvals.</p>}
          {selected && <p className="text-xs text-muted-foreground">Journal text is never shared automatically. Only the categories above can be considered. Recipient opt-in, pauses, quiet hours, expiry and server checks still apply.</p>}
          <Button disabled={!canSave || busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Enable automatic nudges'}</Button>
        </section>
        <ResultNotice result={result} />
      </CardContent>
    </Card>
  );
}
