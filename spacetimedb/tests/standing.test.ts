// D044 automatic nudges (Cyber): owner standing consent for one pair. Direct reducer/view calls with a third account.
// Synthetic identities only. In-process harness: not deployed isolation or a live worker.
import { describe, expect, it } from 'vitest';
import { Timestamp } from 'spacetimedb';
import { STANDING_CONSENT_VERSION } from '@dor/contracts/policy';
import { allSignals, confirmPreset, grantPrefs, inDays, jwtAuth, mod, pairUp, setup, sweep, view } from './helpers';

type W = ReturnType<typeof setup>;
type Who = W['alice'];
const HOUR_MS = 3_600_000;
const advance = (w: W, ms: number) => w.h.clock.set(new Timestamp(w.h.clock.now().microsSinceUnixEpoch + BigInt(ms) * 1000n));

function world({ optIn = true } = {}) {
  const w = setup();
  const { pairId } = pairUp(w);
  confirmPreset(w, w.alice, pairId, 'partner', ['support_preference', 'coarse_availability']);
  const pref = grantPrefs(w, w.bob, pairId);
  if (optIn) w.call(w.bob, ctx => mod.set_nudge_delivery(ctx, { pair_id: pairId, opted_in: true, quiet_start_minute: undefined, quiet_end_minute: undefined, utc_offset_minutes: 0 }));
  const worker = jwtAuth('dor-worker', 50n, 'https://worker.spacetimedb.example');
  const workerId = w.h.withReducerTx(worker, ctx => ctx.sender);
  w.h.withReducerTx(w.admin, ctx => mod.set_worker_identity(ctx, { worker: workerId, enabled: true }));
  return { w, pairId, worker, bound: { recipient_consent_id: pref.consent_id as string, recipient_consent_version: pref.consent_version as number } };
}
type X = ReturnType<typeof world>;
const versions = (w: W, who: Who, pairId: string) => {
  const asg = view<any>(w, who, mod.my_preset_assignments).find(a => a.pair_id === pairId);
  const preset = view<any>(w, who, mod.my_presets).find(p => p.policy_id === asg.preset_id);
  return { expected_policy_version: preset.version as number, expected_assignment_version: asg.assignment_version as number };
};
const rules = (w: W, who: Who) => view<any>(w, who, mod.my_standing_consents);
function enable(x: X, over: Record<string, unknown> = {}, who: Who = x.w.alice) {
  const v = versions(x.w, who, x.pairId);
  const expected_version = rules(x.w, who).find(r => r.pair_id === x.pairId)?.version ?? 0;
  x.w.call(who, ctx => mod.set_standing_consent(ctx, { pair_id: x.pairId, categories: ['support_preference'], expires_at: inDays(x.w, 7),
    expected_version, ...v, notice_version: STANDING_CONSENT_VERSION, ...over } as Parameters<typeof mod.set_standing_consent>[1]));
}
const ruleVersion = (x: X) => rules(x.w, x.w.alice).find(r => r.pair_id === x.pairId)?.version ?? 0;
function autoApprove(x: X, req = 'auto-0001', payload: Record<string, unknown> = { support_mode: 'short_call' }) {
  const rule_version = ruleVersion(x);
  x.w.call(x.w.alice, ctx => mod.approve_signal_standing(ctx, { pair_id: x.pairId, support_mode: undefined, availability: undefined,
    client_request_id: req, rule_version, ...payload } as Parameters<typeof mod.approve_signal_standing>[1]));
  return allSignals(x.w).find(s => s.client_request_id === req)!;
}
const commit = (x: X, sig: any, id = 'n-' + sig.signal_id) => x.w.call(x.worker, ctx => mod.commit_nudge(ctx, {
  nudge_id: id, pair_id: x.pairId, template_id: 'offer_short_call', source_signal_ids: [sig.signal_id],
  source_consent_versions: [sig.consent_version], ...x.bound,
}));
const bobNudges = (w: W) => view<any>(w, w.bob, mod.my_nudges);

