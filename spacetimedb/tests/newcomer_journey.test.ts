// README D045 Phase 2 gate (Cyber): the transition-first newcomer journey end to end through direct reducer and
// view calls, with a third account refused at every step. Synthetic identities, tags and events only. In-process
// harness: not deployed isolation, real JWT mapping or a live Apify source.
import { describe, expect, it } from 'vitest';
import { Timestamp } from 'spacetimedb';
import { inDays, jwtAuth, mod, pairUp, setup, view } from './helpers';

type W = ReturnType<typeof setup>;
type Who = W['alice'];
const HOUR_MS = 3_600_000;
const iso = (w: W, offsetMs: number) => new Date(w.h.clock.now().toDate().getTime() + offsetMs).toISOString();

function world() {
  const w = setup();
  const admin = (fn: Parameters<typeof w.h.withReducerTx>[1]) => w.h.withReducerTx(w.admin, fn);
  admin(ctx => mod.set_discovery_config(ctx, { key: 'tags', values: ['new-to-city', 'starting-college', 'hiking', 'board-games'] }));
  admin(ctx => mod.set_discovery_config(ctx, { key: 'areas', values: ['berkeley-campus'] }));
  admin(ctx => mod.set_discovery_config(ctx, { key: 'source_hosts', values: ['lu.ma'] }));
  admin(ctx => mod.set_discovery_config(ctx, { key: 'enabled', values: ['true'] }));
  const worker = jwtAuth('dor-worker', 50n, 'https://worker.spacetimedb.example');
  const workerId = w.h.withReducerTx(worker, ctx => ctx.sender);
  admin(ctx => mod.set_worker_identity(ctx, { worker: workerId, enabled: true }));
  return Object.assign(w, { worker });
}
type EW = ReturnType<typeof world>;
const mine = (w: W, who: Who) => view<any>(w, who, mod.my_discovery_profile)[0];
const refOf = (w: W, who: Who) => mine(w, who).publication_id as string;
function participate(w: W, who: Who, name: string, tags: string[]) {
  const expected_revision = mine(w, who)?.revision ?? 0; // views: outside the transaction
  w.call(who, ctx => mod.publish_discovery_profile(ctx, { display_name: name, interest_tags: tags, audience: 'area_discoverers',
    notice_version: 1, expires_at: inDays(w, 3), expected_revision }));
  w.call(who, ctx => mod.set_discovery_area(ctx, { area_key: 'berkeley-campus' }));
}
const cards = (w: W, who: Who) => view<any>(w, who, mod.discovery_cards);
const intros = (w: W, who: Who) => view<any>(w, who, mod.my_introductions);
const plans = (w: W, who: Who) => view<any>(w, who, mod.my_plans);

describe('already-connected people are not rediscovered', () => {
  it('a linked pair is hidden from each other\'s cards and cannot send each other an introduction', () => {
    const w = world();
    pairUp(w); // alice ↔ bob are an existing pair
    participate(w, w.alice, 'Alice S', ['new-to-city', 'hiking']);
    participate(w, w.bob, 'Bob S', ['new-to-city', 'hiking']);
    participate(w, w.carol, 'Carol S', ['new-to-city']);
    expect(cards(w, w.alice).map(c => c.display_name)).toEqual(['Carol S']);
    expect(cards(w, w.bob).map(c => c.display_name)).toEqual(['Carol S']);
    const bobRef = refOf(w, w.bob);
    expect(() => w.call(w.alice, ctx => mod.send_introduction_request(ctx, { card_ref: bobRef, client_request_id: 'req-pair-0001' })))
      .toThrow('stale: already_connected');
  });

  it('an unlinked pair can find each other again (unlink ends the connection)', () => {
    const w = world();
    const { pairId } = pairUp(w);
    participate(w, w.alice, 'Alice S', ['hiking']);
    participate(w, w.bob, 'Bob S', ['hiking']);
    w.call(w.alice, ctx => mod.unlink_pair(ctx, { pair_id: pairId }));
    expect(cards(w, w.alice).map(c => c.display_name)).toEqual(['Bob S']);
  });
});

