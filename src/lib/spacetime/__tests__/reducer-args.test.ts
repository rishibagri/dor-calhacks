import test from 'node:test';
import assert from 'node:assert/strict';
import { reducerArgs } from '../reducer_args.ts';
import setRelationshipPreset from '../module_bindings/set_relationship_preset_reducer.ts';
import assignRelationshipPreset from '../module_bindings/assign_relationship_preset_reducer.ts';
import snoozeNudge from '../module_bindings/snooze_nudge_reducer.ts';
import setSupportPreferences from '../module_bindings/set_support_preferences_reducer.ts';
import pauseRecipient from '../module_bindings/pause_recipient_reducer.ts';
import publishDiscoveryProfile from '../module_bindings/publish_discovery_profile_reducer.ts';
import setStandingConsent from '../module_bindings/set_standing_consent_reducer.ts';
import revokeStandingConsent from '../module_bindings/revoke_standing_consent_reducer.ts';
import approveSignalStanding from '../module_bindings/approve_signal_standing_reducer.ts';

type Binding = Record<string, { algebraicType: { tag: string } }>;
const LATER = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

/** Every field the generated reducer declares is present with the JS type its algebraic type serializes from. */
function assertMatches(name: string, binding: Binding, args: Record<string, unknown>) {
  assert.deepEqual(Object.keys(args).sort(), Object.keys(binding).sort(), `${name}: keys`);
  for (const [key, type] of Object.entries(binding)) {
    const v = args[key], tag = type.algebraicType.tag;
    if (tag === 'String') {
      assert.equal(typeof v, 'string', `${name}.${key} must be a string (module t.string()), got ${Object.prototype.toString.call(v)}`);
    } else if (tag === 'U32' || tag === 'I32') {
      assert.ok(Number.isInteger(v), `${name}.${key} must be an integer`);
    } else if (tag === 'Bool') {
      assert.equal(typeof v, 'boolean', `${name}.${key}`);
    } else if (tag === 'Array') {
      assert.ok(Array.isArray(v), `${name}.${key}`);
    }
  }
}

test('reducer args: time arguments go out as ISO strings the module can parse (the preset "must be an ISO timestamp" bug)', () => {
  const preset = reducerArgs.setRelationshipPreset({ presetKind: 'friend', allowedCategories: ['support_preference'], expectedVersion: 0, expiresAt: LATER });
  assertMatches('set_relationship_preset', setRelationshipPreset as unknown as Binding, preset);
  assert.equal(Date.parse(preset.expiresAt as string), Date.parse(LATER));

  const snooze = reducerArgs.snoozeNudge('nudge-1', LATER);
  assertMatches('snooze_nudge', snoozeNudge as unknown as Binding, snooze);
  assert.equal(Date.parse(snooze.until as string), Date.parse(LATER));
});

test('reducer args: the other builders that carry a time or a version match their bindings too', () => {
  assertMatches('assign_relationship_preset', assignRelationshipPreset as unknown as Binding,
    reducerArgs.assignRelationshipPreset({ pairId: 'pair-1', presetKind: 'friend', expectedAssignmentVersion: 0 }));
  assertMatches('set_support_preferences', setSupportPreferences as unknown as Binding,
    reducerArgs.setSupportPreferences({ pairId: 'pair-1', supportModes: [], availability: [], expiresAt: LATER, expectedVersion: 0 }));
  assertMatches('pause_recipient', pauseRecipient as unknown as Binding, reducerArgs.pauseRecipient('pair-1', LATER, 0));
  assertMatches('publish_discovery_profile', publishDiscoveryProfile as unknown as Binding,
    reducerArgs.publishDiscoveryProfile({ displayName: 'Maya', interestTags: ['climbing'], expiresAt: LATER, expectedRevision: 0 }));
});

test('D044 reducer args match generated bindings and omit no optional payload fields', () => {
  const set = reducerArgs.setStandingConsent({ pairId: 'pair-1', categories: ['support_preference'], expiresAt: LATER,
    expectedVersion: 0, expectedPolicyVersion: 2, expectedAssignmentVersion: 3, noticeVersion: 1 });
  assertMatches('set_standing_consent', setStandingConsent as unknown as Binding, set);
  assert.equal(Date.parse(set.expiresAt), Date.parse(LATER));
  assertMatches('revoke_standing_consent', revokeStandingConsent as unknown as Binding, reducerArgs.revokeStandingConsent('pair-1'));
  assertMatches('approve_signal_standing', approveSignalStanding as unknown as Binding,
    reducerArgs.approveSignalStanding({ pairId: 'pair-1', supportMode: 'encouraging_note', clientRequestId: 'req-1', ruleVersion: 4 }));
});

test('reducer args: an unparseable time is refused before any call', () => {
  assert.throws(() => reducerArgs.snoozeNudge('nudge-1', 'next tuesday'), /invalid: bad timestamp/);
});
