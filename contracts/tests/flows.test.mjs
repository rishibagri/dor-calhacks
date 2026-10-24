import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  previewDisclosure, nudgeDelivery, templateForSignal, sameApprovedPayload,
  DEFAULT_RECIPIENT_DELIVERY, NUDGE_TEMPLATE_COPY, ApprovedSignalSchema,
} from '../dist/index.js';

const cases = JSON.parse(await readFile(new URL('../fixtures/scenarios.json', import.meta.url), 'utf8'));
const NOW = new Date('2026-10-24T12:00:00Z');
const input = (c, candidate, extra = {}) => ({
  candidate, ownerId: c.approvedSignal.senderId, recipientId: c.approvedSignal.recipientId,
  pairId: c.approvedSignal.pairId, pairStatus: 'accepted',
  preset: structuredClone(c.confirmedPreset), assignment: structuredClone(c.presetAssignment), now: NOW, ...extra,
});
const both = { supportMode: 'short_call', availability: 'this_week' };
const [partners, friends, family] = ['partners', 'friends', 'family'].map(n => cases.find(c => c.scenario === n));

test('F3: same private candidate yields distinct previews per assigned preset', () => {
  const p = previewDisclosure(input(partners, both), 'Sam');
  const f = previewDisclosure(input(friends, both), 'Riley');
  assert.equal(p.kind, 'shareable'); assert.equal(f.kind, 'shareable');
  assert.deepEqual(p.payload, both);
  assert.deepEqual(f.payload, { supportMode: 'short_call' });
  assert.deepEqual(f.blocked, ['coarse_availability']);
  assert.equal('availability' in f.payload, false, 'blocked field omitted, never substituted');
  assert.match(f.ownerSentence, /^Riley may learn that you would welcome a short call\./);
  assert.equal(f.recipientCopy, NUDGE_TEMPLATE_COPY.offer_short_call);
});

test('F3: every fixture signal equals the preview payload of its own fields', () => {
  for (const c of cases) {
    const s = c.approvedSignal;
    const cand = Object.fromEntries(['supportMode', 'availability'].filter(k => s[k] !== undefined).map(k => [k, s[k]]));
    const pv = previewDisclosure(input(c, cand), 'X');
    assert.equal(pv.kind, 'shareable', c.scenario);
    assert.ok(sameApprovedPayload(pv.payload, s), c.scenario);
    assert.equal(templateForSignal(s), c.expectedTemplate, c.scenario);
  }
});

test('F2/F3: "space" or empty candidate is nothing_to_share, not a signal', () => {
  assert.deepEqual(previewDisclosure(input(partners, {}), 'Sam'), { kind: 'nothing_to_share' });
});

test('F3: candidate entirely outside preset is denied, not downgraded', () => {
  const pv = previewDisclosure(input(friends, { availability: 'today' }), 'Riley');
  assert.deepEqual(pv, { kind: 'denied', reason: 'blocked_category' });
});

test('F3: free text, extra fields, nested payloads and quotes are rejected', () => {
  for (const bad of [{ supportMode: 'short_call', note: 'had a rough day' }, { supportMode: { $ne: 1 } },
    { availability: 'tomorrow at 3pm' }, 'short_call', null]) {
    assert.deepEqual(previewDisclosure(input(partners, bad), 'Sam'), { kind: 'denied', reason: 'invalid_schema' });
  }
});

test('F3: preview denies wrong recipient, pending/unlinked pair, missing/stale/revoked/expired preset', () => {
  const d = (x) => previewDisclosure(x, 'Sam');
  assert.equal(d(input(partners, both, { recipientId: 'intruder' })).reason, 'wrong_recipient');
  assert.equal(d(input(partners, both, { pairStatus: 'pending' })).reason, 'no_consent');
  assert.equal(d(input(partners, both, { pairStatus: 'unlinked' })).reason, 'unlinked');
  assert.equal(d(input(partners, both, { assignment: null })).reason, 'no_consent');
  const stale = input(partners, both); stale.assignment.presetId = 'other';
  assert.equal(d(stale).reason, 'stale_policy');
  const revoked = input(partners, both); revoked.preset.revokedAt = '2026-10-23T00:00:00Z';
  assert.equal(d(revoked).reason, 'revoked');
  const expired = input(partners, both); expired.preset.expiresAt = '2026-10-24T11:59:59Z';
  assert.equal(d(expired).reason, 'expired');
});

test('F3: availability-only preview is honest that no nudge results', () => {
  const pv = previewDisclosure(input(family, { availability: 'this_week' }), 'Mom');
  assert.equal(pv.kind, 'shareable');
  assert.equal(pv.recipientCopy, null);
  assert.match(pv.ownerSentence, /produces no nudge/);
  assert.equal(templateForSignal(pv.payload), null);
});

test('F4: approval must carry exactly the previewed payload', () => {
  const s = ApprovedSignalSchema.parse(partners.approvedSignal);
  assert.ok(sameApprovedPayload(both, s));
  assert.equal(sameApprovedPayload({ supportMode: 'short_call' }, s), false);
});

test('F5: delivery defaults deny until recipient opts in', () => {
  assert.deepEqual(nudgeDelivery(DEFAULT_RECIPIENT_DELIVERY, null, NOW), { deliver: false, reason: 'not_opted_in' });
});

test('F5: quiet hours wrap midnight in recipient local time; cooldown is 24h per pair', () => {
  const pst = { ...DEFAULT_RECIPIENT_DELIVERY, optedIn: true, utcOffsetMinutes: -7 * 60 };
  assert.equal(nudgeDelivery(pst, null, new Date('2026-10-24T06:00:00Z')).reason, 'quiet_hours'); // 23:00 local
  assert.equal(nudgeDelivery(pst, null, new Date('2026-10-24T14:30:00Z')).reason, 'quiet_hours'); // 07:30 local
  assert.equal(nudgeDelivery(pst, null, new Date('2026-10-24T15:00:00Z')).deliver, true);       // 08:00 local
  const last = new Date('2026-10-23T20:00:00Z');
  assert.equal(nudgeDelivery(pst, last, new Date('2026-10-24T19:59:00Z')).reason, 'cooldown');
  assert.equal(nudgeDelivery(pst, last, new Date('2026-10-24T20:00:00Z')).deliver, true);
  assert.equal(nudgeDelivery({ ...pst, quietStartMinute: null }, null, new Date('2026-10-24T06:00:00Z')).deliver, true);
});
