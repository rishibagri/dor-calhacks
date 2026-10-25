// D049: `activity_interest` is a C7 preset permission only. A preset that allows it still authorizes exactly its core
// (C3) categories for signals, never more; an activity-only preset authorizes no signal at all. Synthetic identities.
import { describe, expect, it } from 'vitest';
import { approveArgs, confirmPreset, mod, pairUp, setup, view } from './helpers';

const SIGNAL_KEYS = ['availability', 'client_request_id', 'consent_version', 'expires_at', 'pair_id', 'preset_assignment_version',
  'purpose', 'recipient_id', 'recipient_policy_id', 'recipient_policy_version', 'revoked_at', 'sender_id', 'signal_id', 'support_mode'];

describe('activity_interest never enters a core signal (D049)', () => {
  it('a core + activity preset approves its core category, and the signal carries no category list at all', () => {
    const w = setup();
    const { pairId } = pairUp(w);
    confirmPreset(w, w.alice, pairId, 'friend', ['support_preference', 'activity_interest']);
    const args = approveArgs(w, w.alice, pairId, { support_mode: 'short_call' });
    w.call(w.alice, ctx => mod.approve_signal(ctx, args));
    const [signal] = view<any>(w, w.alice, mod.my_signals);
    expect(Object.keys(signal).sort()).toEqual(SIGNAL_KEYS);
    expect(JSON.stringify(signal, (_k, v) => (typeof v === 'bigint' ? String(v) : v))).not.toContain('activity');
    // The activity permission does not widen core coverage: availability was never allowed.
    const avail = approveArgs(w, w.alice, pairId, { availability: 'this_week' }, 'req-2');
    expect(() => w.call(w.alice, ctx => mod.approve_signal(ctx, avail))).toThrow(/^unauthorized:/);
  });

  it('an activity-only preset authorizes no core signal', () => {
    const w = setup();
    const { pairId } = pairUp(w);
    confirmPreset(w, w.alice, pairId, 'friend', ['activity_interest']);
    for (const payload of [{ support_mode: 'short_call' }, { availability: 'this_week' }]) {
      const args = approveArgs(w, w.alice, pairId, payload, `req-${Object.keys(payload)[0]}`);
      expect(() => w.call(w.alice, ctx => mod.approve_signal(ctx, args))).toThrow(/^unauthorized:/);
    }
    expect(view(w, w.alice, mod.my_signals)).toHaveLength(0);
  });

  it('standing consent refuses activity_interest as a category', () => {
    const w = setup();
    const { pairId } = pairUp(w);
    confirmPreset(w, w.alice, pairId, 'friend', ['support_preference', 'activity_interest']);
    const preset = view<any>(w, w.alice, mod.my_presets)[0];
    const asg = view<any>(w, w.alice, mod.my_preset_assignments)[0];
    const enable = (categories: string[]) => w.call(w.alice, ctx => mod.set_standing_consent(ctx, {
      pair_id: pairId, categories, expires_at: new Date(w.h.clock.now().toDate().getTime() + 86_400_000).toISOString(),
      expected_version: 0, expected_policy_version: preset.version, expected_assignment_version: asg.assignment_version, notice_version: 1,
    }));
    expect(() => enable(['support_preference', 'activity_interest'])).toThrow('invalid: invalid_schema');
    expect(() => enable(['activity_interest'])).toThrow('invalid: invalid_schema');
    enable(['support_preference']); // control: the same call with only the core category succeeds
    expect(view<any>(w, w.alice, mod.my_standing_consents).map(r => r.categories)).toEqual([['support_preference']]);
  });
});
