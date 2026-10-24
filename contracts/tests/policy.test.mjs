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

test('cross-user: the other member cannot ride the owner\'s assignment', () => {
  // Bob is a member, but the only assignment is Alice -> Bob.
  assert.equal(reason(guardApproval(request({ callerId: B }), world())), 'wrong_recipient');
  const w = world(); w.assignment = null; w.preset = null;
  assert.equal(reason(guardApproval(request({ callerId: B }), w)), 'no_consent');
});

test('no relationship: pending (FLOWS: no_consent), unlinked, or no second member are denied', () => {
  const pending = world(); pending.pair.status = 'pending';
  assert.equal(reason(guardApproval(request(), pending)), 'no_consent');
  const unlinked = world(); unlinked.pair.status = 'unlinked';
  assert.equal(reason(guardApproval(request(), unlinked)), 'unlinked');
  const half = world(); half.pair.memberB = null;
  assert.equal(reason(guardApproval(request(), half)), 'no_consent');
});

test('no confirmed preset or no assignment means no consent ceiling (default deny)', () => {
  const w1 = world(); w1.assignment = null;
  assert.equal(reason(guardApproval(request(), w1)), 'no_consent');
  const w2 = world(); w2.preset = null;
  assert.equal(reason(guardApproval(request(), w2)), 'no_consent');
  const w3 = world(); w3.preset.policyId = 'some-other-preset'; // assignment points elsewhere (FLOWS)
  assert.equal(reason(guardApproval(request(), w3)), 'stale_policy');
});

test('assignment for a different recipient or a different owner\'s preset is rejected', () => {
  const w1 = world(); w1.assignment.recipientId = C;
  assert.equal(reason(guardApproval(request(), w1)), 'wrong_recipient');
  const w2 = world(); w2.preset.ownerId = C;
  assert.equal(reason(guardApproval(request(), w2)), 'wrong_recipient');
});

test('stale preset version, stale assignment version and stale consent notice are rejected', () => {
  assert.equal(reason(guardApproval(request({ recipientPolicyVersion: 2 }), world())), 'stale_policy');
  assert.equal(reason(guardApproval(request({ presetAssignmentVersion: 2 }), world())), 'stale_policy');
  assert.equal(reason(guardApproval(request({ consentVersion: DISCLOSURE_CONSENT_VERSION + 1 }), world())), 'stale_policy');
});

test('revoked or expired preset denies approval', () => {
  const w1 = world(); w1.preset.revokedAtMs = NOW - 1;
  assert.equal(reason(guardApproval(request(), w1)), 'revoked');
  const w2 = world(); w2.preset.expiresAtMs = NOW;
  assert.equal(reason(guardApproval(request(), w2)), 'expired');
});

test('blocked category denies the whole request; nothing is silently stripped', () => {
  const w = world({ cats: ['support_preference'] });
  assert.equal(reason(guardApproval(request(), w)), 'blocked_category');
  // A fresh support-only preview (new revision) is allowed.
  const d = guardApproval(request({ availability: undefined }), w);
  assert.equal(d.allowed, true);
  assert.deepEqual(d.categories, ['support_preference']);
  // Substituting no_preference does not bypass a blocked availability category.
  assert.equal(reason(guardApproval(request({ availability: 'no_preference' }), w)), 'blocked_category');
});

test('new preset with all categories blocked shares nothing', () => {
  const w = world({ cats: [] });
  assert.equal(reason(guardApproval(request({ availability: undefined }), w)), 'blocked_category');
});

