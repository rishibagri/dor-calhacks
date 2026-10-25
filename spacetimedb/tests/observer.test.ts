// D053 demo backstage + D052 Reasoning decision log. Synthetic identities only; in-process harness.
import { describe, expect, it } from 'vitest';
import { Timestamp } from 'spacetimedb';
import { mod, pairUp, setup, view } from './helpers';

const OBSERVER_VIEWS = [mod.observer_accounts, mod.observer_pairs, mod.observer_assignments, mod.observer_signals,
  mod.observer_nudges, mod.observer_delivery, mod.observer_support_preferences, mod.observer_pauses,
  mod.observer_introductions, mod.observer_nudge_requests, mod.observer_reasoning];

const decision = (pairId?: string) => ({
  episode_id: 'ep-1', pair_id: pairId, mode: 'act', action: 'CASUAL_INVITE', surface: 'recipient',
  reasons: ['pattern_prefers_company'], rejected: ['DIRECT_CHECK_IN:explicit_intent'], reassess_after_minutes: undefined,
  source: 'model', outcome: 'sent',
});

describe('observer views', () => {
  it('are empty for everyone until the module owner allow-lists an observer', () => {
    const w = setup();
    pairUp(w);
    for (const v of OBSERVER_VIEWS) for (const who of [w.alice, w.bob, w.carol]) expect(view(w, who, v)).toEqual([]);
    expect(view<any>(w, w.carol, mod.observer_status)).toEqual([{ observer: false }]);
  });

  it('only the module owner can allow-list, and the observer then sees every pair and account', () => {
    const w = setup();
    pairUp(w);
    const carolId = w.h.withReducerTx(w.carol, ctx => ctx.sender);
    expect(() => w.call(w.alice, ctx => mod.set_observer_identity(ctx, { observer: carolId, enabled: true }))).toThrow('unauthorized');
    w.h.withReducerTx(w.admin, ctx => mod.set_observer_identity(ctx, { observer: carolId, enabled: true }));
    expect(view<any>(w, w.carol, mod.observer_status)).toEqual([{ observer: true }]);
    expect(view(w, w.carol, mod.observer_pairs)).toHaveLength(1);
    expect(view(w, w.carol, mod.observer_accounts).length).toBeGreaterThanOrEqual(2);
    expect(view(w, w.alice, mod.observer_pairs)).toEqual([]);
    w.h.withReducerTx(w.admin, ctx => mod.set_observer_identity(ctx, { observer: carolId, enabled: false }));
    expect(view(w, w.carol, mod.observer_pairs)).toEqual([]);
  });
});

describe('record_reasoning_decision', () => {
  it('stores codes for the owner, visible to the owner and observers only', () => {
    const w = setup();
    const { pairId } = pairUp(w);
    w.call(w.alice, ctx => mod.record_reasoning_decision(ctx, decision(pairId)));
    expect(view<any>(w, w.alice, mod.my_reasoning_decisions)).toHaveLength(1);
    expect(view(w, w.bob, mod.my_reasoning_decisions)).toEqual([]);
    expect(view(w, w.bob, mod.observer_reasoning)).toEqual([]);
  });

  it('rejects free text, unknown codes and a pair the caller is not in', () => {
    const w = setup();
    const { pairId } = pairUp(w);
    const bad = [
      { ...decision(pairId), reasons: ['Sam was sad'] },
      { ...decision(pairId), rejected: ['tell them about the party'] },
      { ...decision(pairId), mode: 'send_everything' },
      { ...decision(pairId), action: 'free text here' },
      { ...decision(pairId), outcome: 'whatever' },
    ];
    for (const args of bad) expect(() => w.call(w.alice, ctx => mod.record_reasoning_decision(ctx, args))).toThrow('invalid');
    expect(() => w.call(w.carol, ctx => mod.record_reasoning_decision(ctx, decision(pairId)))).toThrow();
    expect(view(w, w.alice, mod.my_reasoning_decisions)).toEqual([]);
  });

  it('keeps at most 100 decisions per owner', () => {
    const w = setup();
    pairUp(w);
    for (let i = 0; i < 105; i++) {
      w.h.clock.set(new Timestamp(w.h.clock.now().microsSinceUnixEpoch + 1_000_000n));
      w.call(w.alice, ctx => mod.record_reasoning_decision(ctx, { ...decision(), episode_id: `ep-${i}` }));
    }
    expect(view(w, w.alice, mod.my_reasoning_decisions)).toHaveLength(100);
  });
});
