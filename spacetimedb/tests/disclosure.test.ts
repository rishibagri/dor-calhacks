// C6 authoritative enforcement: every call here is a DIRECT reducer call (no API layer), i.e. what a
// malicious client holding a valid JWT can do. Synthetic identities only.
import { describe, expect, it } from 'vitest';
import { Timestamp } from 'spacetimedb';
import { allSignals, approveArgs, confirmPreset, FUTURE, jwtAuth, mod, pairUp, setup, view } from './helpers';

const HOUR_US = 3_600_000_000n;
type W = ReturnType<typeof setup>;

function partnered(cats = ['support_preference', 'coarse_availability']) {
  const w = setup();
  const { pairId } = pairUp(w);
  confirmPreset(w, w.alice, pairId, 'partner', cats);
  return { w, pairId };
}
const approve = (w: W, who: W['alice'], args: ReturnType<typeof approveArgs>) =>
  w.call(who, ctx => mod.approve_signal(ctx, args));
const BOTH = { support_mode: 'short_call', availability: 'this_week' };

describe('approve_signal: happy path and isolation', () => {
  it('owner approves exact previewed payload; recipient/policy/expiry come from server state', () => {
    const { w, pairId } = partnered();
    const args = approveArgs(w, w.alice, pairId, BOTH);
    approve(w, w.alice, args);
    const [s] = allSignals(w);
    const bobId = view<any>(w, w.alice, mod.my_pairs)[0].counterpart_identity;
    expect(s.recipient_id.isEqual(bobId)).toBe(true);
    expect(s.purpose).toBe('support_nudge');
    expect(s.recipient_policy_id).toBe(view<any>(w, w.alice, mod.my_presets)[0].policy_id);
    const lifetime = s.expires_at.microsSinceUnixEpoch - w.h.clock.now().microsSinceUnixEpoch;
    expect(lifetime).toBe(24n * HOUR_US); // default 24h, never client-chosen
    expect(view<any>(w, w.alice, mod.my_receipts).map(r => [r.action, r.categories]))
      .toEqual([['approved', ['support_preference', 'coarse_availability']]]);
  });

  it('signals and receipts are visible only to the sender; never to recipient or third user', () => {
    const { w, pairId } = partnered();
    approve(w, w.alice, approveArgs(w, w.alice, pairId, BOTH));
    expect(view(w, w.alice, mod.my_signals)).toHaveLength(1);
    for (const u of [w.bob, w.carol]) {
      expect(view(w, u, mod.my_signals)).toHaveLength(0);
      expect(view(w, u, mod.my_receipts)).toHaveLength(0);
    }
  });

  it('expiry is clamped to an earlier preset expiry', () => {
    const w = setup();
    const { pairId } = pairUp(w);
    const presetExp = new Timestamp(w.h.clock.now().microsSinceUnixEpoch + HOUR_US);
    w.call(w.alice, ctx => mod.set_relationship_preset(ctx, { preset_kind: 'partner', allowed_categories: ['support_preference'], expected_version: 0, expires_at: presetExp.toDate().toISOString() }));
    w.call(w.alice, ctx => mod.assign_relationship_preset(ctx, { pair_id: pairId, preset_kind: 'partner', expected_assignment_version: 0 }));
    approve(w, w.alice, approveArgs(w, w.alice, pairId, { support_mode: 'short_call' }));
    expect(allSignals(w)[0].expires_at.microsSinceUnixEpoch).toBe(presetExp.microsSinceUnixEpoch);
  });
});

