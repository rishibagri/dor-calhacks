// D061 demo reset: operator-only, rebuilds the starting board in one transaction, leaves everyone else alone.
// Synthetic identities and names only; in-process harness.
import { describe, expect, it } from 'vitest';
import { allSignals, approveArgs, jwtAuth, mod, setup, view } from './helpers';

function world() {
  const w = setup();
  const admin = (fn: Parameters<typeof w.h.withReducerTx>[1]) => w.h.withReducerTx(w.admin, fn);
  admin(ctx => mod.set_discovery_config(ctx, { key: 'tags', values: ['coffee', 'climbing', 'live-music', 'hiking', 'board-games', 'film', 'books', 'running', 'photography'] }));
  admin(ctx => mod.set_discovery_config(ctx, { key: 'areas', values: ['berkeley-campus', 'sf-mission'] }));
  const dave = jwtAuth('dave', 4n), erin = jwtAuth('erin', 5n);
  w.call(dave, ctx => mod.register_account(ctx, { display_name: 'Dave' }));
  w.call(erin, ctx => mod.register_account(ctx, { display_name: 'Erin' }));
  const id = (a: typeof dave) => w.h.withReducerTx(a, ctx => ctx.sender);
  // adam = alice (operator), rishi = bob, nimisha = carol, sumedh = dave; erin is not in the demo.
  const roster = [['adam', w.alice, true], ['rishi', w.bob, false], ['nimisha', w.carol, false], ['sumedh', dave, false]] as const;
  const enroll = () => { for (const [slot, who, operator] of roster) { const member = id(who); admin(ctx => mod.set_demo_member(ctx, { member, slot, operator, enabled: true })); } };
  return Object.assign(w, { dave, erin, id, enroll, asAdmin: admin });
}
type W = ReturnType<typeof world>;
const reset = (w: W, who = w.alice) => w.call(who, ctx => mod.demo_reset(ctx, {}));
const pairsOf = (w: W, who: W['alice']) => view<any>(w, who, mod.my_pairs).filter(p => p.status === 'accepted');
const names = (rows: any[], key: string) => rows.map(r => r[key]).sort();

