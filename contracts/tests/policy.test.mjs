// C6 production guard tests (offline; synthetic IDs only). Unlike contracts.test.mjs these
// exercise the real deterministic guards, not FakeDisclosurePolicy.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  guardApproval, guardSignalUse, guardSignalStanding, guardNudgeCommit, payloadRevision,
  policyErrorCode, DisclosurePolicy, DISCLOSURE_CONSENT_VERSION, SIGNAL_LIFETIME_MS,
  previewDisclosure, DEFAULT_RECIPIENT_DELIVERY, NUDGE_COOLDOWN_MS,
  guardPreferenceStanding, validSupportPreferences, audienceAllowed, PREFERENCE_MAX_LIFETIME_MS,
} from '../dist/index.js';
import * as zodFree from '../dist/policy.js';

const NOW = Date.parse('2026-10-24T00:00:00Z');
const A = 'alice-id', B = 'bob-id', C = 'carol-id';

function world({ cats = ['support_preference', 'coarse_availability'] } = {}) {
  return {
    nowMs: NOW,
    pair: { pairId: 'pair-1', memberA: A, memberB: B, status: 'accepted' },
    assignment: { ownerId: A, recipientId: B, pairId: 'pair-1', presetId: 'preset-1', assignmentVersion: 1 },
    preset: { policyId: 'preset-1', ownerId: A, allowedCategories: cats, version: 3,
      expiresAtMs: NOW + 7 * SIGNAL_LIFETIME_MS, revokedAtMs: null },
  };
}
function request(over = {}) {
  const base = { callerId: A, pairId: 'pair-1', supportMode: 'short_call', availability: 'this_week',
    recipientPolicyVersion: 3, presetAssignmentVersion: 1, consentVersion: DISCLOSURE_CONSENT_VERSION,
    clientRequestId: 'req-1', ...over };
  const rev = payloadRevision({ ...base, recipientId: B });
  return { payloadRevision: rev, ...base, ...('payloadRevision' in over ? { payloadRevision: over.payloadRevision } : {}) };
}
function storedFrom(req, d, over = {}) {
  return { signalId: 'sig-1', pairId: req.pairId, senderId: req.callerId, recipientId: d.recipientId,
    purpose: 'support_nudge', supportMode: req.supportMode, availability: req.availability,
    consentVersion: req.consentVersion, recipientPolicyId: d.recipientPolicyId,
    recipientPolicyVersion: req.recipientPolicyVersion, presetAssignmentVersion: req.presetAssignmentVersion,
    expiresAtMs: d.expiresAtMs, revokedAtMs: null, ...over };
}
const reason = d => d.reason;

test('zod-free entry point exposes the same guards', () => {
  assert.equal(zodFree.guardApproval, guardApproval);
});

test('owner with accepted pair, assigned confirmed preset and exact revision is approved; expiry clamped to 24h', () => {
  const d = guardApproval(request(), world());
  assert.equal(d.allowed, true);
  assert.equal(d.recipientId, B);
  assert.equal(d.expiresAtMs, NOW + SIGNAL_LIFETIME_MS);
  assert.deepEqual(d.categories, ['support_preference', 'coarse_availability']);
});

test('expiry is clamped to an earlier preset expiry', () => {
  const w = world(); w.preset.expiresAtMs = NOW + 1000;
  assert.equal(guardApproval(request(), w).expiresAtMs, NOW + 1000);
});

test('cross-user: a third user cannot approve on someone else\'s pair (maps to not_found)', () => {
  const d = guardApproval(request({ callerId: C }), world());
  assert.equal(reason(d), 'wrong_recipient');
  assert.equal(policyErrorCode(d.reason), 'not_found');
});

test('the other member approves under their own standard default, never the owner\'s preset', () => {
  // Bob is a member; the only assignment is Alice -> Bob, so Bob's approval uses the default preset for Bob -> Alice.
  const d = guardApproval(request({ callerId: B }), world());
  assert.equal(d.allowed, true);
  assert.equal(d.recipientId, A);
  assert.equal(d.recipientPolicyId, 'default');
});

test('no relationship: pending (FLOWS: no_consent), unlinked, or no second member are denied', () => {
  const pending = world(); pending.pair.status = 'pending';
  assert.equal(reason(guardApproval(request(), pending)), 'no_consent');
  const unlinked = world(); unlinked.pair.status = 'unlinked';
  assert.equal(reason(guardApproval(request(), unlinked)), 'unlinked');
  const half = world(); half.pair.memberB = null;
  assert.equal(reason(guardApproval(request(), half)), 'no_consent');
});

