import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ApprovedSignalSchema, LocalConnectionProfileSchema, NudgeSchema } from '../dist/index.js';
import { FakeClock, FakeDisclosurePolicy } from '../dist/fakes.js';
const cases = JSON.parse(await readFile(new URL('../fixtures/scenarios.json', import.meta.url), 'utf8'));
function setup() {
  const signal = structuredClone(cases[0].approvedSignal);
  const state = {
    clock: new FakeClock('2026-10-24T00:00:00Z'), linked: true, revoked: false, approved: signal,
    preset: { schemaVersion: 1, policyId: signal.recipientPolicyId, ownerId: signal.senderId,
      presetKind: 'partner', purpose: 'support_nudge', allowedCategories: ['support_preference','coarse_availability'],
      approvalMode: 'each_item', version: signal.recipientPolicyVersion, expiresAt: signal.expiresAt, revokedAt: null },
    assignment: { schemaVersion: 1, ownerId: signal.senderId, recipientId: signal.recipientId,
      pairId: signal.pairId, presetId: signal.recipientPolicyId, assignmentVersion: signal.presetAssignmentVersion },
  };
  return { signal, state, policy: new FakeDisclosurePolicy(state) };
}
test('all three relationship fixtures satisfy the shared wire schema', () => {
  assert.equal(cases.length, 3);
  for (const c of cases) assert.equal(ApprovedSignalSchema.parse(c.approvedSignal).schemaVersion, 2);
});
test('unknown fields cannot hide private context in an approved signal', () => {
  const { signal } = setup();
  assert.equal(ApprovedSignalSchema.safeParse({ ...signal, journalText: 'synthetic private detail' }).success, false);
});
test('empty or malformed disclosure categories are rejected', () => {
  const { signal } = setup(); delete signal.supportMode; delete signal.availability;
  assert.equal(ApprovedSignalSchema.safeParse(signal).success, false);
  assert.equal(ApprovedSignalSchema.safeParse({ ...signal, supportMode: 'share_everything' }).success, false);
});
test('support-only signal can omit blocked availability', async () => {
  const { signal, state, policy } = setup(); delete signal.availability;
  state.preset.allowedCategories = ['support_preference'];
  assert.equal((await policy.check(signal, signal.recipientId)).allowed, true);
});
test('each recipient needs exact item approval even when a preset permits categories', async () => {
  const { signal, state, policy } = setup(); state.approved = null;
  assert.equal((await policy.check(signal, signal.recipientId)).reason, 'no_consent');
});
test('wrong recipient and altered payload do not inherit approval', async () => {
  const { signal, policy } = setup();
  assert.equal((await policy.check(signal, 'other-user')).reason, 'wrong_recipient');
  assert.equal((await policy.check({ ...signal, supportMode: 'shared_activity' }, signal.recipientId)).reason, 'no_consent');
});
test('preset category restriction suppresses incompatible envelope', async () => {
  const { signal, state, policy } = setup(); state.preset.allowedCategories = ['support_preference'];
  assert.equal((await policy.check(signal, signal.recipientId)).reason, 'blocked_category');
});
test('preset change and recipient reassignment invalidate old pending envelopes', async () => {
  const { signal, state, policy } = setup(); state.preset.version++;
  assert.equal((await policy.check(signal, signal.recipientId)).reason, 'stale_policy');
  state.preset.version--; state.assignment.assignmentVersion++;
  assert.equal((await policy.check(signal, signal.recipientId)).reason, 'stale_policy');
});
test('revoked, unlinked and expired states prevent subsequent use', async () => {
  const { signal, state, policy } = setup();
  assert.equal((await policy.check(signal, signal.recipientId)).allowed, true);
  state.revoked = true; assert.equal((await policy.check(signal, signal.recipientId)).reason, 'revoked');
  state.revoked = false; state.linked = false;
  assert.equal((await policy.check(signal, signal.recipientId)).reason, 'unlinked');
  state.linked = true; state.clock.set('2100-01-01T00:00:00Z');
  assert.equal((await policy.check(signal, signal.recipientId)).reason, 'expired');
});
test('local profile is not a shared disclosure or authorization record', () => {
  const profile = LocalConnectionProfileSchema.parse({ schemaVersion: 1, communicationStyle: null,
    preferredSupportModes: [], draftSharingCategories: [], rhythm: null, suggestionIntensity: null });
  assert.equal(ApprovedSignalSchema.safeParse(profile).success, false);
});
test('nudge source versions must line up with their source signal IDs', () => {
  assert.equal(NudgeSchema.safeParse({ schemaVersion: 1, id: 'n', pairId: 'p', recipientId: 'r',
    sourceSignalIds: ['s'], sourceConsentVersions: [1,2], templateId: 'offer_note',
    createdAt: '2026-10-24T00:00:00Z', expiresAt: '2026-10-25T00:00:00Z' }).success, false);
});

