// D041 durable recipient pause (Cyber, README Core 2): direct reducer and view calls with a third account, as a
// compromised client or worker could make them. Synthetic identities only. In-process harness: no deployed
// isolation, real JWT mapping or real scheduler.
import { describe, expect, it } from 'vitest';
import { Timestamp } from 'spacetimedb';
import { allSignals, approveArgs, confirmPreset, grantPrefs, inDays, jwtAuth, mod, pairUp, setup, sweep, view } from './helpers';

type W = ReturnType<typeof setup>;
type Who = W['alice'];
const HOUR_MS = 3_600_000;
const BOTH = { support_mode: 'short_call', availability: 'this_week' };
const advance = (w: W, ms: number) => w.h.clock.set(new Timestamp(w.h.clock.now().microsSinceUnixEpoch + BigInt(ms) * 1000n));
const json = (v: unknown) => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? String(x) : x);

/** alice ↔ bob accepted pair; alice's partner preset; bob opted in with support consent; worker allow-listed. */
function world() {
  const w = setup();
  const { pairId } = pairUp(w);
  confirmPreset(w, w.alice, pairId, 'partner', ['support_preference', 'coarse_availability']);
  const pref = grantPrefs(w, w.bob, pairId);
  w.call(w.bob, ctx => mod.set_nudge_delivery(ctx, { pair_id: pairId, opted_in: true, quiet_start_minute: undefined, quiet_end_minute: undefined, utc_offset_minutes: 0 }));
  const worker = jwtAuth('dor-worker', 50n, 'https://worker.spacetimedb.example');
  const workerId = w.h.withReducerTx(worker, ctx => ctx.sender);
  w.h.withReducerTx(w.admin, ctx => mod.set_worker_identity(ctx, { worker: workerId, enabled: true }));
  const bound = { recipient_consent_id: pref.consent_id as string, recipient_consent_version: pref.consent_version as number };
  return { w, pairId, worker, bound };
}
type World = ReturnType<typeof world>;

function approve(w: W, pairId: string, req = 'req-a1') {
  const args = approveArgs(w, w.alice, pairId, BOTH, req);
  w.call(w.alice, ctx => mod.approve_signal(ctx, args));
  return allSignals(w).find(s => s.client_request_id === req)!;
}
const commitArgs = (x: World, sig: { signal_id: string; consent_version: number }, id = 'n-' + sig.signal_id) => ({
  nudge_id: id, pair_id: x.pairId, template_id: 'offer_short_call', source_signal_ids: [sig.signal_id],
  source_consent_versions: [sig.consent_version], ...x.bound,
}) as Parameters<typeof mod.commit_nudge>[1];
const commit = (x: World, args: ReturnType<typeof commitArgs>) => x.w.call(x.worker, ctx => mod.commit_nudge(ctx, args));
const pauseVersion = (w: W, who: Who, pairId: string) =>
  (view<any>(w, who, mod.my_recipient_pauses).find(p => p.pair_id === pairId)?.version ?? 0) as number;
function pause(w: W, who: Who, pairId: string, hours = 12) {
  const expected_version = pauseVersion(w, who, pairId);
  w.call(who, ctx => mod.pause_recipient(ctx, { pair_id: pairId, expires_at: inDays(w, hours / 24), expected_version }));
}
function resume(w: W, who: Who, pairId: string) {
  const expected_version = pauseVersion(w, who, pairId);
  w.call(who, ctx => mod.resume_recipient(ctx, { pair_id: pairId, expected_version }));
}
const myPauses = (w: W, who: Who) => view<any>(w, who, mod.my_recipient_pauses);
const bobNudges = (w: W) => view<any>(w, w.bob, mod.my_nudges);
const workerSignals = (x: World) => view<any>(x.w, x.worker, mod.worker_signal_context);

