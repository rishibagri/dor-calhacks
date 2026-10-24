// F5/F7 authoritative enforcement (FLOWS.md, D017/D018/D020): direct calls to commit_nudge and
// set_nudge_delivery, as a compromised worker or client could make them. Synthetic identities only.
import { describe, expect, it } from 'vitest';
import { Timestamp } from 'spacetimedb';
import { allSignals, approveArgs, confirmPreset, FUTURE, grantPrefs, jwtAuth, mod, pairUp, setup, view } from './helpers';

const HOUR_US = 3_600_000_000n;
type W = ReturnType<typeof setup>;
const BOTH = { support_mode: 'short_call', availability: 'this_week' };

/** Recipient consent the "coordinator" read for the current world; commitArgs binds it by default. */
let bound = { recipient_consent_id: '', recipient_consent_version: 0 };

/** alice→bob pair, alice partner preset (both categories) assigned, bob's preference consent, worker allow-listed. */
function world(cats = ['support_preference', 'coarse_availability']) {
  const w = setup();
  const { pairId } = pairUp(w);
  confirmPreset(w, w.alice, pairId, 'partner', cats);
  const pref = grantPrefs(w, w.bob, pairId);
  bound = { recipient_consent_id: pref.consent_id, recipient_consent_version: pref.consent_version };
  const worker = jwtAuth('dor-worker', 50n, 'https://worker.spacetimedb.example');
  const workerId = w.h.withReducerTx(worker, ctx => ctx.sender);
  w.h.withReducerTx(w.admin, ctx => mod.set_worker_identity(ctx, { worker: workerId, enabled: true }));
  return { w, pairId, worker };
}
const approve = (w: W, payload: Record<string, string>, req = 'r1') => {
  const pairId = view<any>(w, w.alice, mod.my_pairs)[0].pair_id;
  const args = approveArgs(w, w.alice, pairId, payload, req);
  w.call(w.alice, ctx => mod.approve_signal(ctx, args));
  return allSignals(w).find(s => s.client_request_id === req)!;
};
const optIn = (w: W, who: W['bob'], pairId: string, opted = true, quiet: [number, number] | null = null, offset = 0) =>
  w.call(who, ctx => mod.set_nudge_delivery(ctx, {
    pair_id: pairId, opted_in: opted, quiet_start_minute: quiet?.[0], quiet_end_minute: quiet?.[1], utc_offset_minutes: offset,
  }));
const commitArgs = (pairId: string, sig: any, over: Record<string, unknown> = {}) => ({
  nudge_id: 'n-' + sig.signal_id, pair_id: pairId, template_id: 'offer_short_call',
  source_signal_ids: [sig.signal_id], source_consent_versions: [sig.consent_version], ...bound, ...over,
}) as Parameters<typeof mod.commit_nudge>[1];
const commit = (w: W, who: any, args: Parameters<typeof mod.commit_nudge>[1]) => w.call(who, ctx => mod.commit_nudge(ctx, args));
const nudges = (w: W) => w.h.withReducerTx(w.admin, ctx => [...ctx.db.nudge.iter()]);

describe('worker identity boundary', () => {
  it('only an allow-listed worker can commit; users and unlisted workers cannot', () => {
    const { w, pairId } = world();
    optIn(w, w.bob, pairId);
    const sig = approve(w, BOTH);
    const rogue = jwtAuth('rogue-worker', 51n, 'https://worker.spacetimedb.example');
    for (const who of [w.alice, w.bob, w.carol, rogue]) {
      expect(() => commit(w, who, commitArgs(pairId, sig))).toThrow('unauthorized: worker only');
    }
    expect(nudges(w)).toHaveLength(0);
  });

  it('the worker cannot become a user, approve, or edit the allow-list', () => {
    const { w, pairId, worker } = world();
    expect(() => w.call(worker, ctx => mod.register_account(ctx, { display_name: 'W' }))).toThrow(/^unauthenticated:|^unauthorized:/);
    const args = approveArgs(w, w.alice, pairId, BOTH); // views: outside the tx
    expect(() => w.call(worker, ctx => mod.approve_signal(ctx, args))).toThrow(/^unauthenticated:|^unauthorized:/);
    const aliceId = w.h.withReducerTx(w.alice, ctx => ctx.sender);
    expect(() => w.call(worker, ctx => mod.set_worker_identity(ctx, { worker: aliceId, enabled: true }))).toThrow('unauthorized: module owner only');
    // and the owner cannot turn a user account into a worker
    expect(() => w.h.withReducerTx(w.admin, ctx => mod.set_worker_identity(ctx, { worker: aliceId, enabled: true }))).toThrow('invalid:');
  });

  it('worker views are empty for everyone but the worker, and list only signals with standing', () => {
    const { w, pairId, worker } = world();
    optIn(w, w.bob, pairId);
    const sig = approve(w, BOTH);
    for (const u of [w.alice, w.bob, w.carol]) {
      expect(view(w, u, mod.worker_signal_context)).toHaveLength(0);
      expect(view(w, u, mod.worker_delivery)).toHaveLength(0);
    }
    const ctxRows = view<any>(w, worker, mod.worker_signal_context);
    expect(ctxRows.map(r => r.signal_id)).toEqual([sig.signal_id]);
    expect(Object.keys(ctxRows[0])).not.toContain('client_request_id');
    expect(view(w, worker, mod.worker_delivery)).toHaveLength(1);
    w.call(w.alice, ctx => mod.revoke_signal(ctx, { signal_id: sig.signal_id }));
    expect(view(w, worker, mod.worker_signal_context)).toHaveLength(0);
  });
});

