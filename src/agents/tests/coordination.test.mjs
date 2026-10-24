import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AgentAckSchema, CoordinationOutcomeSchema, NudgeSchema } from '@kinetic/contracts';
import { FakeClock, FakeDisclosurePolicy } from '@kinetic/contracts/fakes';
import { BoundedCoordinator, eligibleOptions, intersectWindow, NUDGE_COOLDOWN_MS } from '../dist/index.js';
import { ScriptedAckProposer } from '../dist/testing.js';

const json = async (url) => JSON.parse(await readFile(new URL(url, import.meta.url), 'utf8'));
const scenarios = await json('../../../contracts/fixtures/scenarios.json');
const fixture = await json('../fixtures/coordination.synthetic.json');
const signalFor = (scenario) => structuredClone(scenarios.find(s => s.scenario === scenario).approvedSignal);

function setup(scenario, { signalPatch = {}, state: stateOverrides = {}, preferences = {}, preferencesPort, proposer = [], onCall,
  lastNudgeAt, ...deps } = {}) {
  const clock = new FakeClock('2026-10-24T00:00:00Z');
  const signal = { ...signalFor(scenario), ...signalPatch };
  const state = {
    clock, linked: true, revoked: false, approved: structuredClone(signal),
    preset: { schemaVersion: 1, policyId: signal.recipientPolicyId, ownerId: signal.senderId, presetKind: 'partner',
      purpose: 'support_nudge', allowedCategories: ['support_preference', 'coarse_availability'], approvalMode: 'each_item',
      version: signal.recipientPolicyVersion, expiresAt: signal.expiresAt, revokedAt: null },
    assignment: { schemaVersion: 1, ownerId: signal.senderId, recipientId: signal.recipientId, pairId: signal.pairId,
      presetId: signal.recipientPolicyId, assignmentVersion: signal.presetAssignmentVersion },
    ...stateOverrides,
  };
  const prefs = { ...fixture.preferences[scenario], ...preferences };
  const scripted = new ScriptedAckProposer(proposer, onCall && ((round) => onCall(state, round)));
  const coordinator = new BoundedCoordinator({
    policy: new FakeDisclosurePolicy(state), clock, proposer: scripted,
    preferences: preferencesPort ?? { current: async () => prefs }, lastNudgeAt, ...deps,
  });
  return { clock, signal, state, prefs, proposer: scripted, coordinator };
}

for (const c of fixture.cases) {
  test(`fixture case ${c.id}`, async () => {
    const hours = c.lastNudgeHoursAgo;
    const { clock, signal, proposer, coordinator } = setup(c.scenario, {
      state: c.state, preferences: c.preferencesOverride, proposer: c.proposer,
      onCall: c.revokeOnProposerCall ? (state) => { state.revoked = true; } : undefined,
      lastNudgeAt: hours === undefined ? undefined : async () => new Date(Date.parse('2026-10-24T00:00:00Z') - hours * 3600e3),
    });
    const result = await coordinator.coordinate([signal], `req-${c.id}`);
    const [outcome] = result.outcomes;
    CoordinationOutcomeSchema.parse(outcome);
    assert.equal(outcome.outcome, c.expect.outcome);
    assert.equal(outcome.rounds, c.expect.rounds);
    if (c.expect.decidedBy) assert.equal(outcome.decidedBy, c.expect.decidedBy);
    if (c.expect.proposerCalls !== undefined) assert.equal(proposer.calls.length, c.expect.proposerCalls);
    if (c.expect.options) assert.deepEqual(proposer.calls[0].options, c.expect.options);
    if (c.expect.ack === 'decline') assert.equal(result.acknowledgements[0].decision, 'decline');
    if (c.expect.templateId) {
      const [nudge] = result.proposedNudges;
      NudgeSchema.parse(nudge);
      AgentAckSchema.parse(result.acknowledgements[0]);
      assert.equal(nudge.templateId, c.expect.templateId);
      assert.equal(nudge.recipientId, signal.recipientId);
      assert.deepEqual(nudge.sourceSignalIds, [signal.signalId]);
      assert.deepEqual(nudge.sourceConsentVersions, [signal.consentVersion]);
      assert.equal(outcome.nudgeId, nudge.id);
      assert.ok(Date.parse(nudge.expiresAt) <= clock.now().getTime() + NUDGE_COOLDOWN_MS);
    } else {
      assert.equal(result.proposedNudges.length, 0);
    }
  });
}

test('the proposer sees approved enums and options only, never IDs or versions', async () => {
  const { signal, proposer, coordinator } = setup('partners', { proposer: [{ decision: 'compatible', optionIndex: 0 }] });
  await coordinator.coordinate([signal], 'req-minimal');
  const [call] = proposer.calls;
  assert.deepEqual(Object.keys(call).sort(), ['approved', 'options', 'round']);
  const seen = JSON.stringify(call);
  for (const value of [signal.signalId, signal.pairId, signal.senderId, signal.recipientId, signal.recipientPolicyId])
    assert.equal(seen.includes(value), false, `proposer input leaked ${value}`);
});

