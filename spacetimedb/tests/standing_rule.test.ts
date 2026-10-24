// D047 standing-rule automatic nudges (CS; Cyber review requested). Direct reducer and view calls, including a third
// account, as a compromised client or worker could make them. Synthetic identities only. In-process harness: no
// deployed isolation, real JWT mapping or real scheduler.
import { describe, expect, it } from 'vitest';
import { Timestamp } from 'spacetimedb';
import { allSignals, approveArgs, confirmPreset, grantPrefs, inDays, jwtAuth, mod, pairUp, setup, sweep, view } from './helpers';

type W = ReturnType<typeof setup>;
const HOUR_MS = 3_600_000;
const advance = (w: W, ms: number) => w.h.clock.set(new Timestamp(w.h.clock.now().microsSinceUnixEpoch + BigInt(ms) * 1000n));

/** alice ↔ bob accepted pair; alice's partner preset; bob opted in with support consent; worker allow-listed. */
function world(cats = ['support_preference', 'coarse_availability']) {
  const w = setup();
  const { pairId } = pairUp(w);
  confirmPreset(w, w.alice, pairId, 'partner', cats);
  const pref = grantPrefs(w, w.bob, pairId);
  w.call(w.bob, ctx => mod.set_nudge_delivery(ctx, { pair_id: pairId, opted_in: true, quiet_start_minute: undefined, quiet_end_minute: undefined, utc_offset_minutes: 0 }));
  const worker = jwtAuth('dor-worker', 50n, 'https://worker.spacetimedb.example');
  const workerId = w.h.withReducerTx(worker, ctx => ctx.sender);
  w.h.withReducerTx(w.admin, ctx => mod.set_worker_identity(ctx, { worker: workerId, enabled: true }));
  const bound = { recipient_consent_id: pref.consent_id as string, recipient_consent_version: pref.consent_version as number };
  return { w, pairId, worker, bound };
}
type World = ReturnType<typeof world>;

const myRules = (w: W, who = w.alice) => view<any>(w, who, mod.my_standing_rules);
const ruleVersion = (w: W, who = w.alice) => (myRules(w, who)[0]?.version ?? 0) as number;
function setRule(x: World, over: Record<string, unknown> = {}, who = x.w.alice) {
  const args = {
    pair_id: x.pairId, support_modes: ['short_call'], availability: ['this_week'], purpose: 'support_check_in',
    expires_at: inDays(x.w, 7), expected_version: ruleVersion(x.w, who), ...over,
  } as Parameters<typeof mod.set_standing_rule>[1];
  x.w.call(who, ctx => mod.set_standing_rule(ctx, args));
}
function revokeRule(x: World) {
  const expected_version = ruleVersion(x.w); // views must be read outside the reducer transaction
  x.w.call(x.w.alice, ctx => mod.revoke_standing_rule(ctx, { pair_id: x.pairId, expected_version }));
}
function byRule(x: World, over: Record<string, unknown> = {}, who = x.w.alice) {
  const args = {
    pair_id: x.pairId, support_mode: 'short_call', availability: 'this_week', rule_version: ruleVersion(x.w, who),
    client_request_id: 'rule-req-1', ...over,
  } as Parameters<typeof mod.approve_signal_by_rule>[1];
  x.w.call(who, ctx => mod.approve_signal_by_rule(ctx, args));
  return allSignals(x.w).find(s => s.client_request_id === args.client_request_id);
}
const commit = (x: World, sig: { signal_id: string; consent_version: number }, id = 'n-1') => x.w.call(x.worker, ctx => mod.commit_nudge(ctx, {
  nudge_id: id, pair_id: x.pairId, template_id: 'offer_short_call', source_signal_ids: [sig.signal_id],
  source_consent_versions: [sig.consent_version], ...x.bound,
}));
const bobNudges = (x: World) => view<any>(x.w, x.w.bob, mod.my_nudges);