test('all non-signal interface fixtures satisfy their canonical schemas', async () => {
  const schemas = await import('../dist/index.js');
  const fixtures = JSON.parse(await readFile(new URL('../fixtures/interfaces.json', import.meta.url), 'utf8'));
  for (const [name, fixture] of Object.entries(fixtures)) schemas[name + 'Schema'].parse(fixture);
});

test('private reflection candidates are enum-only and never carry journal text', async () => {
  const { PrivateReflectionSchema, SignalCandidateSchema } = await import('../dist/index.js');
  assert.equal(PrivateReflectionSchema.safeParse({ schemaVersion: 1, reflection: 'r', candidate: {} }).success, false,
    'nothing to share is null, never an empty candidate (D019)');
  assert.equal(SignalCandidateSchema.safeParse({ supportMode: 'short_call', note: 'synthetic detail' }).success, false);
  assert.equal(PrivateReflectionSchema.safeParse({ schemaVersion: 1, reflection: 'r', candidate: null }).success, true);
  assert.equal(PrivateReflectionSchema.safeParse({ schemaVersion: 1, reflection: 'r', candidate: null,
    sourceJournalId: 'local-1' }).success, false);
});

test('recipient preferences and coordination jobs reject duplicates and free text', async () => {
  const { RecipientSupportPreferencesSchema, CoordinationJobSchema } = await import('../dist/index.js');
  const fixtures = JSON.parse(await readFile(new URL('../fixtures/interfaces.json', import.meta.url), 'utf8'));
  const prefs = fixtures.RecipientSupportPreferences;
  assert.equal(RecipientSupportPreferencesSchema.safeParse({ ...prefs, supportModes: ['short_call', 'short_call'] }).success, false);
  assert.equal(RecipientSupportPreferencesSchema.safeParse({ ...prefs, supportModes: [] }).success, false);
  assert.equal(CoordinationJobSchema.safeParse({ ...fixtures.CoordinationJob, transcript: 'synthetic' }).success, false);
});

test('each scenario signal stays inside its explicitly owner-confirmed preset and assignment', async () => {
  const { RelationshipPresetSchema, RecipientPresetAssignmentSchema } = await import('../dist/index.js');
  const categoryOf = { supportMode: 'support_preference', availability: 'coarse_availability' };
  for (const c of cases) {
    const preset = RelationshipPresetSchema.parse(c.confirmedPreset);
    const assignment = RecipientPresetAssignmentSchema.parse(c.presetAssignment);
    const s = c.approvedSignal;
    assert.ok(['matches_suggestion', 'owner_selected_beyond_suggestion'].includes(c.presetConfirmation), c.scenario);
    assert.equal(preset.ownerId, s.senderId);
    assert.equal(preset.policyId, s.recipientPolicyId);
    assert.equal(preset.version, s.recipientPolicyVersion);
    assert.deepEqual([assignment.ownerId, assignment.recipientId, assignment.pairId, assignment.presetId],
      [s.senderId, s.recipientId, s.pairId, preset.policyId]);
    assert.equal(assignment.assignmentVersion, s.presetAssignmentVersion);
    for (const [field, category] of Object.entries(categoryOf)) {
      if (s[field] !== undefined) assert.ok(preset.allowedCategories.includes(category), `${c.scenario}: ${field} not confirmed`);
    }
  }
});

test('relationship scenarios produce distinct preset outcomes; friend omits blocked availability', () => {
  const byName = Object.fromEntries(cases.map(c => [c.scenario, c]));
  assert.deepEqual(byName.friends.confirmedPreset.allowedCategories, ['support_preference']);
  assert.equal('availability' in byName.friends.approvedSignal, false);
  assert.notDeepEqual(byName.partners.confirmedPreset.allowedCategories, byName.friends.confirmedPreset.allowedCategories);
});