describe('owner-only, explicit, reason-free', () => {
  it('only a member can pause the other member; a third account gets not_found like any other pair', () => {
    const { w, pairId } = world();
    expect(() => w.call(w.carol, ctx => mod.pause_recipient(ctx, { pair_id: pairId, expires_at: inDays(w, 0.5), expected_version: 0 }))).toThrow('not_found: pair');
    expect(() => w.call(w.carol, ctx => mod.resume_recipient(ctx, { pair_id: pairId, expected_version: 0 }))).toThrow('not_found: pause');
    pause(w, w.alice, pairId);
    expect(myPauses(w, w.alice)).toHaveLength(1);
    expect(() => w.call(w.carol, ctx => mod.resume_recipient(ctx, { pair_id: pairId, expected_version: 1 }))).toThrow('not_found: pause');
  });

  it('stores only pair, target, times and version; the owner view shows who (pair) and until when', () => {
    const { w, pairId } = world();
    pause(w, w.alice, pairId);
    const rows = w.h.withReducerTx(w.admin, ctx => [...ctx.db.recipient_pause.iter()]);
    expect(Object.keys(rows[0]!).sort()).toEqual(['created_at', 'expires_at', 'owner', 'pair_id', 'pause_id', 'resumed_at', 'target', 'updated_at', 'version']);
    const [mine] = myPauses(w, w.alice);
    expect(Object.keys(mine).sort()).toEqual(['active', 'created_at', 'expires_at', 'pair_id', 'version']);
    expect(mine).toMatchObject({ pair_id: pairId, active: true, version: 1 });
  });

  it('duration is bounded: 15 minutes to 30 days, a real timestamp, accepted pairs only; versions are optimistic', () => {
    const { w, pairId } = world();
    const set = (expires_at: string, expected_version = 0) => () => w.call(w.alice, ctx => mod.pause_recipient(ctx, { pair_id: pairId, expires_at, expected_version }));
    expect(set(inDays(w, 31))).toThrow('invalid: too_long');
    expect(set(inDays(w, 0.005))).toThrow('invalid: too_short');
    expect(set('soon')).toThrow('invalid: invalid_schema');
    set(inDays(w, 30))();
    expect(set(inDays(w, 1), 0)).toThrow('stale: pause version changed');
    w.call(w.carol, ctx => mod.create_pair_invite(ctx, {}));
    const pending = view<any>(w, w.carol, mod.my_pairs)[0].pair_id;
    expect(() => w.call(w.carol, ctx => mod.pause_recipient(ctx, { pair_id: pending, expires_at: inDays(w, 1), expected_version: 0 }))).toThrow('invalid: pair_not_accepted');
  });
});

describe('blocks at every point', () => {
  it('approval: refused while paused, including a replay of an earlier request id', () => {
    const { w, pairId } = world();
    pause(w, w.alice, pairId);
    const args = approveArgs(w, w.alice, pairId, BOTH, 'req-paused');
    expect(() => w.call(w.alice, ctx => mod.approve_signal(ctx, args))).toThrow('unauthorized: recipient_paused');
    expect(allSignals(w)).toHaveLength(0);
  });

  it('worker read: a paused pair\'s signals are not presented to the worker', () => {
    const x = world();
    approve(x.w, x.pairId);
    expect(workerSignals(x)).toHaveLength(1);
    pause(x.w, x.w.alice, x.pairId);
    expect(workerSignals(x)).toHaveLength(0);
  });

  it('commit: a pause between approval and worker commit means no nudge, refused exactly like a revocation', () => {
    const x = world();
    const sig = approve(x.w, x.pairId);
    const args = commitArgs(x, sig); // what the worker read before generation
    pause(x.w, x.w.alice, x.pairId);
    expect(() => commit(x, args)).toThrow('stale: revoked');
    expect(bobNudges(x.w)).toHaveLength(0);
  });

  it('visibility: a nudge already committed disappears from my_nudges once the sender pauses', () => {
    const x = world();
    const sig = approve(x.w, x.pairId);
    commit(x, commitArgs(x, sig));
    expect(bobNudges(x.w)).toHaveLength(1);
    pause(x.w, x.w.alice, x.pairId);
    expect(bobNudges(x.w)).toHaveLength(0);
  });
});

describe('defence in depth: each check holds even if a future writer forgets the revocation', () => {
  /** A pause row written directly, without invalidateOwnerWork, as a buggy reducer might. */
  function rawPause(x: World) {
    x.w.h.withReducerTx(x.w.admin, ctx => {
      const p = ctx.db.pair.pair_id.find(x.pairId)!;
      ctx.db.recipient_pause.insert({ pause_id: 'raw-pause-1', owner: p.member_a, pair_id: x.pairId, target: p.member_b!, version: 1,
        expires_at: new Timestamp(ctx.timestamp.microsSinceUnixEpoch + 3_600_000_000n), resumed_at: undefined, created_at: ctx.timestamp,
        updated_at: ctx.timestamp });
    });
  }

  it('worker read and my_nudges each hide on the pause alone', () => {
    const x = world();
    commit(x, commitArgs(x, approve(x.w, x.pairId)));
    rawPause(x);
    expect(allSignals(x.w).filter(s => !s.revoked_at)).toHaveLength(1); // nothing was revoked
    expect(workerSignals(x)).toHaveLength(0);
    expect(bobNudges(x.w)).toHaveLength(0);
  });

  it('commit refuses a non-revoked source while the pause is in force', () => {
    const x = world();
    const sig = approve(x.w, x.pairId);
    rawPause(x);
    expect(() => commit(x, commitArgs(x, sig))).toThrow('stale: revoked');
  });

  it('an unknown pair id is not_found, never a crash or a hint', () => {
    const { w } = world();
    expect(() => w.call(w.alice, ctx => mod.pause_recipient(ctx, { pair_id: 'no-such-pair', expires_at: inDays(w, 0.5), expected_version: 0 }))).toThrow('not_found: pair');
  });
});