describe('create / revoke', () => {
  it('is off by default and only the owner of an accepted pair can create one', () => {
    const x = world();
    expect(myRules(x.w)).toEqual([]);
    expect(() => byRule(x, { rule_version: 1 })).toThrow('no_consent');
    expect(() => setRule(x, {}, x.w.carol)).toThrow('not_found: pair');
    setRule(x);
    expect(myRules(x.w)).toHaveLength(1);
    expect(myRules(x.w)[0]).toMatchObject({ pair_id: x.pairId, support_modes: ['short_call'], availability: ['this_week'], purpose: 'support_check_in', version: 1, active: true });
    expect(Object.keys(myRules(x.w)[0]).sort()).toEqual(['active', 'availability', 'expires_at', 'pair_id', 'purpose', 'support_modes', 'version']);
  });

  it('cannot broaden the preset, is bounded, enum-only, and versions are optimistic', () => {
    const x = world(['coarse_availability']);
    expect(() => setRule(x)).toThrow('unauthorized: blocked_category'); // short_call is outside the preset
    expect(() => setRule(x, { support_modes: [] })).not.toThrow();
    expect(() => setRule(x, { support_modes: ['short_call'], expected_version: 1 })).toThrow('blocked_category');
    const y = world();
    expect(() => setRule(y, { expires_at: inDays(y.w, 31) })).toThrow('invalid: invalid_schema');
    expect(() => setRule(y, { expires_at: inDays(y.w, 0.01) })).toThrow('invalid: invalid_schema');
    expect(() => setRule(y, { purpose: 'free text' })).toThrow('invalid: invalid_schema');
    expect(() => setRule(y, { support_modes: ['telepathy'] })).toThrow('invalid: invalid_schema');
    expect(() => setRule(y, { support_modes: [], availability: [] })).toThrow('invalid: invalid_schema');
    setRule(y);
    expect(() => setRule(y, { expected_version: 0 })).toThrow('stale: rule version changed');
    setRule(y, { support_modes: ['short_call', 'encouraging_note'] });
    expect(ruleVersion(y.w)).toBe(2);
  });

  it('revoke is owner-only, versioned and idempotent; counterpart and strangers see nothing', () => {
    const x = world();
    setRule(x);
    expect(myRules(x.w, x.w.bob)).toEqual([]);
    expect(myRules(x.w, x.w.carol)).toEqual([]);
    expect(view<any>(x.w, x.worker, mod.my_standing_rules)).toEqual([]);
    expect(() => x.w.call(x.w.carol, ctx => mod.revoke_standing_rule(ctx, { pair_id: x.pairId, expected_version: 1 }))).toThrow('not_found: rule');
    expect(() => x.w.call(x.w.bob, ctx => mod.revoke_standing_rule(ctx, { pair_id: x.pairId, expected_version: 1 }))).toThrow('not_found: rule');
    expect(() => x.w.call(x.w.alice, ctx => mod.revoke_standing_rule(ctx, { pair_id: x.pairId, expected_version: 9 }))).toThrow('stale: rule version changed');
    revokeRule(x);
    expect(myRules(x.w)[0]).toMatchObject({ active: false, version: 2 });
    revokeRule(x); // idempotent: version moved on only because the first revoke bumped it
  });

  it('stores only owner, pair, categories, purpose, version and times (no free text)', () => {
    const x = world();
    setRule(x);
    const rows = x.w.h.withReducerTx(x.w.admin, ctx => [...ctx.db.standing_rule.iter()]);
    expect(Object.keys(rows[0]!).sort()).toEqual(['availability', 'created_at', 'expires_at', 'owner', 'pair_id', 'purpose', 'revoked_at', 'rule_id', 'support_modes', 'updated_at', 'version']);
  });
});