test('no preset, no assignment or a mismatched preset falls back to the standard default for the accepted pair', () => {
  for (const mutate of [w => { w.assignment = null; }, w => { w.preset = null; }, w => { w.preset.policyId = 'some-other-preset'; }]) {
    const w = world(); mutate(w);
    const d = guardApproval(request(), w);
    assert.equal(d.allowed, true);
    assert.equal(d.recipientPolicyId, 'default');
    assert.deepEqual(d.categories, ['support_preference', 'coarse_availability']);
  }
});

test('an assignment for a different recipient or another owner\'s preset is ignored (default applies)', () => {
  const w1 = world(); w1.assignment.recipientId = C;
  assert.equal(guardApproval(request(), w1).recipientPolicyId, 'default');
  const w2 = world(); w2.preset.ownerId = C;
  assert.equal(guardApproval(request(), w2).recipientPolicyId, 'default');
});

test('client version numbers and revision are not binding; the server records its current versions', () => {
  for (const over of [{ recipientPolicyVersion: 2 }, { presetAssignmentVersion: 2 }, { consentVersion: DISCLOSURE_CONSENT_VERSION + 1 },
    { payloadRevision: 12345 }]) {
    const d = guardApproval(request(over), world());
    assert.equal(d.allowed, true, JSON.stringify(over));
    assert.equal(d.recipientPolicyVersion, 3);
    assert.equal(d.presetAssignmentVersion, 1);
  }
});

test('an owner-revoked preset denies approval; an expired one falls back to the default', () => {
  const w1 = world(); w1.preset.revokedAtMs = NOW - 1;
  assert.equal(reason(guardApproval(request(), w1)), 'revoked');
  const w2 = world(); w2.preset.expiresAtMs = NOW;
  assert.equal(guardApproval(request(), w2).recipientPolicyId, 'default');
});

test('blocked fields are dropped; only a request wholly outside the preset is denied', () => {
  const w = world({ cats: ['support_preference'] });
  const d = guardApproval(request(), w);
  assert.equal(d.allowed, true);
  assert.deepEqual(d.payload, { supportMode: 'short_call' });
  assert.deepEqual(d.categories, ['support_preference']);
  assert.equal(reason(guardApproval(request({ supportMode: undefined }), w)), 'blocked_category');
});

test('new preset with all categories blocked shares nothing', () => {
  const w = world({ cats: [] });
  assert.equal(reason(guardApproval(request({ availability: undefined }), w)), 'blocked_category');
});

test('the approved payload is what the server evaluates, whatever revision the client computed', () => {
  const shown = request();
  const d = guardApproval({ ...shown, supportMode: 'shared_activity' }, world());
  assert.equal(d.allowed, true);
  assert.equal(d.payload.supportMode, 'shared_activity');
});

test('revision binds recipient, versions and consent notice', () => {
  const base = { pairId: 'p', recipientId: B, supportMode: 'short_call', recipientPolicyVersion: 1,
    presetAssignmentVersion: 1, consentVersion: 1 };
  const r = payloadRevision(base);
  assert.equal(payloadRevision({ ...base }), r, 'deterministic');
  for (const k of [{ recipientId: C }, { recipientPolicyVersion: 2 }, { presetAssignmentVersion: 2 },
    { consentVersion: 2 }, { supportMode: undefined, availability: 'today' }, { pairId: 'q' }]) {
    assert.notEqual(payloadRevision({ ...base, ...k }), r, JSON.stringify(k));
  }
  assert.ok(Number.isInteger(r) && r >= 0 && r <= 0xffffffff);
});

test('malformed requests (unknown enums, empty payload, oversized ids) are invalid', () => {
  const bad = [{ supportMode: 'share_everything' }, { availability: 'tuesday_3pm' },
    { supportMode: undefined, availability: undefined }, { clientRequestId: '' }, { pairId: 'x'.repeat(129) },
    { callerId: '' }];
  for (const b of bad) assert.equal(reason(guardApproval(request(b), world())), 'invalid_schema', JSON.stringify(b));
});

test('mismatched pair snapshot is never trusted', () => {
  const w = world(); w.pair.pairId = 'pair-2';
  assert.equal(reason(guardApproval(request(), w)), 'wrong_recipient');
});