describe('newcomer journey: transition → discovery → introduction → response → shared event plan', () => {
  it('two newcomers connect and agree on a source-backed event; a third account is refused at every step', () => {
    const w = world();
    // 1. choose a transition + broad area, publish selected fields
    participate(w, w.alice, 'Alice S', ['new-to-city', 'hiking']);
    participate(w, w.bob, 'Bob S', ['new-to-city', 'board-games']);
    const carolOutsider = jwtAuth('dave', 9n); // registered but never publishes: a lurker
    w.call(carolOutsider, ctx => mod.register_account(ctx, { display_name: 'Dave' }));

    // 2. eligible public profiles: exactly the five projected fields, shared transition as the reason
    const [card] = cards(w, w.alice);
    expect(Object.keys(card).sort()).toEqual(['card_ref', 'display_name', 'interest_tags', 'revision', 'shared_tags']);
    expect(card).toMatchObject({ display_name: 'Bob S', shared_tags: ['new-to-city'] });
    expect(cards(w, carolOutsider)).toHaveLength(0);

    // 3. deliberate in-app introduction; the outsider sees and controls nothing
    w.call(w.alice, ctx => mod.send_introduction_request(ctx, { card_ref: card.card_ref, client_request_id: 'req-intro-0001' }));
    const introId = intros(w, w.bob)[0].intro_id as string;
    expect(intros(w, carolOutsider)).toHaveLength(0);
    expect(() => w.call(carolOutsider, ctx => mod.respond_introduction_request(ctx, { intro_id: introId, accept: true }))).toThrow('not_found: introduction');

    // 4. recipient accepts; no pair, preset or support consent is created
    w.call(w.bob, ctx => mod.respond_introduction_request(ctx, { intro_id: introId, accept: true }));
    expect(intros(w, w.alice)[0]).toMatchObject({ status: 'accepted', counterpart_name: 'Bob S' });
    for (const v of [mod.my_pairs, mod.my_presets, mod.my_support_preferences, mod.my_signals]) {
      expect(view(w, w.alice, v)).toHaveLength(0);
      expect(view(w, w.bob, v)).toHaveLength(0);
    }

    // 5. source-backed event, explicit intents, guarded plan proposal, both accept the same revision
    w.h.withReducerTx(w.admin, ctx => mod.upsert_catalogue_event(ctx, {
      event_id: 'apify:newcomer-hike-1', title: 'Newcomer hike', starts_at: iso(w, 72 * HOUR_MS), ends_at: iso(w, 75 * HOUR_MS),
      status: 'scheduled', fetched_at: iso(w, 0), topics: ['hiking'], format: 'in_person', area_key: 'berkeley-campus',
      source_url: 'https://lu.ma/newcomer-hike',
    }));
    for (const who of [w.alice, w.bob]) w.call(who, ctx => mod.publish_event_intent(ctx, { event_id: 'apify:newcomer-hike-1', kind: 'going', expected_version: 0 }));
    const [cand] = view<any>(w, w.worker, mod.worker_plan_candidates);
    expect(cand).toMatchObject({ basis_kind: 'introduction', basis_ref: introId });
    w.call(w.worker, ctx => mod.commit_plan_proposal(ctx, { plan_id: 'plan-newcomer-0001', basis_kind: cand.basis_kind, basis_ref: cand.basis_ref,
      event_id: cand.event_id, intent_ids: cand.intent_ids, intent_versions: cand.intent_versions, approval_ids: [],
      expires_at: iso(w, 48 * HOUR_MS), decided_by: 'deterministic' }));
    expect(plans(w, carolOutsider)).toHaveLength(0);
    expect(() => w.call(carolOutsider, ctx => mod.respond_plan(ctx, { plan_id: 'plan-newcomer-0001', revision: 1, accept: true }))).toThrow('not_found: plan');
    w.call(w.alice, ctx => mod.respond_plan(ctx, { plan_id: 'plan-newcomer-0001', revision: 1, accept: true }));
    expect(plans(w, w.bob)[0]).toMatchObject({ status: 'pending', my_acceptance: false }); // no early leak of Alice's acceptance
    w.call(w.bob, ctx => mod.respond_plan(ctx, { plan_id: 'plan-newcomer-0001', revision: 1, accept: true }));
    expect(plans(w, w.alice)[0]).toMatchObject({ status: 'confirmed', event_title: 'Newcomer hike', source_url: 'https://lu.ma/newcomer-hike' });
  });

  it('withdrawal before acceptance stops the journey, and a replayed request cannot revive it', () => {
    const w = world();
    participate(w, w.alice, 'Alice S', ['new-to-city']);
    participate(w, w.bob, 'Bob S', ['new-to-city']);
    const bobRef = refOf(w, w.bob);
    w.call(w.alice, ctx => mod.send_introduction_request(ctx, { card_ref: bobRef, client_request_id: 'req-intro-0002' }));
    const introId = intros(w, w.bob)[0].intro_id as string;
    w.call(w.alice, ctx => mod.withdraw_discovery_profile(ctx, {}));
    expect(() => w.call(w.bob, ctx => mod.respond_introduction_request(ctx, { intro_id: introId, accept: true }))).toThrow('stale: not_pending');
    w.call(w.alice, ctx => mod.send_introduction_request(ctx, { card_ref: bobRef, client_request_id: 'req-intro-0002' })); // replay: no-op
    expect(intros(w, w.bob).filter(i => i.status === 'pending')).toHaveLength(0);
  });
});