describe('off by default; only an explicit owner action enables it', () => {
  it('without a rule, automatic approval is refused and nothing is created', () => {
    const x = world();
    expect(() => x.w.call(x.w.alice, ctx => mod.approve_signal_standing(ctx, { pair_id: x.pairId, support_mode: 'short_call', availability: undefined,
      client_request_id: 'auto-none-01', rule_version: 1 }))).toThrow('unauthorized: no_rule');
    expect(allSignals(x.w)).toHaveLength(0);
  });

  it('setup needs an accepted pair, the preset category, the shown versions and notice, and 1 h–30 days', () => {
    const x = world();
    expect(() => enable(x, { categories: ['support_preference', 'activity_interest'] })).toThrow('invalid: invalid_schema');
    expect(() => enable(x, { expected_policy_version: 99 })).toThrow('stale: stale_policy');
    expect(() => enable(x, { notice_version: 0 })).toThrow('stale: stale_policy');
    expect(() => enable(x, { expires_at: inDays(x.w, 31) })).toThrow('invalid: too_long');
    expect(() => enable(x, { expires_at: inDays(x.w, 0.01) })).toThrow('invalid: too_short');
    expect(() => enable(x, { categories: [] })).toThrow('invalid: invalid_schema');
    enable(x);
    expect(rules(x.w, x.w.alice)[0]).toMatchObject({ pair_id: x.pairId, categories: ['support_preference'], active: true, version: 1 });
  });

  it('a preset is a ceiling: a rule cannot cover a category the preset does not allow', () => {
    const x = world();
    confirmPreset(x.w, x.w.alice, x.pairId, 'partner', ['support_preference']);
    expect(() => enable(x, { categories: ['coarse_availability'] })).toThrow('unauthorized: blocked_category');
  });

  it('a third account cannot set, revoke or see a rule; the recipient sees nothing', () => {
    const x = world();
    expect(() => x.w.call(x.w.carol, ctx => mod.set_standing_consent(ctx, { pair_id: x.pairId, categories: ['support_preference'],
      expires_at: inDays(x.w, 7), expected_version: 0, expected_policy_version: 1, expected_assignment_version: 1,
      notice_version: STANDING_CONSENT_VERSION }))).toThrow('not_found: pair');
    enable(x);
    expect(() => x.w.call(x.w.carol, ctx => mod.revoke_standing_consent(ctx, { pair_id: x.pairId }))).toThrow('not_found: pair');
    expect(rules(x.w, x.w.carol)).toHaveLength(0);
    expect(rules(x.w, x.w.bob)).toHaveLength(0);
  });
});

describe('automatic approval keeps every check', () => {
  it('a matching candidate is approved without a preview and delivered once the recipient opted in', () => {
    const x = world();
    enable(x);
    const sig = autoApprove(x);
    expect(sig.revoked_at).toBeUndefined();
    commit(x, sig);
    expect(bobNudges(x.w)).toHaveLength(1);
  });

  it('a payload outside the rule\'s categories is refused (availability not covered)', () => {
    const x = world();
    enable(x);
    expect(() => autoApprove(x, 'auto-0002', { availability: 'this_week' })).toThrow('unauthorized: blocked_category');
  });

  it('the recipient still decides: not opted in means no nudge', () => {
    const x = world({ optIn: false });
    enable(x);
    const sig = autoApprove(x);
    expect(() => commit(x, sig)).toThrow('unauthorized: not_opted_in');
    expect(bobNudges(x.w)).toHaveLength(0);
  });

  it('no per-event receipt is shown to the sender; the approval stays revocable in my_signals', () => {
    const x = world();
    enable(x);
    autoApprove(x);
    expect(view<any>(x.w, x.w.alice, mod.my_receipts)).toHaveLength(0);
    expect(view<any>(x.w, x.w.alice, mod.my_signals)).toHaveLength(1);
  });

  it('a stale rule version or a changed preset refuses automatic approval', () => {
    const x = world();
    enable(x);
    expect(() => x.w.call(x.w.alice, ctx => mod.approve_signal_standing(ctx, { pair_id: x.pairId, support_mode: 'short_call', availability: undefined,
      client_request_id: 'auto-0003', rule_version: 99 }))).toThrow('stale: stale_policy');
    confirmPreset(x.w, x.w.alice, x.pairId, 'partner', ['support_preference', 'coarse_availability']); // re-saves: version bump
    expect(() => autoApprove(x, 'auto-0004')).toThrow(/^stale:/);
  });
});