describe('F5 recipient gate (D017 opt-in default off, D018 quiet hours/cooldown)', () => {
  it('no nudge until the recipient opts in; the sender cannot opt the recipient in', () => {
    const { w, pairId, worker } = world();
    const sig = approve(w, BOTH);
    expect(() => commit(w, worker, commitArgs(pairId, sig))).toThrow('unauthorized: not_opted_in');
    optIn(w, w.alice, pairId); // alice opts HERSELF in as a recipient; bob is still off
    expect(() => commit(w, worker, commitArgs(pairId, sig))).toThrow('unauthorized: not_opted_in');
    expect(() => optIn(w, w.carol, pairId)).toThrow('not_found:');
    expect(view(w, w.bob, mod.my_nudge_delivery)).toHaveLength(0);
    expect(nudges(w)).toHaveLength(0);
  });

  it('opted-in recipient gets the nudge; sender gets a sender-only "used" receipt', () => {
    const { w, pairId, worker } = world();
    optIn(w, w.bob, pairId);
    const sig = approve(w, BOTH);
    commit(w, worker, commitArgs(pairId, sig));
    const [n] = view<any>(w, w.bob, mod.my_nudges);
    expect(n.template_id).toBe('offer_short_call');
    expect(n.expires_at.microsSinceUnixEpoch).toBeLessThanOrEqual(sig.expires_at.microsSinceUnixEpoch);
    expect(view<any>(w, w.alice, mod.my_receipts).map(r => [r.action, r.categories]))
      .toEqual([['approved', ['support_preference', 'coarse_availability']], ['used', ['support_preference', 'coarse_availability']]]);
    expect(view(w, w.bob, mod.my_receipts)).toHaveLength(0);
    expect(view(w, w.alice, mod.my_nudges)).toHaveLength(0);
  });

  it('quiet hours in recipient local time block commit', () => {
    const { w, pairId, worker } = world();
    const now = w.h.clock.now().toDate();
    const local = (now.getUTCHours() * 60 + now.getUTCMinutes() + 60) % 1440; // recipient at UTC+1
    optIn(w, w.bob, pairId, true, [local, (local + 30) % 1440], 60);
    const sig = approve(w, BOTH);
    expect(() => commit(w, worker, commitArgs(pairId, sig))).toThrow('rate_limited: quiet_hours');
  });

  it('at most one nudge per pair per 24h, counting suppressed/dismissed nudges', () => {
    const { w, pairId, worker } = world();
    optIn(w, w.bob, pairId);
    const s1 = approve(w, BOTH, 'a');
    commit(w, worker, commitArgs(pairId, s1));
    w.call(w.alice, ctx => mod.revoke_signal(ctx, { signal_id: s1.signal_id })); // revoke-and-retry must not reset cooldown
    const s2 = approve(w, BOTH, 'b');
    expect(() => commit(w, worker, commitArgs(pairId, s2))).toThrow('rate_limited: cooldown');
    w.h.clock.set(new Timestamp(w.h.clock.now().microsSinceUnixEpoch + 24n * HOUR_US));
    const s3 = approve(w, BOTH, 'c');
    commit(w, worker, commitArgs(pairId, s3));
    expect(view(w, w.bob, mod.my_nudges)).toHaveLength(1);
  });

  it('opting out suppresses nudges already pending for that recipient', () => {
    const { w, pairId, worker } = world();
    optIn(w, w.bob, pairId);
    commit(w, worker, commitArgs(pairId, approve(w, BOTH)));
    expect(view(w, w.bob, mod.my_nudges)).toHaveLength(1);
    optIn(w, w.bob, pairId, false);
    expect(view(w, w.bob, mod.my_nudges)).toHaveLength(0);
  });

  it('invalid delivery settings are rejected', () => {
    const { w, pairId } = world();
    expect(() => optIn(w, w.bob, pairId, true, [1440, 10])).toThrow('invalid: delivery settings');
    expect(() => optIn(w, w.bob, pairId, true, null, 15 * 60)).toThrow('invalid: delivery settings');
  });
});

