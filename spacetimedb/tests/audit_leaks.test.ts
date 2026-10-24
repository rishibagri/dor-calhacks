// Core 3 audit items 2 and 3 (CS live audit): no timing leak to the recipient through my_nudges, and no
// recipient-side state leak to the sender through my_receipts. Direct view calls; synthetic identities only.
import { describe, expect, it } from 'vitest';
import { allSignals, approveArgs, confirmPreset, grantPrefs, inDays, jwtAuth, mod, pairUp, setup, view } from './helpers';

type W = ReturnType<typeof setup>;
const HOUR_US = 3_600_000_000n;
const BOTH = { support_mode: 'short_call', availability: 'this_week' };
const json = (v: unknown) => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? String(x) : x);

function world() {
  const w = setup();
  const { pairId } = pairUp(w);
  confirmPreset(w, w.alice, pairId, 'partner', ['support_preference', 'coarse_availability']);
  const pref = grantPrefs(w, w.bob, pairId);
  w.call(w.bob, ctx => mod.set_nudge_delivery(ctx, { pair_id: pairId, opted_in: true, quiet_start_minute: undefined, quiet_end_minute: undefined, utc_offset_minutes: 0 }));
  const worker = jwtAuth('dor-worker', 50n, 'https://worker.spacetimedb.example');
  const workerId = w.h.withReducerTx(worker, ctx => ctx.sender);
  w.h.withReducerTx(w.admin, ctx => mod.set_worker_identity(ctx, { worker: workerId, enabled: true }));
  return { w, pairId, worker, pref };
}
function approveAndCommit(x: ReturnType<typeof world>, req = 'req-1') {
  const args = approveArgs(x.w, x.w.alice, x.pairId, BOTH, req);
  x.w.call(x.w.alice, ctx => mod.approve_signal(ctx, args));
  const sig = allSignals(x.w).find(s => s.client_request_id === req)!;
  x.w.call(x.worker, ctx => mod.commit_nudge(ctx, {
    nudge_id: 'n-' + req, pair_id: x.pairId, template_id: 'offer_short_call', source_signal_ids: [sig.signal_id],
    source_consent_versions: [sig.consent_version], recipient_consent_id: x.pref.consent_id, recipient_consent_version: x.pref.consent_version,
  }));
  return sig;
}
const receipts = (w: W) => view<any>(w, w.alice, mod.my_receipts).map(r => r.action);

describe('audit item 2: my_nudges carries no sender timing or internal ids', () => {
  it('the recipient row is exactly {id, pair_id, template_id, visible_until}', () => {
    const x = world();
    const sig = approveAndCommit(x);
    const [n] = view<any>(x.w, x.w.bob, mod.my_nudges);
    expect(Object.keys(n).sort()).toEqual(['id', 'pair_id', 'template_id', 'visible_until']);
    expect(json(n)).not.toContain(sig.signal_id);
    expect(json(n)).not.toContain(x.pref.consent_id);
  });

  it('visible_until is rounded up to a whole hour, so the approval moment cannot be recovered', () => {
    const x = world();
    x.w.h.clock.set(new (x.w.h.clock.now().constructor as any)(x.w.h.clock.now().microsSinceUnixEpoch + 1_234_567_890n)); // odd minute
    const sig = approveAndCommit(x);
    const [n] = view<any>(x.w, x.w.bob, mod.my_nudges);
    const shown = n.visible_until.microsSinceUnixEpoch as bigint;
    const exact = x.w.h.withReducerTx(x.w.admin, ctx => ctx.db.nudge.id.find('n-req-1')!.expires_at.microsSinceUnixEpoch);
    expect(shown % HOUR_US).toBe(0n);
    expect(shown).toBeGreaterThanOrEqual(exact);
    expect(shown - exact).toBeLessThan(HOUR_US);
    expect(exact % HOUR_US).not.toBe(0n); // the exact value was not already aligned, so rounding hid something
    expect(sig.expires_at.microsSinceUnixEpoch % HOUR_US).not.toBe(0n);
  });
});

describe('audit item 3: the sender sees only their own actions', () => {
  it('approve and the owner\'s own revoke are visible; the "used" outcome is not', () => {
    const x = world();
    const sig = approveAndCommit(x);
    expect(receipts(x.w)).toEqual(['approved']);
    x.w.call(x.w.alice, ctx => mod.revoke_signal(ctx, { signal_id: sig.signal_id }));
    expect(receipts(x.w)).toEqual(['approved', 'revoked']);
  });

  it('nothing the recipient does changes the sender\'s receipts (noninterference)', () => {
    const x = world();
    approveAndCommit(x);
    const before = view<any>(x.w, x.w.alice, mod.my_receipts);
    x.w.call(x.w.bob, ctx => mod.set_nudge_delivery(ctx, { pair_id: x.pairId, opted_in: false, quiet_start_minute: undefined, quiet_end_minute: undefined, utc_offset_minutes: 0 }));
    x.w.call(x.w.bob, ctx => mod.revoke_support_preferences(ctx, { pair_id: x.pairId }));
    expect(view<any>(x.w, x.w.alice, mod.my_receipts)).toEqual(before);
  });

  it('a recipient unlink adds no receipt the sender can see (the unlink itself is visible in my_pairs)', () => {
    const x = world();
    approveAndCommit(x);
    const before = receipts(x.w);
    x.w.call(x.w.bob, ctx => mod.unlink_pair(ctx, { pair_id: x.pairId }));
    expect(receipts(x.w)).toEqual(before);
  });

  it('the owner\'s own pause or preset tightening shows as their own "revoked"', () => {
    const x = world();
    approveAndCommit(x);
    x.w.call(x.w.alice, ctx => mod.pause_recipient(ctx, { pair_id: x.pairId, expires_at: inDays(x.w, 0.5), expected_version: 0 }));
    expect(receipts(x.w)).toEqual(['approved', 'revoked']);
  });

  it('the recipient still sees no receipts at all', () => {
    const x = world();
    approveAndCommit(x);
    expect(view(x.w, x.w.bob, mod.my_receipts)).toHaveLength(0);
  });
});