test('altered payload after preview fails the exact-item revision binding', () => {
  const shown = request();
  for (const tamper of [{ supportMode: 'shared_activity' }, { availability: 'today' }, { availability: undefined }]) {
    assert.equal(reason(guardApproval({ ...shown, ...tamper }, world())), 'no_consent', JSON.stringify(tamper));
  }
  assert.equal(reason(guardApproval({ ...shown, payloadRevision: (shown.payloadRevision ^ 1) >>> 0 }, world())), 'no_consent');
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

test('malformed requests (unknown enums, empty payload, bad versions, oversized ids) are invalid', () => {
  const bad = [{ supportMode: 'share_everything' }, { availability: 'tuesday_3pm' },
    { supportMode: undefined, availability: undefined }, { recipientPolicyVersion: 0 },
    { consentVersion: 1.5 }, { payloadRevision: -1 }, { clientRequestId: '' }, { pairId: 'x'.repeat(129) },
    { callerId: '' }];
  for (const b of bad) assert.equal(reason(guardApproval(request(b), world())), 'invalid_schema', JSON.stringify(b));
});

test('mismatched pair snapshot is never trusted', () => {
  const w = world(); w.pair.pairId = 'pair-2';
  assert.equal(reason(guardApproval(request(), w)), 'wrong_recipient');
});

test('use guard: valid signal passes; revoked, unlinked, reassigned, preset changed, expired all fail', () => {
  const req = request(); const d = guardApproval(req, world());
  const sig = storedFrom(req, d);
  assert.equal(guardSignalUse(sig, world(), B).allowed, true);
  assert.equal(reason(guardSignalUse({ ...sig, revokedAtMs: NOW }, world())), 'revoked');
  const unlinked = world(); unlinked.pair.status = 'unlinked';
  assert.equal(reason(guardSignalUse(sig, unlinked)), 'unlinked');
  const reassigned = world(); reassigned.assignment.assignmentVersion = 2;
  assert.equal(reason(guardSignalUse(sig, reassigned)), 'stale_policy');
  const broadened = world(); broadened.preset.version = 4; // even broadening never re-shares old data
  assert.equal(reason(guardSignalUse(sig, broadened)), 'stale_policy');
  const tightened = world({ cats: ['coarse_availability'] });
  assert.equal(reason(guardSignalUse(sig, tightened)), 'blocked_category');
  const presetRevoked = world(); presetRevoked.preset.revokedAtMs = NOW;
  assert.equal(reason(guardSignalUse(sig, presetRevoked)), 'revoked');
  assert.equal(reason(guardSignalUse(sig, { ...world(), nowMs: d.expiresAtMs })), 'expired');
  const presetExpired = world(); presetExpired.preset.expiresAtMs = NOW;
  assert.equal(reason(guardSignalUse(sig, presetExpired)), 'expired');
});

test('use guard: wrong recipient, re-pointed preset and stale consent notice fail', () => {
  const req = request(); const sig = storedFrom(req, guardApproval(req, world()));
  assert.equal(reason(guardSignalUse(sig, world(), C)), 'wrong_recipient');
  assert.equal(reason(guardSignalUse({ ...sig, recipientId: C }, world())), 'wrong_recipient');
  const repointed = world(); repointed.preset.policyId = 'preset-2'; repointed.assignment.presetId = 'preset-2';
  assert.equal(reason(guardSignalUse(sig, repointed)), 'stale_policy');
  assert.equal(reason(guardSignalUse({ ...sig, consentVersion: 99 }, world())), 'stale_policy');
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

test('nudge commit: template must match an approved mode; versions align; unknown sources deny', () => {
  const req = request(); const d = guardApproval(req, world()); const sig = storedFrom(req, d);
  const sources = new Map([['sig-1', { signal: sig, snapshot: world() }]]);
  const base = { pairId: 'pair-1', recipientId: B, templateId: 'offer_short_call',
    sourceSignalIds: ['sig-1'], sourceConsentVersions: [1], ...BOUND };
  const ok = guardNudgeCommit(base, sources, OPEN);
  assert.equal(ok.allowed, true); assert.equal(ok.expiresAtMs, Math.min(d.expiresAtMs, NOW + NUDGE_COOLDOWN_MS));
  assert.equal(reason(guardNudgeCommit({ ...base, templateId: 'offer_note' }, sources, OPEN)), 'blocked_category');
  assert.equal(reason(guardNudgeCommit({ ...base, templateId: 'free_text_from_model' }, sources, OPEN)), 'invalid_schema');
  assert.equal(reason(guardNudgeCommit({ ...base, sourceConsentVersions: [2] }, sources, OPEN)), 'stale_policy');
  assert.equal(reason(guardNudgeCommit({ ...base, sourceSignalIds: ['ghost'] }, sources, OPEN)), 'no_consent');
  assert.equal(reason(guardNudgeCommit({ ...base, recipientId: C }, sources, OPEN)), 'wrong_recipient');
  assert.equal(reason(guardNudgeCommit({ ...base, pairId: 'pair-2' }, sources, OPEN)), 'wrong_recipient');
  assert.equal(reason(guardNudgeCommit({ ...base, sourceSignalIds: ['sig-1', 'sig-1'], sourceConsentVersions: [1, 1] }, sources, OPEN)), 'invalid_schema');
  // Availability-only signal cannot justify any template (D020: no nudge from availability-only approval).
  const availOnly = new Map([['sig-1', { signal: { ...sig, supportMode: undefined }, snapshot: world() }]]);
  assert.equal(reason(guardNudgeCommit(base, availOnly, OPEN)), 'blocked_category');
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

test('commit: recipient never opted in (no delivery row) means no nudge; default is off', () => {
  const { sources, nudge } = commitFixture();
  assert.equal(guardNudgeCommit(nudge, sources, { pref: null, lastNudgeAtMs: null, nowMs: NOW, preferences: PREFS }).reason, 'not_opted_in');
  assert.equal(guardNudgeCommit(nudge, sources, { ...OPEN, pref: { ...OPEN.pref, optedIn: false } }).reason, 'not_opted_in');
  assert.equal(DEFAULT_RECIPIENT_DELIVERY.optedIn, false);
});

test('commit: quiet hours in recipient local time and 24h per-pair cooldown are rechecked at commit', () => {
  const { sources, nudge } = commitFixture();
  const quiet = { ...OPEN, pref: { ...DEFAULT_RECIPIENT_DELIVERY, optedIn: true } }; // 22:00-08:00 UTC
  assert.equal(guardNudgeCommit(nudge, sources, quiet).reason, 'quiet_hours'); // NOW is 00:00Z
  assert.equal(guardNudgeCommit(nudge, sources, { ...OPEN, lastNudgeAtMs: NOW - NUDGE_COOLDOWN_MS + 1 }).reason, 'cooldown');
  assert.equal(guardNudgeCommit(nudge, sources, { ...OPEN, lastNudgeAtMs: NOW - NUDGE_COOLDOWN_MS }).allowed, true);
});

test('commit: consent failures win over delivery state (a revoked source never reaches the gate)', () => {
  const { sources, nudge } = commitFixture();
  const s = sources.get('sig-1'); s.signal.revokedAtMs = NOW;
  assert.equal(guardNudgeCommit(nudge, sources, { pref: null, lastNudgeAtMs: null, nowMs: NOW, preferences: PREFS }).reason, 'revoked');
});

test('commit: stale approval (preset changed after approval) cannot produce a nudge', () => {
  const { sources, nudge } = commitFixture();
  sources.get('sig-1').snapshot.preset.version++;
  assert.equal(guardNudgeCommit(nudge, sources, OPEN).reason, 'stale_policy');
});

// ---- C4 recipient preference consent at commit (D021 #4, D035) ----
test('commit: no recipient preference consent means no nudge, even when opted in', () => {
  const { sources, nudge } = commitFixture();
  assert.equal(guardNudgeCommit(nudge, sources, { ...OPEN, preferences: null }).reason, 'no_consent');
});

test('commit: preference revoked or edited during generation is caught at commit', () => {
  const { sources, nudge } = commitFixture();
  assert.equal(guardNudgeCommit(nudge, sources, OPEN).allowed, true); // coordinator read v2
  assert.equal(guardNudgeCommit(nudge, sources, { ...OPEN, preferences: { ...PREFS, revokedAtMs: NOW, consentVersion: 3 } }).reason, 'revoked');
  assert.equal(guardNudgeCommit(nudge, sources, { ...OPEN, preferences: { ...PREFS, consentVersion: 3 } }).reason, 'stale_policy');
  assert.equal(guardNudgeCommit({ ...nudge, recipientConsentId: 'consent-other' }, sources, OPEN).reason, 'stale_policy');
  assert.equal(guardNudgeCommit(nudge, sources, { ...OPEN, preferences: { ...PREFS, expiresAtMs: NOW } }).reason, 'expired');
});

test('commit: preference belonging to another recipient or pair is never borrowed', () => {
  const { sources, nudge } = commitFixture();
  assert.equal(guardNudgeCommit(nudge, sources, { ...OPEN, preferences: { ...PREFS, recipientId: C } }).reason, 'wrong_recipient');
  assert.equal(guardNudgeCommit(nudge, sources, { ...OPEN, preferences: { ...PREFS, pairId: 'pair-2' } }).reason, 'wrong_recipient');
});

test('commit: the template mode must be one the recipient accepts; expiry clamps to the consent', () => {
  const { sources, nudge } = commitFixture();
  assert.equal(guardNudgeCommit(nudge, sources, { ...OPEN, preferences: { ...PREFS, supportModes: ['encouraging_note'] } }).reason, 'blocked_category');
  const soon = NOW + 60_000;
  const d = guardNudgeCommit(nudge, sources, { ...OPEN, preferences: { ...PREFS, expiresAtMs: soon } });
  assert.equal(d.allowed, true); assert.equal(d.expiresAtMs, soon);
});

test('commit: malformed consent binding is invalid; consent checks precede delivery state', () => {
  const { sources, nudge } = commitFixture();
  assert.equal(guardNudgeCommit({ ...nudge, recipientConsentVersion: 0 }, sources, OPEN).reason, 'invalid_schema');
  assert.equal(guardNudgeCommit({ ...nudge, recipientConsentId: '' }, sources, OPEN).reason, 'invalid_schema');
  assert.equal(guardNudgeCommit(nudge, sources, { ...OPEN, pref: null, preferences: { ...PREFS, revokedAtMs: NOW } }).reason, 'revoked');
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
    // Approve exactly what the preview would write (or the raw candidate if it was not shareable).
    const payload = pv.kind === 'shareable' ? pv.payload : cand;
    const d = guardApproval(request({ supportMode: payload.supportMode, availability: payload.availability }), w);
    if (Object.keys(cand).length === 0) assert.equal(d.reason, 'invalid_schema'); // nothing to approve, whatever the preview says
    else if (pv.kind === 'shareable') assert.equal(d.allowed, true, JSON.stringify({ cand, cats }));
    else assert.equal(d.reason, pv.reason, JSON.stringify({ cand, cats, pv }));
    // And approving the full candidate when the preview dropped a field is denied, never stripped.
    if (pv.kind === 'shareable' && pv.blocked.length > 0)
      assert.equal(guardApproval(request({ supportMode: cand.supportMode, availability: cand.availability }), w).reason, 'blocked_category');
    compared++;
  }
  assert.equal(compared, 128);
});
