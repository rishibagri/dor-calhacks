// CYBER-R1 (D035): recipient preference consent bound into commit_nudge, JWT audience, and the scheduled
// expiry/snooze sweep. Direct reducer/view calls as a compromised client or worker could make them.
// Synthetic identities only. In-process harness: does not prove deployed isolation.
import { describe, expect, it } from 'vitest';
import { Timestamp } from 'spacetimedb';
import { allSignals, approveArgs, AUDIENCE, confirmPreset, grantPrefs, inDays, ISSUER, jwtAuth, mod, pairUp, setup, sweep, view } from './helpers';

const HOUR_US = 3_600_000_000n;
type W = ReturnType<typeof setup>;

/** alice→bob accepted pair, alice's partner preset assigned, bob opted in (no quiet hours), worker allow-listed. No preferences yet. */
function world() {
  const w = setup();
  const { pairId } = pairUp(w);
  confirmPreset(w, w.alice, pairId, 'partner', ['support_preference', 'coarse_availability']);
  w.call(w.bob, ctx => mod.set_nudge_delivery(ctx, { pair_id: pairId, opted_in: true, quiet_start_minute: undefined, quiet_end_minute: undefined, utc_offset_minutes: 0 }));
  const worker = jwtAuth('dor-worker', 50n, 'https://worker.spacetimedb.example');
  const workerId = w.h.withReducerTx(worker, ctx => ctx.sender);
  w.h.withReducerTx(w.admin, ctx => mod.set_worker_identity(ctx, { worker: workerId, enabled: true }));
  const args = approveArgs(w, w.alice, pairId, { support_mode: 'short_call', availability: 'this_week' });
  w.call(w.alice, ctx => mod.approve_signal(ctx, args));
  return { w, pairId, worker, sig: allSignals(w)[0] };
}
const commitArgs = (pairId: string, sig: any, pref: { consent_id: string; consent_version: number } | null, over: Record<string, unknown> = {}) => ({
  nudge_id: 'n-1', pair_id: pairId, template_id: 'offer_short_call', source_signal_ids: [sig.signal_id],
  source_consent_versions: [sig.consent_version], recipient_consent_id: pref?.consent_id ?? 'none',
  recipient_consent_version: pref?.consent_version ?? 1, ...over,
}) as Parameters<typeof mod.commit_nudge>[1];
const commit = (w: W, worker: any, args: Parameters<typeof mod.commit_nudge>[1]) => w.call(worker, ctx => mod.commit_nudge(ctx, args));
const nudgeRow = (w: W, id = 'n-1') => w.h.withReducerTx(w.admin, ctx => ctx.db.nudge.id.find(id));
const setPrefs = (w: W, who: any, pairId: string, over: Record<string, unknown> = {}) =>
  w.call(who, ctx => mod.set_support_preferences(ctx, {
    pair_id: pairId, support_modes: ['short_call'], availability: [], expires_at: inDays(w, 7), expected_version: 0, ...over,
  } as Parameters<typeof mod.set_support_preferences>[1]));
const advance = (w: W, us: bigint) => w.h.clock.set(new Timestamp(w.h.clock.now().microsSinceUnixEpoch + us));

describe('JWT audience (D035)', () => {
  it('a token for another audience from the same issuer cannot act, even for an existing account', () => {
    const w = setup();
    const foreign = jwtAuth('alice', 1n, ISSUER, ['some-other-app']); // same iss/sub ⇒ same Identity as alice
    expect(() => w.call(foreign, ctx => mod.register_account(ctx, { display_name: 'Mallory' }))).toThrow('unauthenticated: audience not allow-listed');
    expect(() => w.call(foreign, ctx => mod.create_pair_invite(ctx, {}))).toThrow('unauthenticated: audience not allow-listed');
    expect(() => w.call(jwtAuth('dave', 9n, ISSUER, []), ctx => mod.register_account(ctx, { display_name: 'D' }))).toThrow(/^unauthenticated:/);
  });

  it('an empty audience allowlist admits nobody (fail closed); only the owner edits it', () => {
    const w = setup();
    expect(() => w.call(w.alice, ctx => mod.set_auth_audience(ctx, { audience: 'evil', enabled: true }))).toThrow('unauthorized: module owner only');
    w.h.withReducerTx(w.admin, ctx => mod.set_auth_audience(ctx, { audience: AUDIENCE, enabled: false }));
    expect(() => w.call(w.alice, ctx => mod.create_pair_invite(ctx, {}))).toThrow('unauthenticated: audience not allow-listed');
  });
});

