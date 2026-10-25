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

describe('F5 recipient gate (accepted-pair default on with recipient opt-out; D018 quiet hours/cooldown)', () => {
  it('an accepted pair uses the standard default; the sender cannot change the recipient setting', () => {
    const { w, pairId, worker } = world();
    const sig = approve(w, BOTH);
    commit(w, worker, commitArgs(pairId, sig));
    expect(nudges(w)).toHaveLength(1);
    optIn(w, w.alice, pairId, false); // alice may only opt herself out; bob's accepted-pair default remains on
    expect(() => optIn(w, w.carol, pairId)).toThrow('not_found:');
  });

  it('an explicit recipient opt-out blocks delivery', () => {
    const { w, pairId, worker } = world();
    optIn(w, w.bob, pairId, false);
    const sig = approve(w, BOTH);
    expect(() => commit(w, worker, commitArgs(pairId, sig))).toThrow('unauthorized: not_opted_in');
    expect(nudges(w)).toHaveLength(0);
  });

  it('opted-in recipient gets the nudge; the "used" outcome is recorded privately but never shown to the sender', () => {
    const { w, pairId, worker } = world();
    optIn(w, w.bob, pairId);
    const sig = approve(w, BOTH);
    commit(w, worker, commitArgs(pairId, sig));
    const [n] = view<any>(w, w.bob, mod.my_nudges);
    expect(n.template_id).toBe('offer_short_call');
    expect(Object.keys(n).sort()).toEqual(['hook', 'id', 'pair_id', 'template_id', 'visible_until']); // audit item 2
    expect(view<any>(w, w.alice, mod.my_receipts).map(r => [r.action, r.categories]))
      .toEqual([['approved', ['support_preference', 'coarse_availability']]]); // audit item 3: no 'used'
    const table = w.h.withReducerTx(w.admin, ctx => [...ctx.db.disclosure_receipt.iter()].map(r => r.action));
    expect(table).toContain('used'); // the audit trail still exists privately
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

  it('no per-pair cooldown: back-to-back nudges for the same pair are both delivered (D059)', () => {
    const { w, pairId, worker } = world();
    optIn(w, w.bob, pairId);
    commit(w, worker, commitArgs(pairId, approve(w, BOTH, 'a')));
    commit(w, worker, commitArgs(pairId, approve(w, BOTH, 'b')));
    expect(view(w, w.bob, mod.my_nudges)).toHaveLength(2);
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

  it('preset edits after approval: broadening or equal reassignment keeps the nudge; removing every category stops it', () => {
    for (const change of ['broaden', 'reassign'] as const) {
      const { w, pairId, worker } = world(['support_preference']);
      optIn(w, w.bob, pairId);
      const sig = approve(w, { support_mode: 'short_call' });
      if (change === 'broaden') w.call(w.alice, ctx => mod.set_relationship_preset(ctx, { preset_kind: 'partner', allowed_categories: ['support_preference', 'coarse_availability'], expected_version: 1, expires_at: FUTURE }));
      if (change === 'reassign') confirmPreset(w, w.alice, pairId, 'family', ['support_preference']);
      commit(w, worker, commitArgs(pairId, sig));
      expect(nudges(w), change).toHaveLength(1);
    }
    const { w, pairId, worker } = world(['support_preference']);
    optIn(w, w.bob, pairId);
    const sig = approve(w, { support_mode: 'short_call' });
    w.call(w.alice, ctx => mod.set_relationship_preset(ctx, { preset_kind: 'partner', allowed_categories: [], expected_version: 1, expires_at: FUTURE }));
    expect(() => commit(w, worker, commitArgs(pairId, sig))).toThrow(/^stale: revoked|^unauthorized: blocked_category/);
    expect(nudges(w)).toHaveLength(0);
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
    expect(nudges(w)).toHaveLength(0);
  });

  it('any known template commits, including from an availability-only approval; free text is refused', () => {
    const { w, pairId, worker } = world();
    optIn(w, w.bob, pairId);
    const availOnly = approve(w, { availability: 'this_week' }, 'avail');
    commit(w, worker, commitArgs(pairId, availOnly, { nudge_id: 'n-avail', template_id: 'offer_note' }));
    expect(nudges(w)).toHaveLength(1);
    const call = approve(w, { support_mode: 'short_call' }, 'call');
    expect(() => commit(w, worker, commitArgs(pairId, call, { template_id: 'Call them now, they are sad' }))).toThrow('invalid: invalid_schema');
  });
});

describe('D059 reasoning-timed nudges: approve_signal_delayed holds delivery on the server', () => {
  const approveDelayed = (w: W, minutes: number, req = 'late-1') => {
    const pairId = view<any>(w, w.alice, mod.my_pairs)[0].pair_id;
    const args = { ...approveArgs(w, w.alice, pairId, BOTH, req), delay_minutes: minutes };
    w.call(w.alice, ctx => mod.approve_signal_delayed(ctx, args));
    return allSignals(w).find((s: any) => s.client_request_id === req)!;
  };

  it('the worker sees the due time; commit before it is refused, after it succeeds', () => {
    const { w, pairId, worker } = world();
    optIn(w, w.bob, pairId);
    const sig = approveDelayed(w, 180);
    const row = view<any>(w, worker, mod.worker_signal_context).find(r => r.signal_id === sig.signal_id);
    const dueUs = row.deliver_after.microsSinceUnixEpoch - w.h.clock.now().microsSinceUnixEpoch;
    expect(dueUs).toBe(180n * 60_000_000n);
    expect(() => commit(w, worker, commitArgs(pairId, sig))).toThrow('stale: not_due');
    expect(view(w, w.bob, mod.my_nudges)).toHaveLength(0);
    w.h.clock.set(new Timestamp(w.h.clock.now().microsSinceUnixEpoch + 3n * HOUR_US));
    commit(w, worker, commitArgs(pairId, sig));
    expect(view(w, w.bob, mod.my_nudges)).toHaveLength(1);
  });

  it('an immediate approval has no due time; delays outside 1–720 minutes are refused; replays keep the first time', () => {
    const { w, pairId, worker } = world();
    const now = approve(w, BOTH, 'now-1');
    expect(view<any>(w, worker, mod.worker_signal_context).find(r => r.signal_id === now.signal_id).deliver_after).toBeUndefined();
    expect(() => approveDelayed(w, 0, 'bad-0')).toThrow('invalid: delay_minutes');
    expect(() => approveDelayed(w, 721, 'bad-1')).toThrow('invalid: delay_minutes');
    const sig = approveDelayed(w, 120, 'late-2');
    const first = view<any>(w, worker, mod.worker_signal_context).find(r => r.signal_id === sig.signal_id).deliver_after;
    approveDelayed(w, 600, 'late-2'); // same request replayed with another delay: no new signal, time unchanged
    expect(view<any>(w, worker, mod.worker_signal_context).filter(r => r.signal_id === sig.signal_id)[0].deliver_after).toEqual(first);
    expect(pairId).toBeTruthy();
  });
});

