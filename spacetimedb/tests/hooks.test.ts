// D055: the sender's talking point travels with the nudge built from that signal. Synthetic identities only.
import { describe, expect, it } from 'vitest';
import { allSignals, approveArgs, confirmPreset, grantPrefs, jwtAuth, mod, pairUp, setup, view } from './helpers';

const BOTH = { support_mode: 'short_call', availability: 'this_week' };

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

function approve(x: ReturnType<typeof world>, req = 'req-1') {
  const args = approveArgs(x.w, x.w.alice, x.pairId, BOTH, req); // built outside the transaction
  x.w.call(x.w.alice, ctx => mod.approve_signal(ctx, args));
  return allSignals(x.w).find(s => s.client_request_id === req)!;
}
function commit(x: ReturnType<typeof world>, sig: any) {
  x.w.call(x.worker, ctx => mod.commit_nudge(ctx, {
    nudge_id: 'n-' + sig.client_request_id, pair_id: x.pairId, template_id: 'offer_short_call', source_signal_ids: [sig.signal_id],
    source_consent_versions: [sig.consent_version], recipient_consent_id: x.pref.consent_id, recipient_consent_version: x.pref.consent_version,
  }));
}
const hook = (x: ReturnType<typeof world>, req: string, text: string) =>
  x.w.call(x.w.alice, ctx => mod.attach_signal_hook(ctx, { client_request_id: req, hook: text }));

describe('attach_signal_hook', () => {
  it('the recipient sees the talking point on the nudge', () => {
    const x = world();
    const sig = approve(x);
    hook(x, 'req-1', '  Ask how her  exam went ');
    commit(x, sig);
    expect(view<any>(x.w, x.w.bob, mod.my_nudges)[0].hook).toBe('Ask how her exam went');
  });

  it('no hook means none on the nudge', () => {
    const x = world();
    commit(x, approve(x));
    expect(view<any>(x.w, x.w.bob, mod.my_nudges)[0].hook).toBeUndefined();
  });

  it('only the signal owner can attach, and the text is validated', () => {
    const x = world();
    approve(x);
    expect(() => x.w.call(x.w.bob, ctx => mod.attach_signal_hook(ctx, { client_request_id: 'req-1', hook: 'hi' }))).toThrow('not_found');
    expect(() => hook(x, 'req-1', '')).toThrow('hook empty');
    expect(() => hook(x, 'req-1', 'x'.repeat(141))).toThrow('hook too long');
    expect(() => hook(x, 'req-1', 'see https://evil.example')).toThrow('hook has a link');
  });
});