describe('recipient support-preference consent (D021 #4, D035)', () => {
  it('only a member of an accepted pair writes their OWN preferences; strict shape, bounded expiry, versioned', () => {
    const { w, pairId } = world();
    expect(() => setPrefs(w, w.carol, pairId)).toThrow(/^not_found:/);
    expect(() => setPrefs(w, w.bob, pairId, { support_modes: [] })).toThrow('invalid: invalid_schema');
    expect(() => setPrefs(w, w.bob, pairId, { support_modes: ['call me at 9'] })).toThrow('invalid: invalid_schema');
    expect(() => setPrefs(w, w.bob, pairId, { availability: ['tuesday 9pm at home'] })).toThrow('invalid: invalid_schema');
    expect(() => setPrefs(w, w.bob, pairId, { expires_at: inDays(w, 31) })).toThrow('invalid: expires_at too far');
    expect(() => setPrefs(w, w.bob, pairId, { expected_version: 1 })).toThrow('stale: stale_policy');
    setPrefs(w, w.bob, pairId);
    expect(() => setPrefs(w, w.bob, pairId)).toThrow('stale: stale_policy'); // concurrent edit loses
    setPrefs(w, w.bob, pairId, { expected_version: 1, support_modes: ['short_call', 'encouraging_note'] });
    expect(view<any>(w, w.bob, mod.my_support_preferences)[0].consent_version).toBe(2);
  });

  it('preferences are invisible to the sender and to other users; the worker sees only standing consents', () => {
    const { w, pairId, worker } = world();
    grantPrefs(w, w.bob, pairId);
    for (const u of [w.alice, w.carol]) {
      expect(view(w, u, mod.my_support_preferences)).toHaveLength(0);
      expect(view(w, u, mod.worker_support_preferences)).toHaveLength(0);
    }
    expect(view(w, worker, mod.worker_support_preferences)).toHaveLength(1);
    w.call(w.bob, ctx => mod.revoke_support_preferences(ctx, { pair_id: pairId }));
    expect(view(w, worker, mod.worker_support_preferences)).toHaveLength(0);
  });

  it('commit without any recipient consent is refused even though the recipient opted in to delivery', () => {
    const { w, pairId, worker, sig } = world();
    expect(() => commit(w, worker, commitArgs(pairId, sig, null))).toThrow('unauthorized: no_consent');
    expect(nudgeRow(w)).toBeFalsy();
  });

  it('commit binds the exact consent the coordinator read; the nudge records it', () => {
    const { w, pairId, worker, sig } = world();
    const pref = grantPrefs(w, w.bob, pairId);
    commit(w, worker, commitArgs(pairId, sig, pref));
    const n = nudgeRow(w)!;
    expect([n.recipient_consent_id, n.recipient_consent_version]).toEqual([pref.consent_id, pref.consent_version]);
    expect(view(w, w.bob, mod.my_nudges)).toHaveLength(1);
    expect(view(w, w.alice, mod.my_nudges)).toHaveLength(0);
  });

  it('preference revoked during generation: the commit bound to the read version fails', () => {
    const { w, pairId, worker, sig } = world();
    grantPrefs(w, w.bob, pairId);
    const read = view<any>(w, worker, mod.worker_support_preferences)[0]; // coordinator reads v1
    w.call(w.bob, ctx => mod.revoke_support_preferences(ctx, { pair_id: pairId })); // recipient revokes mid-generation
    expect(() => commit(w, worker, commitArgs(pairId, sig, read))).toThrow('stale: revoked');
    expect(nudgeRow(w)).toBeFalsy();
  });

  it('preference edited during generation, or a borrowed consent id, is stale', () => {
    const { w, pairId, worker, sig } = world();
    const v1 = grantPrefs(w, w.bob, pairId);
    grantPrefs(w, w.bob, pairId, ['short_call', 'encouraging_note']); // v2
    expect(() => commit(w, worker, commitArgs(pairId, sig, v1))).toThrow('stale: stale_policy');
    expect(() => commit(w, worker, commitArgs(pairId, sig, { consent_id: 'someone-elses', consent_version: 2 }))).toThrow('stale: stale_policy');
  });

  it('the template mode must be one the recipient accepts (no nudge outside the recipient consent)', () => {
    const { w, pairId, worker, sig } = world();
    const pref = grantPrefs(w, w.bob, pairId, ['encouraging_note']);
    expect(() => commit(w, worker, commitArgs(pairId, sig, pref))).toThrow('unauthorized: blocked_category');
  });

  it('the sender cannot record preferences for the recipient (wrong caller)', () => {
    const { w, pairId, worker, sig } = world();
    const forged = grantPrefs(w, w.alice, pairId); // alice records HER OWN consent as a recipient, not bob's
    expect(() => commit(w, worker, commitArgs(pairId, sig, forged))).toThrow('unauthorized: no_consent');
    expect(view(w, w.bob, mod.my_support_preferences)).toHaveLength(0);
  });

  it('revoke suppresses the pending nudge; a worker replay never resurrects it', () => {
    const { w, pairId, worker, sig } = world();
    const pref = grantPrefs(w, w.bob, pairId);
    commit(w, worker, commitArgs(pairId, sig, pref));
    w.call(w.bob, ctx => mod.revoke_support_preferences(ctx, { pair_id: pairId }));
    expect(view(w, w.bob, mod.my_nudges)).toHaveLength(0);
    commit(w, worker, commitArgs(pairId, sig, pref)); // identical replay is a no-op
    expect(nudgeRow(w)!.suppressed).toBe(true);
    expect(view(w, w.bob, mod.my_nudges)).toHaveLength(0);
    w.call(w.bob, ctx => mod.revoke_support_preferences(ctx, { pair_id: pairId })); // idempotent
  });

  it('replaying a nudge_id under a different consent binding is rejected, not merged', () => {
    const { w, pairId, worker, sig } = world();
    const v1 = grantPrefs(w, w.bob, pairId);
    commit(w, worker, commitArgs(pairId, sig, v1));
    const v2 = grantPrefs(w, w.bob, pairId);
    expect(() => commit(w, worker, commitArgs(pairId, sig, v2))).toThrow('invalid: nudge_id reused');
    expect(nudgeRow(w)!.recipient_consent_version).toBe(v1.consent_version);
  });

  it('narrowing preferences hides an existing nudge whose mode is no longer accepted', () => {
    const { w, pairId, worker, sig } = world();
    commit(w, worker, commitArgs(pairId, sig, grantPrefs(w, w.bob, pairId)));
    expect(view(w, w.bob, mod.my_nudges)).toHaveLength(1);
    grantPrefs(w, w.bob, pairId, ['encouraging_note']);
    expect(view(w, w.bob, mod.my_nudges)).toHaveLength(0);
  });

  it('nudge expiry is clamped to the preference consent expiry', () => {
    const { w, pairId, worker, sig } = world();
    const pref = grantPrefs(w, w.bob, pairId, undefined, undefined, 0.25); // 6h
    commit(w, worker, commitArgs(pairId, sig, pref));
    expect(nudgeRow(w)!.expires_at.microsSinceUnixEpoch).toBe(pref.expires_at.microsSinceUnixEpoch);
  });
});