describe('revocation, expiry and pause kill queued work and never resurrect it', () => {
  it('revoking the rule kills unused automatic approvals and their nudges; re-enabling revives nothing', () => {
    const x = world();
    enable(x);
    const sig = autoApprove(x);
    commit(x, sig);
    const unused = autoApprove(x, 'auto-0005');
    x.w.call(x.w.alice, ctx => mod.revoke_standing_consent(ctx, { pair_id: x.pairId }));
    expect(bobNudges(x.w)).toHaveLength(0);
    expect(() => commit(x, unused, 'n-late')).toThrow('stale: revoked');
    enable(x);
    expect(allSignals(x.w).filter(s => !s.revoked_at)).toHaveLength(0);
    expect(view<any>(x.w, x.worker, mod.worker_signal_context)).toHaveLength(0);
  });

  it('an expired rule refuses new approvals and, after the sweep, hides old automatic approvals', () => {
    const x = world();
    enable(x, { expires_at: inDays(x.w, 2 / 24) });
    const sig = autoApprove(x);
    advance(x.w, 2 * HOUR_MS + 1);
    expect(() => autoApprove(x, 'auto-0006')).toThrow('stale: expired');
    expect(() => commit(x, sig)).toThrow(/^stale:/);
    sweep(x.w);
    expect(rules(x.w, x.w.alice)[0].active).toBe(false);
  });

  it('a D041 pause ends the rule and its queued work; resuming never re-enables it', () => {
    const x = world();
    enable(x);
    const sig = autoApprove(x);
    x.w.call(x.w.alice, ctx => mod.pause_recipient(ctx, { pair_id: x.pairId, expires_at: inDays(x.w, 0.5), expected_version: 0 }));
    expect(() => commit(x, sig)).toThrow('stale: revoked');
    expect(rules(x.w, x.w.alice)[0].active).toBe(false);
    const pv = view<any>(x.w, x.w.alice, mod.my_recipient_pauses)[0].version;
    x.w.call(x.w.alice, ctx => mod.resume_recipient(ctx, { pair_id: x.pairId, expected_version: pv }));
    expect(() => autoApprove(x, 'auto-0007')).toThrow('stale: revoked');
    expect(() => enable(x, { expected_version: 99 })).toThrow('stale: standing rule version changed');
  });

  it('unlinking the pair ends the rule and its queued work', () => {
    const x = world();
    enable(x);
    const sig = autoApprove(x);
    x.w.call(x.w.alice, ctx => mod.unlink_pair(ctx, { pair_id: x.pairId }));
    expect(rules(x.w, x.w.alice)[0].active).toBe(false);
    expect(() => commit(x, sig)).toThrow(/^(stale|invalid|not_found|unauthorized):/);
    expect(allSignals(x.w).filter(s => !s.revoked_at)).toHaveLength(0);
  });

  it('setting a rule while paused is refused', () => {
    const x = world();
    x.w.call(x.w.alice, ctx => mod.pause_recipient(ctx, { pair_id: x.pairId, expires_at: inDays(x.w, 0.5), expected_version: 0 }));
    expect(() => enable(x)).toThrow('unauthorized: paused');
  });
});

describe('defence in depth: each recheck holds even if a future writer skips the main path', () => {
  it('rule revoked in the table without killing its signals: worker view, commit and my_nudges still refuse', () => {
    const x = world();
    enable(x);
    commit(x, autoApprove(x));
    const queued = autoApprove(x, 'auto-dd-01');
    x.w.h.withReducerTx(x.w.admin, ctx => {
      for (const r of [...ctx.db.standing_consent.iter()]) ctx.db.standing_consent.rule_id.update({ ...r, revoked_at: ctx.timestamp });
    });
    expect(allSignals(x.w).filter(s => !s.revoked_at)).toHaveLength(2); // nothing was revoked directly
    expect(view<any>(x.w, x.worker, mod.worker_signal_context)).toHaveLength(0);
    expect(bobNudges(x.w)).toHaveLength(0);
    expect(queued).toBeTruthy();
  });

  it('commit refuses an unrevoked automatic approval once its rule no longer stands (no cooldown in play)', () => {
    const x = world();
    enable(x);
    const queued = autoApprove(x, 'auto-dd-03');
    x.w.h.withReducerTx(x.w.admin, ctx => {
      for (const r of [...ctx.db.standing_consent.iter()]) ctx.db.standing_consent.rule_id.update({ ...r, revoked_at: ctx.timestamp });
    });
    expect(() => commit(x, queued)).toThrow('stale: revoked');
  });

  it('a pause row written without ending the rule still refuses automatic approval', () => {
    const x = world();
    enable(x);
    x.w.h.withReducerTx(x.w.admin, ctx => {
      const p = ctx.db.pair.pair_id.find(x.pairId)!;
      ctx.db.recipient_pause.insert({ pause_id: 'raw-pause-std', owner: p.member_a, pair_id: x.pairId, target: p.member_b!, version: 1,
        expires_at: new Timestamp(ctx.timestamp.microsSinceUnixEpoch + 3_600_000_000n), resumed_at: undefined, created_at: ctx.timestamp, updated_at: ctx.timestamp });
    });
    expect(() => autoApprove(x, 'auto-dd-02')).toThrow('unauthorized: recipient_paused');
  });
});

describe('separate from discovery and other consents', () => {
  it('a standing rule makes nobody discoverable and grants nothing to anyone outside the pair', () => {
    const x = world();
    enable(x);
    for (const [k, v] of [['tags', ['hiking']], ['areas', ['berkeley-campus']], ['enabled', ['true']]] as const) {
      x.w.h.withReducerTx(x.w.admin, ctx => mod.set_discovery_config(ctx, { key: k, values: [...v] }));
    }
    expect(view(x.w, x.w.carol, mod.discovery_cards)).toHaveLength(0);
    expect(view(x.w, x.w.alice, mod.discovery_cards)).toHaveLength(0);
  });
});