describe('demo_reset', () => {
  it('refuses non-operators and an incomplete roster; set_demo_member is owner-only', () => {
    const w = world();
    const alice = w.id(w.alice), erin = w.id(w.erin);
    expect(() => w.call(w.alice, ctx => mod.set_demo_member(ctx, { member: alice, slot: 'adam', operator: true, enabled: true }))).toThrow('unauthorized');
    expect(() => reset(w)).toThrow('unauthorized');
    w.asAdmin(ctx => mod.set_demo_member(ctx, { member: alice, slot: 'adam', operator: true, enabled: true }));
    expect(() => reset(w)).toThrow('demo roster incomplete: rishi, nimisha, sumedh');
    w.enroll();
    expect(() => reset(w, w.bob)).toThrow('unauthorized');
    expect(() => w.asAdmin(ctx => mod.set_demo_member(ctx, { member: erin, slot: 'mallory', operator: false, enabled: true }))).toThrow('unknown slot');
  });

  it('builds the starting board: two nudge-ready pairs, a friend of a friend, and a newcomer everyone can meet', () => {
    const w = world();
    w.enroll();
    reset(w);
    expect(pairsOf(w, w.alice).map(p => p.counterpart_display_name)).toEqual(['Bob']);
    expect(names(pairsOf(w, w.bob), 'counterpart_display_name')).toEqual(['Alice', 'Dave']);
    expect(pairsOf(w, w.carol)).toEqual([]);
    // Adam meets Sumedh through Rishi; Nimisha is nearby for Adam and for herself everyone is.
    expect(view<any>(w, w.alice, mod.fof_cards).map(c => c.via_name)).toEqual(['Bob']);
    expect(names(view<any>(w, w.alice, mod.discovery_cards), 'display_name')).toEqual(['Carol', 'Dave']);
    expect(names(view<any>(w, w.carol, mod.discovery_cards), 'display_name')).toEqual(['Alice', 'Bob', 'Dave']);
    expect(view<any>(w, w.carol, mod.discovery_cards).find(c => c.display_name === 'Alice').shared_tags).toEqual(['coffee', 'live-music', 'hiking']);
    // Every pair has the consent settings a nudge needs, both ways, and a nudge approves.
    const pairId = pairsOf(w, w.alice)[0].pair_id;
    for (const who of [w.alice, w.bob]) {
      expect(view<any>(w, who, mod.my_preset_assignments).find(a => a.pair_id === pairId)?.preset_kind).toBe('friend');
      expect(view<any>(w, who, mod.my_nudge_delivery).find(d => d.pair_id === pairId)?.opted_in).toBe(true);
    }
    const args = approveArgs(w, w.alice, pairId, { support_mode: 'short_call', availability: 'today' }, 'req-demo-1');
    w.call(w.alice, ctx => mod.approve_signal(ctx, args));
    expect(allSignals(w)).toHaveLength(1);
    expect(view<any>(w, w.bob, mod.my_demo_round)[0]).toMatchObject({ slot: 'rishi', round: 1 });
    expect(view<any>(w, w.erin, mod.my_demo_round)).toEqual([]);
  });

  it('a second reset clears what the last judge saw and restores the board; non-demo accounts keep their state', () => {
    const w = world();
    w.enroll();
    // Erin is not in the demo: her pending invite survives every reset.
    w.call(w.erin, ctx => mod.create_pair_invite(ctx, {}));
    reset(w);
    const pairId = pairsOf(w, w.alice)[0].pair_id;
    const args = approveArgs(w, w.alice, pairId, { support_mode: 'short_call' }, 'req-demo-2');
    w.call(w.alice, ctx => mod.approve_signal(ctx, args));
    const sumedhRef = view<any>(w, w.alice, mod.fof_cards)[0].candidate_ref;
    w.call(w.alice, ctx => mod.send_nudge_request(ctx, { candidate_ref: sumedhRef, message: 'hi' }));
    const req = view<any>(w, w.dave, mod.my_nudge_requests)[0];
    w.call(w.dave, ctx => mod.respond_nudge_request(ctx, { request_id: req.request_id, accept: true }));
    expect(pairsOf(w, w.alice)).toHaveLength(2);
    w.call(w.bob, ctx => mod.set_nudge_delivery(ctx, { pair_id: pairId, opted_in: false, quiet_start_minute: undefined, quiet_end_minute: undefined, utc_offset_minutes: 0 }));

    reset(w);
    expect(allSignals(w)).toHaveLength(0);
    expect(view<any>(w, w.dave, mod.my_nudge_requests)).toEqual([]);
    expect(pairsOf(w, w.alice).map(p => p.counterpart_display_name)).toEqual(['Bob']);
    const fresh = pairsOf(w, w.alice)[0].pair_id;
    expect(view<any>(w, w.bob, mod.my_nudge_delivery).find(d => d.pair_id === fresh)?.opted_in).toBe(true);
    expect(view<any>(w, w.alice, mod.fof_cards)).toHaveLength(1);
    expect(view<any>(w, w.alice, mod.my_demo_round)[0].round).toBe(2);
    expect(view<any>(w, w.erin, mod.my_invites)).toHaveLength(1);
  });

  it('observers see the roster and held-nudge times; others see nothing', () => {
    const w = world();
    w.enroll();
    const observer = w.id(w.alice);
    w.asAdmin(ctx => mod.set_observer_identity(ctx, { observer, enabled: true }));
    reset(w);
    const roster = view<any>(w, w.alice, mod.observer_demo_members);
    expect(roster.map(r => r.slot).sort()).toEqual(['adam', 'nimisha', 'rishi', 'sumedh']);
    expect(roster.every(r => r.published && r.area_key === 'berkeley-campus')).toBe(true);
    expect(view<any>(w, w.bob, mod.observer_demo_members)).toEqual([]);
    expect(view<any>(w, w.bob, mod.observer_signal_schedules)).toEqual([]);
  });
});