test('use guard: valid signal passes; preset edits keep it; revoked, unlinked, fully blocked and expired fail', () => {
  const req = request(); const d = guardApproval(req, world());
  const sig = storedFrom(req, d);
  assert.equal(guardSignalUse(sig, world(), B).allowed, true);
  assert.equal(reason(guardSignalUse({ ...sig, revokedAtMs: NOW }, world())), 'revoked');
  const unlinked = world(); unlinked.pair.status = 'unlinked';
  assert.equal(reason(guardSignalUse(sig, unlinked)), 'unlinked');
  const reassigned = world(); reassigned.assignment.assignmentVersion = 2;
  assert.equal(guardSignalUse(sig, reassigned).allowed, true);
  const edited = world(); edited.preset.version = 4;
  assert.equal(guardSignalUse(sig, edited).allowed, true);
  const narrowed = world({ cats: ['coarse_availability'] });
  assert.equal(guardSignalUse(sig, narrowed).allowed, true); // availability still allowed
  const none = world({ cats: [] });
  assert.equal(reason(guardSignalUse(sig, none)), 'blocked_category');
  const presetRevoked = world(); presetRevoked.preset.revokedAtMs = NOW;
  assert.equal(reason(guardSignalUse(sig, presetRevoked)), 'revoked');
  assert.equal(reason(guardSignalUse(sig, { ...world(), nowMs: d.expiresAtMs })), 'expired');
});

test('use guard: wrong recipient and wrong purpose fail; re-pointed preset and notice version do not', () => {
  const req = request(); const sig = storedFrom(req, guardApproval(req, world()));
  assert.equal(reason(guardSignalUse(sig, world(), C)), 'wrong_recipient');
  assert.equal(reason(guardSignalUse({ ...sig, recipientId: C }, world())), 'wrong_recipient');
  const repointed = world(); repointed.preset.policyId = 'preset-2'; repointed.assignment.presetId = 'preset-2';
  assert.equal(guardSignalUse(sig, repointed).allowed, true);
  assert.equal(guardSignalUse({ ...sig, consentVersion: 99 }, world()).allowed, true);
  assert.equal(reason(guardSignalUse({ ...sig, purpose: 'marketing' }, world())), 'invalid_schema');
});

test('standing guard (views, no clock) still catches revocation and version drift', () => {
  const req = request(); const sig = storedFrom(req, guardApproval(req, world()));
  const { nowMs, ...noClock } = world();
  assert.equal(guardSignalStanding(sig, noClock).allowed, true);
  assert.equal(reason(guardSignalStanding({ ...sig, revokedAtMs: 1 }, noClock)), 'revoked');
});

const PREFS = { consentId: 'consent-1', recipientId: B, pairId: 'pair-1', supportModes: ['short_call'], availability: ['this_week'],
  consentVersion: 2, expiresAtMs: NOW + 30 * SIGNAL_LIFETIME_MS, revokedAtMs: null };
const OPEN = { pref: { ...DEFAULT_RECIPIENT_DELIVERY, optedIn: true, quietStartMinute: null, quietEndMinute: null }, lastNudgeAtMs: null, nowMs: NOW, preferences: PREFS };
const BOUND = { recipientConsentId: 'consent-1', recipientConsentVersion: 2 };

test('revocation race: a decision is only as fresh as the snapshot; recheck at commit catches it', () => {
  const req = request(); const sig = storedFrom(req, guardApproval(req, world()));
  const sources = new Map([['sig-1', { signal: sig, snapshot: world() }]]);
  const nudge = { pairId: 'pair-1', recipientId: B, templateId: 'offer_short_call',
    sourceSignalIds: ['sig-1'], sourceConsentVersions: [1], ...BOUND };
  assert.equal(guardNudgeCommit(nudge, sources, OPEN).allowed, true); // coordination-time check passes
  sources.set('sig-1', { signal: { ...sig, revokedAtMs: NOW + 1 }, snapshot: world() }); // owner revokes mid-generation
  assert.equal(reason(guardNudgeCommit(nudge, sources, OPEN)), 'revoked'); // commit-time recheck suppresses
});

