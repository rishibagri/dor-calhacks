import { describe, expect, it } from 'vitest';
import { Timestamp } from 'spacetimedb';
import { jwtAuth, mod, pairUp, setup, view } from './helpers';

const FUTURE = '2099-01-01T00:00:00Z';

describe('auth gating', () => {
  it('rejects callers whose issuer is not allow-listed', () => {
    const w = setup();
    const mallory = jwtAuth('m', 9n, 'https://evil.example');
    expect(() => w.call(mallory, ctx => mod.register_account(ctx, { display_name: 'M' }))).toThrow(/^unauthenticated:/);
  });
  it('non-owner cannot edit the issuer allow-list', () => {
    const w = setup();
    expect(() => w.call(w.alice, ctx => mod.set_auth_issuer(ctx, { issuer: 'x', enabled: true }))).toThrow(/^unauthorized:/);
  });
  it('requires an account before using reducers', () => {
    const w = setup();
    const dave = jwtAuth('dave', 8n);
    expect(() => w.call(dave, ctx => mod.create_pair_invite(ctx, {}))).toThrow(/^unauthorized:/);
  });
});

describe('pairing', () => {
  it('two users pair via invite/accept', () => {
    const w = setup();
    const { pairId } = pairUp(w);
    for (const u of [w.alice, w.bob]) {
      const pairs = view<any>(w, u, mod.my_pairs);
      expect(pairs).toHaveLength(1);
      expect(pairs[0].pair_id).toBe(pairId);
      expect(pairs[0].status).toBe('accepted');
      expect(pairs[0].counterpart_identity).toBeDefined();
      expect(pairs[0].counterpart_display_name).toBeTypeOf('string');
    }
    // invite is single-use: it disappears from the creator's view once accepted
    expect(view(w, w.alice, mod.my_invites)).toHaveLength(0);
  });
  it('third user cannot accept a used invite nor see the pair', () => {
    const w = setup();
    const { token } = pairUp(w);
    expect(() => w.call(w.carol, ctx => mod.accept_pair_invite(ctx, { invite_token: token }))).toThrow(/^invalid:/);
    expect(view(w, w.carol, mod.my_pairs)).toHaveLength(0);
    expect(view(w, w.carol, mod.my_invites)).toHaveLength(0);
  });
  it('third user cannot accept before bob either leak invite via views', () => {
    const w = setup();
    w.call(w.alice, ctx => mod.create_pair_invite(ctx, {}));
    expect(view(w, w.carol, mod.my_invites)).toHaveLength(0);
    expect(view(w, w.bob, mod.my_pairs)).toHaveLength(0);
  });
  it('rejects self-accept', () => {
    const w = setup();
    w.call(w.alice, ctx => mod.create_pair_invite(ctx, {}));
    const [inv] = view<any>(w, w.alice, mod.my_invites);
    expect(() => w.call(w.alice, ctx => mod.accept_pair_invite(ctx, { invite_token: inv.invite_token }))).toThrow(/^invalid: cannot accept your own/);
  });
  it('rejects expired invites', () => {
    const w = setup();
    w.call(w.alice, ctx => mod.create_pair_invite(ctx, {}));
    const [inv] = view<any>(w, w.alice, mod.my_invites);
    w.h.clock.set(new Timestamp(inv.expires_at.microsSinceUnixEpoch + 1n));
    expect(() => w.call(w.bob, ctx => mod.accept_pair_invite(ctx, { invite_token: inv.invite_token }))).toThrow(/^invalid: invite expired/);
  });
  it('unknown token is not_found', () => {
    const w = setup();
    expect(() => w.call(w.bob, ctx => mod.accept_pair_invite(ctx, { invite_token: 'nope' }))).toThrow(/^not_found:/);
  });
});

describe('presets', () => {
  const set = (w: ReturnType<typeof setup>, cats: string[], v: number, exp = FUTURE) =>
    w.call(w.alice, ctx => mod.set_relationship_preset(ctx, { preset_kind: 'partner', allowed_categories: cats, expected_version: v, expires_at: exp }));

  it('creates, then rejects stale versions, duplicates and unknown categories', () => {
    const w = setup();
    set(w, ['support_preference'], 0);
    expect(() => set(w, ['support_preference'], 0)).toThrow(/^stale:/);
    expect(() => set(w, ['support_preference', 'support_preference'], 1)).toThrow(/^invalid: duplicate/);
    expect(() => set(w, ['journal_text'], 1)).toThrow(/^invalid: unknown category/);
    set(w, ['support_preference', 'coarse_availability'], 1);
    expect(view<any>(w, w.alice, mod.my_presets)[0].version).toBe(2);
  });
  it('presets are never visible to other users', () => {
    const w = setup();
    pairUp(w);
    set(w, ['support_preference'], 0);
    expect(view(w, w.bob, mod.my_presets)).toHaveLength(0);
    expect(view(w, w.bob, mod.my_preset_assignments)).toHaveLength(0);
  });
  it('assignment requires accepted pair + optimistic version; reassignment bumps version', () => {
    const w = setup();
    const { pairId } = pairUp(w);
    set(w, ['support_preference'], 0);
    w.call(w.alice, ctx => mod.assign_relationship_preset(ctx, { pair_id: pairId, preset_kind: 'partner', expected_assignment_version: 0 }));
    expect(() => w.call(w.alice, ctx => mod.assign_relationship_preset(ctx, { pair_id: pairId, preset_kind: 'partner', expected_assignment_version: 0 }))).toThrow(/^stale:/);
    w.call(w.alice, ctx => mod.assign_relationship_preset(ctx, { pair_id: pairId, preset_kind: 'partner', expected_assignment_version: 1 }));
    expect(view<any>(w, w.alice, mod.my_preset_assignments)[0].assignment_version).toBe(2);
    expect(() => w.call(w.carol, ctx => mod.assign_relationship_preset(ctx, { pair_id: pairId, preset_kind: 'partner', expected_assignment_version: 0 }))).toThrow(/^not_found:/);
  });
});