describe('scheduled expiry/snooze sweep (views have no clock)', () => {
  it('only the scheduler can run the sweep', () => {
    const w = setup();
    expect(() => w.call(w.alice, ctx => mod.sweep_expired(ctx, { sweep: { scheduled_id: 0n, scheduled_at: { tag: 'Interval', value: { micros: 0n } } as any } }))).toThrow('unauthorized: scheduler only');
  });

  it('expired nudge stays visible in a clockless view until the sweep, then disappears (stale window = one sweep)', () => {
    const { w, pairId, worker, sig } = world();
    commit(w, worker, commitArgs(pairId, sig, grantPrefs(w, w.bob, pairId)));
    w.h.clock.set(new Timestamp(nudgeRow(w)!.expires_at.microsSinceUnixEpoch));
    expect(view(w, w.bob, mod.my_nudges)).toHaveLength(1); // documented window: no clock in views
    sweep(w);
    expect(view(w, w.bob, mod.my_nudges)).toHaveLength(0);
    expect(nudgeRow(w)!.suppressed).toBe(true);
  });

  it('expired signals leave worker_signal_context after the sweep, and commit refuses them regardless', () => {
    const { w, pairId, worker, sig } = world();
    const pref = grantPrefs(w, w.bob, pairId);
    w.h.clock.set(new Timestamp(sig.expires_at.microsSinceUnixEpoch));
    expect(() => commit(w, worker, commitArgs(pairId, sig, pref))).toThrow('stale: expired'); // reducer has a clock
    expect(view(w, worker, mod.worker_signal_context)).toHaveLength(1);
    sweep(w);
    expect(view(w, worker, mod.worker_signal_context)).toHaveLength(0);
  });

  it('expired preference consent leaves the worker view and hides its nudges after the sweep', () => {
    const { w, pairId, worker, sig } = world();
    const pref = grantPrefs(w, w.bob, pairId, undefined, undefined, 0.5); // 12h
    commit(w, worker, commitArgs(pairId, sig, pref, { nudge_id: 'n-2' }));
    w.h.withReducerTx(w.admin, ctx => { const n = ctx.db.nudge.id.find('n-2')!; ctx.db.nudge.id.update({ ...n, expires_at: new Timestamp(n.expires_at.microsSinceUnixEpoch + 48n * HOUR_US) }); }); // isolate the consent expiry
    advance(w, 12n * HOUR_US);
    sweep(w);
    expect(view(w, worker, mod.worker_support_preferences)).toHaveLength(0);
    expect(view(w, w.bob, mod.my_nudges)).toHaveLength(0);
    // Renewing is a new version: the old nudge stays hidden (bound consent expired), new consent is visible to the worker.
    grantPrefs(w, w.bob, pairId);
    expect(view(w, worker, mod.worker_support_preferences)).toHaveLength(1);
  });

  it('a snoozed nudge is hidden until the snooze ends, then reappears after the sweep', () => {
    const { w, pairId, worker, sig } = world();
    commit(w, worker, commitArgs(pairId, sig, grantPrefs(w, w.bob, pairId)));
    const until = new Date(w.h.clock.now().toDate().getTime() + 3600e3).toISOString();
    w.call(w.bob, ctx => mod.snooze_nudge(ctx, { nudge_id: 'n-1', until }));
    expect(view(w, w.bob, mod.my_nudges)).toHaveLength(0);
    advance(w, HOUR_US);
    sweep(w);
    expect(view(w, w.bob, mod.my_nudges)).toHaveLength(1);
  });
});