test('nudge commit: any known template; unknown sources, wrong pair or recipient and duplicates deny', () => {
  const req = request(); const d = guardApproval(req, world()); const sig = storedFrom(req, d);
  const sources = new Map([['sig-1', { signal: sig, snapshot: world() }]]);
  const base = { pairId: 'pair-1', recipientId: B, templateId: 'offer_short_call',
    sourceSignalIds: ['sig-1'], sourceConsentVersions: [1], ...BOUND };
  const ok = guardNudgeCommit(base, sources, OPEN);
  assert.equal(ok.allowed, true); assert.equal(ok.expiresAtMs, Math.min(d.expiresAtMs, NOW + NUDGE_COOLDOWN_MS));
  assert.equal(guardNudgeCommit({ ...base, templateId: 'offer_note' }, sources, OPEN).allowed, true);
  assert.equal(guardNudgeCommit({ ...base, sourceConsentVersions: [2] }, sources, OPEN).allowed, true);
  assert.equal(reason(guardNudgeCommit({ ...base, templateId: 'free_text_from_model' }, sources, OPEN)), 'invalid_schema');
  assert.equal(reason(guardNudgeCommit({ ...base, sourceSignalIds: ['ghost'] }, sources, OPEN)), 'no_consent');
  assert.equal(reason(guardNudgeCommit({ ...base, recipientId: C }, sources, OPEN)), 'wrong_recipient');
  assert.equal(reason(guardNudgeCommit({ ...base, pairId: 'pair-2' }, sources, OPEN)), 'wrong_recipient');
  assert.equal(reason(guardNudgeCommit({ ...base, sourceSignalIds: ['sig-1', 'sig-1'], sourceConsentVersions: [1, 1] }, sources, OPEN)), 'invalid_schema');
  // Availability-only signals can now carry a nudge too.
  const availOnly = new Map([['sig-1', { signal: { ...sig, supportMode: undefined }, snapshot: world() }]]);
  assert.equal(guardNudgeCommit(base, availOnly, OPEN).allowed, true);
});

test('error codes never leak existence and map denials to API codes', () => {
  assert.deepEqual(['invalid_schema', 'wrong_recipient', 'no_consent', 'blocked_category', 'unlinked', 'expired', 'revoked', 'stale_policy',
    'not_opted_in', 'quiet_hours', 'cooldown']
    .map(policyErrorCode), ['invalid', 'not_found', 'unauthorized', 'unauthorized', 'invalid', 'stale', 'stale', 'stale',
    'unauthorized', 'rate_limited', 'rate_limited']);
});

// ---- DisclosurePolicy (Zod boundary for API/worker) ----
function portFixture() {
  const req = request(); const d = guardApproval(req, world());
  const stored = storedFrom(req, d);
  const envelope = { schemaVersion: 2, signalId: stored.signalId, pairId: stored.pairId, senderId: A,
    recipientId: B, purpose: 'support_nudge', supportMode: 'short_call', availability: 'this_week',
    consentVersion: 1, recipientPolicyId: stored.recipientPolicyId, recipientPolicyVersion: 3,
    presetAssignmentVersion: 1, expiresAt: new Date(stored.expiresAtMs).toISOString() };
  const state = { signal: stored, snapshot: (({ nowMs, ...s }) => s)(world()) };
  const reader = { load: async id => (id === stored.signalId ? state : null) };
  const clock = { t: NOW, now() { return new Date(this.t); } };
  return { envelope, state, policy: new DisclosurePolicy(reader, clock), clock };
}

test('port: exact stored envelope for the right recipient is allowed', async () => {
  const { envelope, policy } = portFixture();
  assert.deepEqual(await policy.check(envelope, B), { allowed: true, reason: 'ok' });
});

test('port: altered payload, forged signal and extra fields are rejected', async () => {
  const { envelope, policy } = portFixture();
  assert.equal((await policy.check({ ...envelope, supportMode: 'shared_activity' }, B)).reason, 'no_consent');
  assert.equal((await policy.check({ ...envelope, expiresAt: '2099-01-01T00:00:00Z' }, B)).reason, 'no_consent');
  assert.equal((await policy.check({ ...envelope, recipientPolicyVersion: 4 }, B)).reason, 'no_consent');
  assert.equal((await policy.check({ ...envelope, signalId: 'minted-by-agent' }, B)).reason, 'no_consent');
  assert.equal((await policy.check({ ...envelope, journalText: 'synthetic secret' }, B)).reason, 'invalid_schema');
  assert.equal((await policy.check({ ...envelope, availability: undefined }, B)).reason, 'no_consent');
});

test('port: cross-user recipient and post-approval revocation are denied', async () => {
  const { envelope, policy, state, clock } = portFixture();
  assert.equal((await policy.check(envelope, C)).reason, 'wrong_recipient');
  state.signal.revokedAtMs = NOW;
  assert.equal((await policy.check(envelope, B)).reason, 'revoked');
  state.signal.revokedAtMs = null; clock.t = state.signal.expiresAtMs;
  assert.equal((await policy.check(envelope, B)).reason, 'expired');
});