describe('F7 commit: worker replay, revocation during generation, stale approvals, wrong recipients', () => {
  it('worker replay is idempotent and never resurrects a suppressed nudge', () => {
    const { w, pairId, worker } = world();
    optIn(w, w.bob, pairId);
    const sig = approve(w, BOTH);
    const args = commitArgs(pairId, sig);
    commit(w, worker, args);
    commit(w, worker, args);
    expect(nudges(w)).toHaveLength(1);
    w.call(w.alice, ctx => mod.revoke_signal(ctx, { signal_id: sig.signal_id }));
    commit(w, worker, args); // stale replay after revoke
    expect(nudges(w)).toHaveLength(1);
    expect(nudges(w)[0].suppressed).toBe(true);
    expect(view(w, w.bob, mod.my_nudges)).toHaveLength(0);
    expect(() => commit(w, worker, { ...args, template_id: 'offer_note' })).toThrow('invalid: nudge_id reused');
    expect(() => commit(w, worker, { ...args, nudge_id: 'fresh-id' })).toThrow('stale: revoked');
  });

  it('revocation during generation: context read before revoke, commit after revoke is denied', () => {
    const { w, pairId, worker } = world();
    optIn(w, w.bob, pairId);
    const sig = approve(w, BOTH);
    expect(view(w, worker, mod.worker_signal_context)).toHaveLength(1); // worker starts generating
    w.call(w.alice, ctx => mod.revoke_signal(ctx, { signal_id: sig.signal_id }));
    expect(() => commit(w, worker, commitArgs(pairId, sig))).toThrow('stale: revoked');
    expect(nudges(w)).toHaveLength(0);
  });

  it('unlink during generation denies commit', () => {
    const { w, pairId, worker } = world();
    optIn(w, w.bob, pairId);
    const sig = approve(w, BOTH);
    w.call(w.bob, ctx => mod.unlink_pair(ctx, { pair_id: pairId }));
    expect(() => commit(w, worker, commitArgs(pairId, sig))).toThrow(/^stale: revoked|^invalid: unlinked/);
    expect(nudges(w)).toHaveLength(0);
  });

  it('stale approvals: preset broadened, tightened, or reassigned after approval cannot produce a nudge', () => {
    for (const change of ['broaden', 'tighten', 'reassign'] as const) {
      const { w, pairId, worker } = world(['support_preference']);
      optIn(w, w.bob, pairId);
      const sig = approve(w, { support_mode: 'short_call' });
      if (change === 'broaden') w.call(w.alice, ctx => mod.set_relationship_preset(ctx, { preset_kind: 'partner', allowed_categories: ['support_preference', 'coarse_availability'], expected_version: 1, expires_at: FUTURE }));
      if (change === 'tighten') w.call(w.alice, ctx => mod.set_relationship_preset(ctx, { preset_kind: 'partner', allowed_categories: [], expected_version: 1, expires_at: FUTURE }));
      if (change === 'reassign') confirmPreset(w, w.alice, pairId, 'family', ['support_preference']);
      expect(() => commit(w, worker, commitArgs(pairId, sig)), change).toThrow(/^stale: (stale_policy|revoked)|^unauthorized: blocked_category/);
      expect(nudges(w), change).toHaveLength(0);
    }
  });

  it('expired approval cannot be committed', () => {
    const { w, pairId, worker } = world();
    optIn(w, w.bob, pairId);
    const sig = approve(w, BOTH);
    w.h.clock.set(new Timestamp(sig.expires_at.microsSinceUnixEpoch));
    expect(() => commit(w, worker, commitArgs(pairId, sig))).toThrow('stale: expired');
  });

  it('wrong recipient / cross-pair sources are rejected without leaking existence', () => {
    const { w, pairId, worker } = world();
    optIn(w, w.bob, pairId);
    const sig = approve(w, BOTH);
    // A second pair (carol→alice) to mix in.
    w.call(w.carol, ctx => mod.create_pair_invite(ctx, {}));
    const inv = view<any>(w, w.carol, mod.my_invites)[0];
    w.call(w.alice, ctx => mod.accept_pair_invite(ctx, { invite_token: inv.invite_token }));
    expect(() => commit(w, worker, commitArgs(inv.pair_id, sig))).toThrow('not_found: wrong_recipient');
    expect(() => commit(w, worker, commitArgs(pairId, sig, { source_signal_ids: ['ghost'], source_consent_versions: [1] }))).toThrow('unauthorized: no_consent');
    expect(() => commit(w, worker, commitArgs(pairId, sig, { source_consent_versions: [2] }))).toThrow('stale: stale_policy');
    expect(nudges(w)).toHaveLength(0);
  });

  it('availability-only approval produces no nudge (D020); template must match an approved mode', () => {
    const { w, pairId, worker } = world();
    optIn(w, w.bob, pairId);
    const availOnly = approve(w, { availability: 'this_week' }, 'avail');
    for (const tpl of ['offer_short_call', 'offer_note', 'offer_shared_activity']) {
      expect(() => commit(w, worker, commitArgs(pairId, availOnly, { nudge_id: tpl, template_id: tpl }))).toThrow('unauthorized: blocked_category');
    }
    const call = approve(w, { support_mode: 'short_call' }, 'call');
    expect(() => commit(w, worker, commitArgs(pairId, call, { template_id: 'offer_note' }))).toThrow('unauthorized: blocked_category');
    expect(() => commit(w, worker, commitArgs(pairId, call, { template_id: 'Call them now, they are sad' }))).toThrow('invalid: invalid_schema');
    expect(nudges(w)).toHaveLength(0);
  });
});