describe('no resurrection', () => {
  it('resume revives nothing: old signals stay revoked, an old commit and an old nudge id stay dead', () => {
    const x = world();
    const sig = approve(x.w, x.pairId);
    const args = commitArgs(x, sig);
    pause(x.w, x.w.alice, x.pairId);
    resume(x.w, x.w.alice, x.pairId);
    expect(myPauses(x.w, x.w.alice)[0].active).toBe(false);
    expect(allSignals(x.w).find(s => s.signal_id === sig.signal_id)!.revoked_at).toBeDefined();
    expect(workerSignals(x)).toHaveLength(0);
    expect(() => commit(x, args)).toThrow('stale: revoked');
    const replay = approveArgs(x.w, x.w.alice, x.pairId, BOTH, 'req-a1'); // the original request id
    x.w.call(x.w.alice, ctx => mod.approve_signal(ctx, replay)); // idempotent no-op, never a revival
    expect(allSignals(x.w).filter(s => !s.revoked_at)).toHaveLength(0);
  });

  it('a nudge committed before the pause stays hidden after resume', () => {
    const x = world();
    commit(x, commitArgs(x, approve(x.w, x.pairId)));
    pause(x.w, x.w.alice, x.pairId);
    resume(x.w, x.w.alice, x.pairId);
    expect(bobNudges(x.w)).toHaveLength(0);
  });

  it('expiry via the sweep: the pause lapses, nothing comes back, and only a fresh approval works', () => {
    const x = world();
    const sig = approve(x.w, x.pairId);
    pause(x.w, x.w.alice, x.pairId, 1);
    advance(x.w, HOUR_MS + 1);
    expect(myPauses(x.w, x.w.alice)[0].active).toBe(true); // clockless view: fail closed until the sweep
    sweep(x.w);
    expect(myPauses(x.w, x.w.alice)[0].active).toBe(false);
    expect(() => commit(x, commitArgs(x, sig))).toThrow('stale: revoked');
    const fresh = approve(x.w, x.pairId, 'req-a2'); // a new, explicit approval after the pause
    commit(x, commitArgs(x, fresh));
    expect(bobNudges(x.w)).toHaveLength(1);
  });

  it('the reducer clock ends a lapsed pause even before the sweep runs, for new approvals only', () => {
    const x = world();
    pause(x.w, x.w.alice, x.pairId, 1);
    advance(x.w, HOUR_MS + 1);
    approve(x.w, x.pairId, 'req-a3');
    expect(allSignals(x.w).filter(s => !s.revoked_at)).toHaveLength(1);
  });
});