test('port: quiz profile and model-shaped output never authorize', async () => {
  const { policy } = portFixture();
  const profile = { schemaVersion: 1, communicationStyle: 'gentle', preferredSupportModes: ['short_call'],
    draftSharingCategories: ['support_preference', 'coarse_availability'], rhythm: 'flexible', suggestionIntensity: 'quiet' };
  assert.equal((await policy.check(profile, B)).reason, 'invalid_schema');
  const modelOutput = { approved: true, supportMode: 'short_call', reasoning: 'they seem stressed' };
  assert.equal((await policy.check(modelOutput, B)).reason, 'invalid_schema');
});

// ---- F5/F7 delivery gate at commit (D017, D018) ----
function commitFixture() {
  const req = request(); const d = guardApproval(req, world()); const sig = storedFrom(req, d);
  return { sources: new Map([['sig-1', { signal: sig, snapshot: world() }]]),
    nudge: { pairId: 'pair-1', recipientId: B, templateId: 'offer_short_call', sourceSignalIds: ['sig-1'], sourceConsentVersions: [1], ...BOUND } };
}

test('commit: accepted-pair delivery defaults on; a persisted opt-out still blocks', () => {
  const { sources, nudge } = commitFixture();
  assert.equal(guardNudgeCommit(nudge, sources, { pref: null, lastNudgeAtMs: null, nowMs: NOW, preferences: PREFS }).allowed, true);
  assert.equal(guardNudgeCommit(nudge, sources, { ...OPEN, pref: { ...OPEN.pref, optedIn: false } }).reason, 'not_opted_in');
  assert.equal(DEFAULT_RECIPIENT_DELIVERY.optedIn, true);
});

test('commit: quiet hours in recipient local time and 24h per-pair cooldown are rechecked at commit', () => {
  const { sources, nudge } = commitFixture();
  const quiet = { ...OPEN, pref: { ...DEFAULT_RECIPIENT_DELIVERY, quietStartMinute: 22 * 60, quietEndMinute: 8 * 60 } }; // 22:00-08:00 UTC
  assert.equal(guardNudgeCommit(nudge, sources, quiet).reason, 'quiet_hours'); // NOW is 00:00Z
  assert.equal(guardNudgeCommit(nudge, sources, { ...OPEN, lastNudgeAtMs: NOW - NUDGE_COOLDOWN_MS + 1 }).reason, 'cooldown');
  assert.equal(guardNudgeCommit(nudge, sources, { ...OPEN, lastNudgeAtMs: NOW - NUDGE_COOLDOWN_MS }).allowed, true);
});

test('commit: consent failures win over delivery state (a revoked source never reaches the gate)', () => {
  const { sources, nudge } = commitFixture();
  const s = sources.get('sig-1'); s.signal.revokedAtMs = NOW;
  assert.equal(guardNudgeCommit(nudge, sources, { pref: null, lastNudgeAtMs: null, nowMs: NOW, preferences: PREFS }).reason, 'revoked');
});

test('commit: a preset edit after approval does not cancel the nudge', () => {
  const { sources, nudge } = commitFixture();
  sources.get('sig-1').snapshot.preset.version++;
  assert.equal(guardNudgeCommit(nudge, sources, OPEN).allowed, true);
});

// ---- C4 recipient preference consent at commit (D021 #4, D035) ----
test('commit: no custom support preferences uses standard styles for the accepted pair', () => {
  const { sources, nudge } = commitFixture();
  const defaultNudge = { ...nudge, recipientConsentId: 'default:pair-1:bob-id', recipientConsentVersion: 1 };
  assert.equal(guardNudgeCommit(defaultNudge, sources, { ...OPEN, preferences: null }).allowed, true);
});

test('commit: support-style settings and consent ids personalize; they never cancel a nudge', () => {
  const { sources, nudge } = commitFixture();
  for (const preferences of [{ ...PREFS, revokedAtMs: NOW, consentVersion: 3 }, { ...PREFS, consentVersion: 3 },
    { ...PREFS, expiresAtMs: NOW }, { ...PREFS, recipientId: C }, { ...PREFS, supportModes: ['encouraging_note'] }]) {
    assert.equal(guardNudgeCommit(nudge, sources, { ...OPEN, preferences }).allowed, true, JSON.stringify(preferences));
  }
  assert.equal(guardNudgeCommit({ ...nudge, recipientConsentId: '', recipientConsentVersion: 0 }, sources, OPEN).allowed, true);
});