describe('approve_signal: direct reducer bypass attempts', () => {
  it('unauthenticated / non-allow-listed issuer cannot approve', () => {
    const { w, pairId } = partnered();
    const args = approveArgs(w, w.alice, pairId, BOTH);
    const mallory = jwtAuth('alice', 1n, 'https://evil.example'); // same sub, foreign issuer
    expect(() => approve(w, mallory, args)).toThrow(/^unauthenticated:/);
    expect(allSignals(w)).toHaveLength(0);
  });

  it('accepted pair alone (no confirmed preset / no assignment) grants nothing', () => {
    const w = setup();
    const { pairId } = pairUp(w);
    expect(() => approve(w, w.alice, approveArgs(w, w.alice, pairId, BOTH))).toThrow('unauthorized: no_consent');
    w.call(w.alice, ctx => mod.set_relationship_preset(ctx, { preset_kind: 'partner', allowed_categories: ['support_preference', 'coarse_availability'], expected_version: 0, expires_at: FUTURE }));
    expect(() => approve(w, w.alice, approveArgs(w, w.alice, pairId, BOTH))).toThrow('unauthorized: no_consent');
    expect(allSignals(w)).toHaveLength(0);
  });

  it('third user cannot approve on someone else\'s pair and cannot probe it (not_found)', () => {
    const { w, pairId } = partnered();
    const args = approveArgs(w, w.alice, pairId, BOTH);
    expect(() => approve(w, w.carol, args)).toThrow('not_found: wrong_recipient');
    expect(() => approve(w, w.carol, { ...args, pair_id: 'does-not-exist' })).toThrow('not_found: wrong_recipient');
    expect(allSignals(w)).toHaveLength(0);
  });

  it('the other member cannot use the owner\'s assignment; their own preset governs them', () => {
    const { w, pairId } = partnered();
    const stolen = approveArgs(w, w.alice, pairId, BOTH);
    expect(() => approve(w, w.bob, stolen)).toThrow('unauthorized: no_consent');
    // Bob assigns Alice a friend preset (support only): same input, different permission.
    confirmPreset(w, w.bob, pairId, 'friend', ['support_preference']);
    expect(() => approve(w, w.bob, approveArgs(w, w.bob, pairId, BOTH, 'b1'))).toThrow('unauthorized: blocked_category');
    approve(w, w.bob, approveArgs(w, w.bob, pairId, { support_mode: 'short_call' }, 'b2'));
    const [s] = allSignals(w);
    const aliceId = view<any>(w, w.bob, mod.my_pairs)[0].counterpart_identity;
    expect(s.recipient_id.isEqual(aliceId)).toBe(true);
    expect(s.availability).toBeUndefined();
  });

  it('blocked category denies the whole request; availability is never silently stripped or substituted', () => {
    const { w, pairId } = partnered(['support_preference']);
    expect(() => approve(w, w.alice, approveArgs(w, w.alice, pairId, BOTH))).toThrow('unauthorized: blocked_category');
    expect(() => approve(w, w.alice, approveArgs(w, w.alice, pairId, { support_mode: 'short_call', availability: 'no_preference' }))).toThrow('unauthorized: blocked_category');
    expect(allSignals(w)).toHaveLength(0);
  });

  it('altered payload after preview is rejected (exact item approval)', () => {
    const { w, pairId } = partnered();
    const shown = approveArgs(w, w.alice, pairId, BOTH);
    for (const tamper of [{ support_mode: 'shared_activity' }, { availability: 'today' }, { availability: undefined }, { payload_revision: (shown.payload_revision + 1) >>> 0 }]) {
      expect(() => approve(w, w.alice, { ...shown, ...tamper, client_request_id: JSON.stringify(tamper) })).toThrow('unauthorized: no_consent');
    }
    expect(allSignals(w)).toHaveLength(0);
  });

  it('unknown enums / empty payload are invalid, never coerced', () => {
    const { w, pairId } = partnered();
    for (const p of [{ support_mode: 'share_everything' }, { availability: 'tuesday_3pm' }, {}]) {
      expect(() => approve(w, w.alice, approveArgs(w, w.alice, pairId, p, JSON.stringify(p)))).toThrow('invalid: invalid_schema');
    }
  });

  it('stale preset version, assignment version or consent notice is rejected', () => {
    const { w, pairId } = partnered();
    const ok = approveArgs(w, w.alice, pairId, BOTH);
    expect(() => approve(w, w.alice, approveArgs(w, w.alice, pairId, BOTH, 'r1', { recipient_policy_version: ok.recipient_policy_version + 1 }))).toThrow('stale: stale_policy');
    expect(() => approve(w, w.alice, approveArgs(w, w.alice, pairId, BOTH, 'r2', { preset_assignment_version: 2 }))).toThrow('stale: stale_policy');
    expect(() => approve(w, w.alice, approveArgs(w, w.alice, pairId, BOTH, 'r3', { consent_version: 2 }))).toThrow('stale: stale_policy');
  });

  it('preview taken before a preset edit cannot be approved after it', () => {
    const { w, pairId } = partnered();
    const preview = approveArgs(w, w.alice, pairId, { support_mode: 'short_call' });
    confirmPreset(w, w.alice, pairId, 'partner', ['support_preference', 'coarse_availability']); // version bump
    expect(() => approve(w, w.alice, preview)).toThrow('stale: stale_policy');
  });

  it('pending and unlinked pairs cannot carry disclosures', () => {
    const w = setup();
    w.call(w.alice, ctx => mod.create_pair_invite(ctx, {}));
    const pendingId = view<any>(w, w.alice, mod.my_invites)[0].pair_id;
    expect(() => approve(w, w.alice, approveArgs(w, w.alice, pendingId, BOTH))).toThrow('unauthorized: no_consent'); // FLOWS: pending = no consent
    const { w: w2, pairId } = partnered();
    const preview = approveArgs(w2, w2.alice, pairId, BOTH);
    w2.call(w2.bob, ctx => mod.unlink_pair(ctx, { pair_id: pairId }));
    expect(() => approve(w2, w2.alice, preview)).toThrow('invalid: unlinked');
  });

  it('expired preset denies approval', () => {
    const w = setup();
    const { pairId } = pairUp(w);
    const exp = new Timestamp(w.h.clock.now().microsSinceUnixEpoch + HOUR_US);
    w.call(w.alice, ctx => mod.set_relationship_preset(ctx, { preset_kind: 'partner', allowed_categories: ['support_preference'], expected_version: 0, expires_at: exp.toDate().toISOString() }));
    w.call(w.alice, ctx => mod.assign_relationship_preset(ctx, { pair_id: pairId, preset_kind: 'partner', expected_assignment_version: 0 }));
    const preview = approveArgs(w, w.alice, pairId, { support_mode: 'short_call' });
    w.h.clock.set(exp);
    expect(() => approve(w, w.alice, preview)).toThrow('stale: expired');
  });
});