test('a throwing or ambiguous policy port fails closed', async () => {
  const { signal, proposer, coordinator } = setup('partners', {
    policy: { check: async () => { throw new Error('policy store down'); } }, proposer: [{ decision: 'compatible', optionIndex: 0 }],
  });
  const result = await coordinator.coordinate([signal], 'req-policy-down');
  assert.equal(result.outcomes[0].outcome, 'policy_denied');
  assert.equal(proposer.calls.length, 0);
  const ambiguous = setup('partners', { policy: { check: async () => ({ allowed: 'yes', reason: 'ok' }) } });
  assert.equal((await ambiguous.coordinator.coordinate([ambiguous.signal], 'r')).outcomes[0].outcome, 'policy_denied');
});

test('recipient consent that changes during generation suppresses the nudge', async () => {
  let version = 1;
  const { signal, coordinator } = setup('partners', {
    proposer: [{ decision: 'compatible', optionIndex: 0 }],
    onCall: () => { version = 2; },
    preferencesPort: { current: async () => ({ ...fixture.preferences.partners, consentVersion: version }) },
  });
  const result = await coordinator.coordinate([signal], 'req-consent-change');
  assert.equal(result.outcomes[0].outcome, 'preferences_unavailable');
  assert.equal(result.proposedNudges.length, 0);
});

test('preferences for another pair or recipient are rejected', async () => {
  const { signal, proposer, coordinator } = setup('partners', { preferences: { recipientId: 'someone-else' } });
  assert.equal((await coordinator.coordinate([signal], 'r')).outcomes[0].outcome, 'preferences_unavailable');
  assert.equal(proposer.calls.length, 0);
});

test('fallback can be disabled, and timeouts consume rounds', async () => {
  const { signal, proposer, coordinator } = setup('partners', {
    proposer: [new Error('timeout'), new Error('timeout')], fallbackOnProposerFailure: false,
  });
  const result = await coordinator.coordinate([signal], 'req-no-fallback');
  assert.equal(result.outcomes[0].outcome, 'proposer_failed_no_suggestion');
  assert.equal(result.outcomes[0].rounds, 2);
  assert.equal(proposer.calls.length, 2);
  assert.equal(proposer.calls[1].round, 2);
  assert.equal(result.proposedNudges.length, 0);
});

test('a ranking hook may reorder or drop options but cannot add one', async () => {
  const added = { supportMode: 'short_call', availability: 'today' };
  // Two windows survive the intersection, so there is something to rank.
  const { signal, proposer, coordinator } = setup('friends', {
    signalPatch: { availability: 'this_week' },
    proposer: [{ decision: 'compatible', optionIndex: 0 }],
    rank: (options) => [added, ...options.reverse()],
  });
  await coordinator.coordinate([signal], 'req-rank');
  assert.deepEqual(proposer.calls[0].options, [
    { supportMode: 'shared_activity', availability: 'this_week' }, { supportMode: 'shared_activity', availability: 'today' },
  ]);
});

test('nudge IDs are stable per request and differ across requests', async () => {
  const run = async (requestId) => {
    const { signal, coordinator } = setup('partners', { proposer: [{ decision: 'compatible', optionIndex: 0 }] });
    return (await coordinator.coordinate([signal], requestId)).proposedNudges[0].id;
  };
  assert.equal(await run('req-a'), await run('req-a'));
  assert.notEqual(await run('req-a'), await run('req-b'));
});

test('invalid envelopes are dropped before any policy or proposer call', async () => {
  const { signal, proposer, coordinator } = setup('partners');
  const result = await coordinator.coordinate([{ ...signal, journalText: 'synthetic' }], 'req-invalid');
  assert.equal(result.outcomes.length, 0);
  assert.equal(proposer.calls.length, 0);
});

test('availability intersection and support-only envelopes', () => {
  assert.equal(intersectWindow('today', 'this_week'), 'today');
  assert.equal(intersectWindow('this_week', 'today'), 'today');
  assert.equal(intersectWindow('no_preference', 'this_week'), 'this_week');
  assert.equal(intersectWindow('this_week', 'no_preference'), 'this_week');
  const signal = signalFor('partners'); delete signal.availability;
  assert.deepEqual(eligibleOptions(signal, fixture.preferences.partners), [{ supportMode: 'short_call' }]);
  const availabilityOnly = signalFor('partners'); delete availabilityOnly.supportMode;
  assert.deepEqual(eligibleOptions(availabilityOnly, fixture.preferences.partners), [
    { supportMode: 'short_call', availability: 'this_week' }, { supportMode: 'encouraging_note', availability: 'this_week' },
  ]);
});