test('preference validation and standing (views: no clock)', () => {
  assert.equal(validSupportPreferences({ supportModes: ['short_call'], availability: [] }), true);
  assert.equal(validSupportPreferences({ supportModes: [], availability: [] }), false);
  assert.equal(validSupportPreferences({ supportModes: ['short_call', 'short_call'], availability: [] }), false);
  assert.equal(validSupportPreferences({ supportModes: ['call me at 555-1234'], availability: [] }), false);
  assert.equal(validSupportPreferences({ supportModes: ['short_call'], availability: ['tuesday 9pm'] }), false);
  assert.equal(guardPreferenceStanding(PREFS, B, 'pair-1', null).allowed, true);
  assert.equal(guardPreferenceStanding({ ...PREFS, expiresAtMs: NOW }, B, 'pair-1', null).allowed, true); // sweep's job
  assert.equal(guardPreferenceStanding({ ...PREFS, expiresAtMs: NOW }, B, 'pair-1', NOW).reason, 'expired');
  assert.equal(guardPreferenceStanding(null, B, 'pair-1', NOW).reason, 'no_consent');
  assert.equal(PREFERENCE_MAX_LIFETIME_MS, 30 * 24 * 60 * 60 * 1000);
});

test('JWT audience: fail closed on empty allowlist, missing or foreign audience', () => {
  assert.equal(audienceAllowed(['dor'], ['dor']), true);
  assert.equal(audienceAllowed(['other-app', 'dor'], ['dor']), true);
  assert.equal(audienceAllowed(['other-app'], ['dor']), false);
  assert.equal(audienceAllowed([], ['dor']), false);
  assert.equal(audienceAllowed(undefined, ['dor']), false);
  assert.equal(audienceAllowed(['dor'], []), false);
  assert.equal(audienceAllowed([''], ['']), false);
});

// ---- One policy: device preview and reducer guard agree on every combination ----
test('previewDisclosure (device) and guardApproval (reducer) never disagree', () => {
  const toContract = w => ({
    preset: w.preset && { schemaVersion: 1, policyId: w.preset.policyId, ownerId: w.preset.ownerId, presetKind: 'partner',
      purpose: 'support_nudge', allowedCategories: [...w.preset.allowedCategories], approvalMode: 'each_item', version: w.preset.version,
      expiresAt: new Date(w.preset.expiresAtMs).toISOString(), revokedAt: w.preset.revokedAtMs === null ? null : new Date(w.preset.revokedAtMs).toISOString() },
    assignment: w.assignment && { schemaVersion: 1, ...w.assignment },
  });
  const candidates = [{}, { supportMode: 'short_call' }, { availability: 'today' }, { supportMode: 'encouraging_note', availability: 'this_week' }];
  const categorySets = [[], ['support_preference'], ['coarse_availability'], ['support_preference', 'coarse_availability']];
  const mutations = [w => w, w => { w.pair.status = 'pending'; return w; }, w => { w.pair.status = 'unlinked'; return w; },
    w => { w.preset.revokedAtMs = NOW - 1; return w; }, w => { w.preset.expiresAtMs = NOW; return w; },
    w => { w.assignment = null; return w; }, w => { w.assignment.presetId = 'x'; return w; }, w => { w.assignment.recipientId = C; return w; }];
  let compared = 0;
  for (const cand of candidates) for (const cats of categorySets) for (const mutate of mutations) {
    const w = mutate(world({ cats }));
    const { preset, assignment } = toContract(w);
    const pv = previewDisclosure({ candidate: cand, ownerId: A, recipientId: B, pairId: 'pair-1', pairStatus: w.pair.status,
      preset, assignment, now: new Date(NOW) }, 'Bob');
    const d = guardApproval(request({ supportMode: cand.supportMode, availability: cand.availability }), w);
    if (Object.keys(cand).length === 0) assert.equal(d.reason, 'invalid_schema'); // nothing to approve, whatever the preview says
    else if (pv.kind === 'shareable') { assert.equal(d.allowed, true, JSON.stringify({ cand, cats })); assert.deepEqual(d.payload, pv.payload); }
    else assert.equal(d.reason, pv.reason, JSON.stringify({ cand, cats, pv }));
    compared++;
  }
  assert.equal(compared, 128);
});