describe('approve by rule', () => {
  it('approves a matching signal without a preview and the worker delivers it through the existing path', () => {
    const x = world();
    setRule(x);
    const sig = byRule(x)!;
    expect(sig).toMatchObject({ support_mode: 'short_call', availability: 'this_week', rule_version: 1 });
    expect(sig.rule_id).toBeTruthy();
    const ctxRow = view<any>(x.w, x.worker, mod.worker_signal_context).find(s => s.signal_id === sig.signal_id);
    expect(ctxRow).toBeTruthy();
    expect(JSON.stringify(ctxRow, (_, v) => typeof v === 'bigint' ? String(v) : v)).not.toContain(sig.rule_id);
    expect(Object.keys(ctxRow).some(k => k.includes('rule'))).toBe(false);
    commit(x, sig);
    expect(bobNudges(x)).toHaveLength(1);
  });

  it('refuses a category outside the rule, even if the preset allows it', () => {
    const x = world();
    setRule(x);
    expect(() => byRule(x, { support_mode: 'encouraging_note' })).toThrow('unauthorized: blocked_category');
    expect(() => byRule(x, { availability: 'today' })).toThrow('unauthorized: blocked_category');
    expect(() => byRule(x, { support_mode: undefined, availability: undefined })).toThrow('invalid: invalid_schema');
    expect(allSignals(x.w)).toHaveLength(0);
  });

  it('keeps the preset as the ceiling: tightening it after the rule refuses the approval', () => {
    const x = world();
    setRule(x);
    confirmPreset(x.w, x.w.alice, x.pairId, 'partner', ['coarse_availability']);
    expect(() => byRule(x)).toThrow('blocked_category');
    expect(() => byRule(x, { support_mode: undefined })).not.toThrow(); // availability alone is still inside both
  });

  it('refuses an expired rule', () => {
    const x = world();
    setRule(x, { expires_at: inDays(x.w, 2 / 24) });
    byRule(x, { client_request_id: 'ok' });
    advance(x.w, 3 * HOUR_MS);
    expect(() => byRule(x, { client_request_id: 'late' })).toThrow('stale: expired');
  });

  it('the sweep marks an expired rule; a rule signal never outlives its rule', () => {
    const x = world();
    setRule(x, { expires_at: inDays(x.w, 2 / 24) });
    const sig = byRule(x)!;
    expect(Number(sig.expires_at.microsSinceUnixEpoch / 1000n)).toBeLessThanOrEqual(x.w.h.clock.now().toDate().getTime() + 2 * HOUR_MS);
    advance(x.w, 3 * HOUR_MS);
    sweep(x.w);
    const marks = x.w.h.withReducerTx(x.w.admin, ctx => [...ctx.db.expired_record.iter()]).filter(r => r.kind === 'standing_rule');
    expect(marks).toHaveLength(1);
    expect(myRules(x.w)[0].active).toBe(false);
    expect(() => commit(x, sig)).toThrow('stale');
  });

  it('refuses a stale rule version', () => {
    const x = world();
    setRule(x);
    setRule(x, { support_modes: ['short_call', 'encouraging_note'] }); // v2
    expect(() => byRule(x, { rule_version: 1 })).toThrow('stale: stale_policy');
    expect(() => byRule(x, { rule_version: 9 })).toThrow('stale: stale_policy');
    expect(byRule(x, { rule_version: 2 })).toBeTruthy();
  });

  it('a third account cannot approve through someone else\'s rule', () => {
    const x = world();
    setRule(x);
    expect(() => byRule(x, { rule_version: 1 }, x.w.carol)).toThrow('not_found');
    expect(() => byRule(x, { rule_version: 1 }, x.w.bob)).toThrow('no_consent'); // the recipient has no rule of their own
    expect(allSignals(x.w)).toHaveLength(0);
  });
});