function seedNudge(w: ReturnType<typeof setup>, pairId: string) {
  const bobId = view<any>(w, w.alice, mod.my_pairs)[0].counterpart_identity;
  const aliceId = view<any>(w, w.bob, mod.my_pairs)[0].counterpart_identity;
  const ts = new Timestamp(w.h.clock.now().microsSinceUnixEpoch + 1_000_000_000n);
  w.h.withReducerTx(w.admin, ctx => {
    ctx.db.approved_signal.insert({
      signal_id: 's1', pair_id: pairId, sender_id: aliceId, recipient_id: bobId, purpose: 'support_nudge',
      support_mode: 'short_call', availability: undefined, consent_version: 1, recipient_policy_id: 'p',
      recipient_policy_version: 1, preset_assignment_version: 1, expires_at: ts, revoked_at: undefined,
    });
    ctx.db.nudge.insert({
      id: 'n1', pair_id: pairId, recipient_id: bobId, source_signal_ids: ['s1'], source_consent_versions: [1],
      template_id: 'offer_short_call', created_at: ctx.timestamp, expires_at: ts, dismissed: false,
      snoozed_until: undefined, suppressed: false,
    });
  });
}

describe('nudges and unlink', () => {
  it('only the recipient can dismiss or snooze', () => {
    const w = setup();
    const { pairId } = pairUp(w);
    seedNudge(w, pairId);
    expect(() => w.call(w.alice, ctx => mod.dismiss_nudge(ctx, { nudge_id: 'n1' }))).toThrow(/^not_found:/);
    expect(() => w.call(w.carol, ctx => mod.snooze_nudge(ctx, { nudge_id: 'n1', until: FUTURE }))).toThrow(/^not_found:/);
    expect(view(w, w.alice, mod.my_nudges)).toHaveLength(0);
    expect(view(w, w.bob, mod.my_nudges)).toHaveLength(1);
    w.call(w.bob, ctx => mod.dismiss_nudge(ctx, { nudge_id: 'n1' }));
    expect(view(w, w.bob, mod.my_nudges)).toHaveLength(0);
  });
  it('unlink suppresses nudges, marks receipts suppressed and drops assignments', () => {
    const w = setup();
    const { pairId } = pairUp(w);
    w.call(w.alice, ctx => mod.set_relationship_preset(ctx, { preset_kind: 'partner', allowed_categories: ['support_preference'], expected_version: 0, expires_at: FUTURE }));
    w.call(w.alice, ctx => mod.assign_relationship_preset(ctx, { pair_id: pairId, preset_kind: 'partner', expected_assignment_version: 0 }));
    seedNudge(w, pairId);
    w.call(w.bob, ctx => mod.unlink_pair(ctx, { pair_id: pairId }));
    expect(view(w, w.bob, mod.my_nudges)).toHaveLength(0);
    expect(view(w, w.alice, mod.my_preset_assignments)).toHaveLength(0);
    for (const u of [w.alice, w.bob]) {
      const r = view<any>(w, u, mod.my_receipts);
      expect(r.map(x => x.action)).toEqual(['suppressed']);
    }
    expect(view<any>(w, w.alice, mod.my_pairs)[0].status).toBe('unlinked');
    expect(() => w.call(w.carol, ctx => mod.unlink_pair(ctx, { pair_id: pairId }))).toThrow(/^not_found:/);
  });
  it('tightening a preset suppresses assigned work and bumps version', () => {
    const w = setup();
    const { pairId } = pairUp(w);
    w.call(w.alice, ctx => mod.set_relationship_preset(ctx, { preset_kind: 'partner', allowed_categories: ['support_preference', 'coarse_availability'], expected_version: 0, expires_at: FUTURE }));
    w.call(w.alice, ctx => mod.assign_relationship_preset(ctx, { pair_id: pairId, preset_kind: 'partner', expected_assignment_version: 0 }));
    seedNudge(w, pairId);
    w.call(w.alice, ctx => mod.set_relationship_preset(ctx, { preset_kind: 'partner', allowed_categories: ['coarse_availability'], expected_version: 1, expires_at: FUTURE }));
    expect(view(w, w.bob, mod.my_nudges)).toHaveLength(0);
    expect(view<any>(w, w.alice, mod.my_presets)[0].version).toBe(2);
  });
});

describe('signals', () => {
  it('approve_signal is refused until the policy guard exists', () => {
    const w = setup();
    const { pairId } = pairUp(w);
    expect(() => w.call(w.alice, ctx => mod.approve_signal(ctx, {
      pair_id: pairId, support_mode: 'short_call', availability: undefined, payload_revision: 1,
      recipient_policy_version: 1, preset_assignment_version: 1, consent_version: 1, client_request_id: 'r1',
    }))).toThrow('unavailable: policy guard pending (Cyber)');
    expect(w.h.withReducerTx(w.admin, ctx => [...ctx.db.approved_signal.iter()].length)).toBe(0);
  });
});