describe('revocation, retries and stale permissions', () => {
  it('idempotent retry creates one signal and cannot resurrect a revoked one; key reuse with new payload fails', () => {
    const { w, pairId } = partnered();
    const args = approveArgs(w, w.alice, pairId, BOTH);
    approve(w, w.alice, args);
    approve(w, w.alice, args);
    expect(allSignals(w)).toHaveLength(1);
    const id = allSignals(w)[0].signal_id;
    w.call(w.alice, ctx => mod.revoke_signal(ctx, { signal_id: id }));
    approve(w, w.alice, args); // stale retry after revoke
    const after = allSignals(w);
    expect(after).toHaveLength(1);
    expect(after[0].revoked_at).toBeDefined();
    expect(() => approve(w, w.alice, approveArgs(w, w.alice, pairId, { support_mode: 'short_call' }, args.client_request_id))).toThrow('invalid: client_request_id reused');
  });

  it('only the sender can revoke; others get not_found', () => {
    const { w, pairId } = partnered();
    approve(w, w.alice, approveArgs(w, w.alice, pairId, BOTH));
    const id = allSignals(w)[0].signal_id;
    for (const u of [w.bob, w.carol]) {
      expect(() => w.call(u, ctx => mod.revoke_signal(ctx, { signal_id: id }))).toThrow('not_found: signal');
    }
    expect(allSignals(w)[0].revoked_at).toBeUndefined();
  });

  it('revoke suppresses derived nudges and records a sender-only receipt', () => {
    const { w, pairId } = partnered();
    approve(w, w.alice, approveArgs(w, w.alice, pairId, BOTH));
    const s = allSignals(w)[0];
    seedNudgeFor(w, pairId, s);
    expect(view(w, w.bob, mod.my_nudges)).toHaveLength(1);
    w.call(w.alice, ctx => mod.revoke_signal(ctx, { signal_id: s.signal_id }));
    expect(view(w, w.bob, mod.my_nudges)).toHaveLength(0);
    expect(view<any>(w, w.alice, mod.my_receipts).map(r => r.action)).toEqual(['approved', 'revoked']);
    expect(view(w, w.bob, mod.my_receipts)).toHaveLength(0);
  });

  it('reassignment revokes active signals and makes old previews stale', () => {
    const { w, pairId } = partnered();
    const preview = approveArgs(w, w.alice, pairId, BOTH, 'old');
    approve(w, w.alice, approveArgs(w, w.alice, pairId, BOTH, 'first'));
    w.call(w.alice, ctx => mod.set_relationship_preset(ctx, { preset_kind: 'family', allowed_categories: ['support_preference', 'coarse_availability'], expected_version: 0, expires_at: FUTURE }));
    w.call(w.alice, ctx => mod.assign_relationship_preset(ctx, { pair_id: pairId, preset_kind: 'family', expected_assignment_version: 1 }));
    expect(allSignals(w)[0].revoked_at).toBeDefined();
    expect(() => approve(w, w.alice, preview)).toThrow('stale: stale_policy');
  });

  it('defence in depth: a nudge whose source lost standing is hidden even without a suppression write', () => {
    const { w, pairId } = partnered(['support_preference']);
    approve(w, w.alice, approveArgs(w, w.alice, pairId, { support_mode: 'short_call' }));
    seedNudgeFor(w, pairId, allSignals(w)[0]);
    expect(view(w, w.bob, mod.my_nudges)).toHaveLength(1);
    // Broadening bumps the version without suppressing (not a tightening); the old signal is now stale.
    w.call(w.alice, ctx => mod.set_relationship_preset(ctx, { preset_kind: 'partner', allowed_categories: ['support_preference', 'coarse_availability'], expected_version: 1, expires_at: FUTURE }));
    expect(w.h.withReducerTx(w.admin, ctx => ctx.db.nudge.id.find('n1')!.suppressed)).toBe(false);
    expect(view(w, w.bob, mod.my_nudges)).toHaveLength(0);
  });

  it('a nudge addressed to someone other than the signal recipient is never shown', () => {
    const { w, pairId } = partnered();
    approve(w, w.alice, approveArgs(w, w.alice, pairId, BOTH));
    const s = allSignals(w)[0];
    const carolId = w.h.withReducerTx(w.carol, ctx => ctx.sender);
    seedNudgeFor(w, pairId, s, carolId);
    expect(view(w, w.carol, mod.my_nudges)).toHaveLength(0);
  });
});