describe('revocation', () => {
  it('revoking the rule suppresses a pending signal at commit and in the worker view', () => {
    const x = world();
    setRule(x);
    const sig = byRule(x)!;
    revokeRule(x);
    expect(allSignals(x.w).find(s => s.signal_id === sig.signal_id)!.revoked_at).toBeTruthy();
    expect(view<any>(x.w, x.worker, mod.worker_signal_context).find(s => s.signal_id === sig.signal_id)).toBeUndefined();
    expect(() => commit(x, sig)).toThrow('stale');
    expect(() => byRule(x, { client_request_id: 'after' })).toThrow('stale: revoked');
    expect(bobNudges(x)).toHaveLength(0);
  });

  it('commit rechecks the rule even if a signal row were somehow left unrevoked', () => {
    const x = world();
    setRule(x);
    const sig = byRule(x)!;
    x.w.h.withReducerTx(x.w.admin, ctx => { // simulate a missed signal revocation: only the rule row changes
      const r = [...ctx.db.standing_rule.iter()][0]!;
      ctx.db.standing_rule.rule_id.update({ ...r, revoked_at: ctx.timestamp, version: r.version + 1 });
    });
    expect(allSignals(x.w)[0]!.revoked_at).toBeUndefined();
    expect(view<any>(x.w, x.worker, mod.worker_signal_context)).toHaveLength(0);
    expect(() => commit(x, sig)).toThrow('stale: revoked');
  });

  it('a delivered nudge is not retracted by revoking the rule; undelivered rule signals are', () => {
    const x = world();
    setRule(x);
    const delivered = byRule(x, { client_request_id: 'a' })!;
    const pending = byRule(x, { client_request_id: 'b', support_mode: undefined })!;
    commit(x, delivered);
    revokeRule(x);
    const rows = allSignals(x.w);
    expect(rows.find(s => s.signal_id === delivered.signal_id)!.revoked_at).toBeUndefined();
    expect(rows.find(s => s.signal_id === pending.signal_id)!.revoked_at).toBeTruthy();
    expect(bobNudges(x)).toHaveLength(1);
  });

  it('replaying the same client_request_id after revoke does not resurrect anything', () => {
    const x = world();
    setRule(x);
    const sig = byRule(x)!;
    revokeRule(x);
    x.w.call(x.w.alice, ctx => mod.approve_signal_by_rule(ctx, { pair_id: x.pairId, support_mode: 'short_call', availability: 'this_week', rule_version: 1, client_request_id: 'rule-req-1' }));
    const rows = allSignals(x.w);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.revoked_at).toBeTruthy();
    // Even after the owner sets a new rule, the old request id stays burned and the revoked signal stays revoked.
    setRule(x);
    expect(() => byRule(x, { client_request_id: 'rule-req-1', rule_version: ruleVersion(x.w) })).toThrow('invalid: client_request_id reused');
    expect(allSignals(x.w).filter(s => !s.revoked_at)).toHaveLength(0);
    expect(() => commit(x, sig)).toThrow('stale');
  });

  it('changing the rule revokes undelivered approvals made under the old version', () => {
    const x = world();
    setRule(x);
    const sig = byRule(x)!;
    setRule(x, { availability: [] });
    expect(allSignals(x.w).find(s => s.signal_id === sig.signal_id)!.revoked_at).toBeTruthy();
    expect(() => commit(x, sig)).toThrow('stale');
  });

  it('a manual approval cannot reuse a by-rule request id, or the reverse', () => {
    const x = world();
    setRule(x);
    byRule(x);
    const args = approveArgs(x.w, x.w.alice, x.pairId, { support_mode: 'short_call', availability: 'this_week' }, 'rule-req-1');
    expect(() => x.w.call(x.w.alice, ctx => mod.approve_signal(ctx, args))).toThrow('invalid: client_request_id reused');
  });
});