describe('silent to the counterpart and everyone else', () => {
  it('the paused person and a third account see nothing of it in any view', () => {
    const x = world();
    const before = { bob: snapshot(x.w, x.w.bob), carol: snapshot(x.w, x.w.carol) };
    pause(x.w, x.w.alice, x.pairId);
    expect(snapshot(x.w, x.w.bob)).toEqual(before.bob);
    expect(snapshot(x.w, x.w.carol)).toEqual(before.carol);
    expect(myPauses(x.w, x.w.bob)).toHaveLength(0);
    expect(myPauses(x.w, x.w.carol)).toHaveLength(0);
    expect(json(snapshot(x.w, x.w.bob))).not.toMatch(/pause/i);
  });

  it('the paused person\'s own sharing toward the owner is unaffected', () => {
    const x = world();
    confirmPreset(x.w, x.w.bob, x.pairId, 'friend', ['support_preference']);
    pause(x.w, x.w.alice, x.pairId);
    const args = approveArgs(x.w, x.w.bob, x.pairId, { support_mode: 'short_call' }, 'req-bob');
    x.w.call(x.w.bob, ctx => mod.approve_signal(ctx, args));
    expect(allSignals(x.w).filter(s => !s.revoked_at)).toHaveLength(1);
  });

  it('the worker cannot tell a pause from a revocation (same refusal), and no worker view carries pause data', () => {
    const x = world();
    const a = approve(x.w, x.pairId, 'req-r1');
    const argsRevoked = commitArgs(x, a);
    x.w.call(x.w.alice, ctx => mod.revoke_signal(ctx, { signal_id: a.signal_id }));
    let revokedError = '';
    try { commit(x, argsRevoked); } catch (e) { revokedError = (e as Error).message; }
    const y = world();
    const b = approve(y.w, y.pairId, 'req-p1');
    const argsPaused = commitArgs(y, b);
    pause(y.w, y.w.alice, y.pairId);
    let pausedError = '';
    try { commit(y, argsPaused); } catch (e) { pausedError = (e as Error).message; }
    expect(pausedError).toBe(revokedError);
    for (const v of [mod.worker_signal_context, mod.worker_delivery, mod.worker_support_preferences]) {
      expect(json(view(y.w, y.worker, v))).not.toMatch(/pause/i);
    }
  });
});

function snapshot(w: W, who: Who) {
  return [mod.my_pairs, mod.my_nudges, mod.my_signals, mod.my_receipts, mod.my_presets, mod.my_preset_assignments,
    mod.my_support_preferences, mod.my_nudge_delivery, mod.my_invites].map(v => view(w, who, v));
}

describe('interaction with block and unlink', () => {
  it('unlink ends everything; a new pairing is a new relationship the old pause never touches', () => {
    const x = world();
    pause(x.w, x.w.alice, x.pairId);
    x.w.call(x.w.alice, ctx => mod.unlink_pair(ctx, { pair_id: x.pairId }));
    w2Pair(x);
  });

  it('a discovery block and a pause are independent: neither lifts nor implies the other', () => {
    const x = world();
    pause(x.w, x.w.alice, x.pairId);
    for (const [k, v] of [['tags', ['hiking']], ['areas', ['berkeley-campus']], ['enabled', ['true']]] as const) {
      x.w.h.withReducerTx(x.w.admin, ctx => mod.set_discovery_config(ctx, { key: k, values: [...v] }));
    }
    for (const who of [x.w.alice, x.w.bob]) {
      x.w.call(who, ctx => mod.publish_discovery_profile(ctx, { display_name: 'Synthetic', interest_tags: ['hiking'], audience: 'area_discoverers', notice_version: 1, expires_at: inDays(x.w, 3), expected_revision: 0 }));
      x.w.call(who, ctx => mod.set_discovery_area(ctx, { area_key: 'berkeley-campus' }));
    }
    const bobRef = view<any>(x.w, x.w.bob, mod.my_discovery_profile)[0].publication_id;
    x.w.call(x.w.alice, ctx => mod.block_discovery_user(ctx, { card_ref: bobRef }));
    resume(x.w, x.w.alice, x.pairId);
    expect(myPauses(x.w, x.w.alice)[0].active).toBe(false);
    expect(view(x.w, x.w.alice, mod.discovery_cards)).toHaveLength(0); // block still holds
    const args = approveArgs(x.w, x.w.alice, x.pairId, BOTH, 'req-after');
    x.w.call(x.w.alice, ctx => mod.approve_signal(ctx, args)); // pause ended; pair sharing works with fresh approval
    expect(allSignals(x.w).filter(s => !s.revoked_at)).toHaveLength(1);
  });
});

function w2Pair(x: World) {
  const { w } = x;
  w.call(w.alice, ctx => mod.create_pair_invite(ctx, {}));
  const invite = view<any>(w, w.alice, mod.my_invites)[0];
  w.call(w.bob, ctx => mod.accept_pair_invite(ctx, { invite_token: invite.invite_token }));
  const newPair = invite.pair_id as string;
  expect(newPair).not.toBe(x.pairId);
  confirmPreset(w, w.alice, newPair, 'partner', ['support_preference', 'coarse_availability']);
  const args = approveArgs(w, w.alice, newPair, BOTH, 'req-new-pair');
  w.call(w.alice, ctx => mod.approve_signal(ctx, args));
  expect(allSignals(w).filter(s => !s.revoked_at && s.pair_id === newPair)).toHaveLength(1);
}