/** Internal insert stands in for the future guarded nudge-commit reducer (worker milestone). */
function seedNudgeFor(w: W, pairId: string, s: any, recipient = s.recipient_id) {
  w.h.withReducerTx(w.admin, ctx => {
    ctx.db.nudge.insert({
      id: 'n1', pair_id: pairId, recipient_id: recipient, source_signal_ids: [s.signal_id],
      source_consent_versions: [s.consent_version], template_id: 'offer_short_call', created_at: ctx.timestamp,
      expires_at: s.expires_at, dismissed: false, snoozed_until: undefined, suppressed: false,
    });
  });
}

describe('view-level revocation check (missed suppression write)', () => {
  it('revoked source hides the nudge even if the nudge row was never suppressed', () => {
    const { w, pairId } = partnered();
    approve(w, w.alice, approveArgs(w, w.alice, pairId, BOTH));
    const s = allSignals(w)[0];
    seedNudgeFor(w, pairId, s);
    w.h.withReducerTx(w.admin, ctx => { ctx.db.approved_signal.signal_id.update({ ...s, revoked_at: ctx.timestamp }); });
    expect(w.h.withReducerTx(w.admin, ctx => ctx.db.nudge.id.find('n1')!.suppressed)).toBe(false);
    expect(view(w, w.bob, mod.my_nudges)).toHaveLength(0);
  });
});