describe('pause and unlink', () => {
  it('pausing revokes the rule and its pending signals; resume restores nothing', () => {
    const x = world();
    setRule(x);
    const sig = byRule(x)!;
    x.w.call(x.w.alice, ctx => mod.pause_recipient(ctx, { pair_id: x.pairId, expires_at: inDays(x.w, 0.5), expected_version: 0 }));
    expect(myRules(x.w)[0]).toMatchObject({ active: false, version: 2 });
    expect(allSignals(x.w).find(s => s.signal_id === sig.signal_id)!.revoked_at).toBeTruthy();
    expect(() => byRule(x, { client_request_id: 'p1', rule_version: 1 })).toThrow('recipient_paused');
    expect(() => setRule(x)).toThrow('unauthorized: recipient_paused');
    expect(() => commit(x, sig)).toThrow('stale');
    x.w.call(x.w.alice, ctx => mod.resume_recipient(ctx, { pair_id: x.pairId, expected_version: 1 }));
    expect(() => byRule(x, { client_request_id: 'p2' })).toThrow('stale: revoked');
    setRule(x); // a fresh, explicit rule is the only way back
    expect(byRule(x, { client_request_id: 'p3' })).toBeTruthy();
  });

  it('pausing does not touch the counterpart\'s own rule on the same pair', () => {
    const x = world();
    setRule(x);
    confirmPreset(x.w, x.w.bob, x.pairId, 'partner', ['support_preference', 'coarse_availability']);
    setRule(x, {}, x.w.bob);
    x.w.call(x.w.alice, ctx => mod.pause_recipient(ctx, { pair_id: x.pairId, expires_at: inDays(x.w, 0.5), expected_version: 0 }));
    expect(myRules(x.w, x.w.bob)[0].active).toBe(true);
    expect(myRules(x.w)[0].active).toBe(false);
  });

  it('unlinking revokes every rule in the pair', () => {
    const x = world();
    setRule(x);
    const sig = byRule(x)!;
    x.w.call(x.w.bob, ctx => mod.unlink_pair(ctx, { pair_id: x.pairId }));
    expect(myRules(x.w)[0].active).toBe(false);
    expect(() => byRule(x, { client_request_id: 'u', rule_version: 1 })).toThrow();
    expect(() => commit(x, sig)).toThrow();
  });
});

describe('recipient sees nothing different', () => {
  it('my_nudges rows are identical whether the approval was manual or by rule', () => {
    const manual = world();
    const auto = world();
    setRule(auto);
    const args = approveArgs(manual.w, manual.w.alice, manual.pairId, { support_mode: 'short_call', availability: 'this_week' }, 'm1');
    manual.w.call(manual.w.alice, ctx => mod.approve_signal(ctx, args));
    commit(manual, allSignals(manual.w)[0]!, 'same-id');
    commit(auto, byRule(auto)!, 'same-id');
    const a = bobNudges(manual);
    const b = bobNudges(auto);
    expect(a).toHaveLength(1);
    expect(JSON.stringify(b, (_, v) => typeof v === 'bigint' ? String(v) : v)).toBe(JSON.stringify(a, (_, v) => typeof v === 'bigint' ? String(v) : v));
    expect(Object.keys(b[0]).sort()).toEqual(['id', 'pair_id', 'template_id', 'visible_until']);
    expect(view<any>(auto.w, auto.w.bob, mod.my_receipts)).toEqual([]);
  });

  it('the recipient-side gates still apply to rule-approved signals (opt-out, cooldown)', () => {
    const x = world();
    setRule(x);
    const first = byRule(x, { client_request_id: 'c1' })!;
    commit(x, first, 'n-a');
    const second = byRule(x, { client_request_id: 'c2', support_mode: 'short_call', availability: undefined })!;
    expect(() => commit(x, second, 'n-b')).toThrow('rate_limited: cooldown');
    x.w.call(x.w.bob, ctx => mod.set_nudge_delivery(ctx, { pair_id: x.pairId, opted_in: false, quiet_start_minute: undefined, quiet_end_minute: undefined, utc_offset_minutes: 0 }));
    advance(x.w, 25 * HOUR_MS);
    expect(() => commit(x, second, 'n-c')).toThrow();
  });
});
