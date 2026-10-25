// README D045 Phase 3 gate (Cyber): consent scopes stay independent. Discovery opt-in, event intent, pair support
// consent (D035), C7 activity approval, D041 pause and discovery block can never substitute for one another.
// Direct reducer/view calls; synthetic identities only.
import { describe, expect, it } from 'vitest';
import { approveArgs, confirmPreset, grantPrefs, inDays, jwtAuth, mod, pairUp, setup, view } from './helpers';

type W = ReturnType<typeof setup>;
type Who = W['alice'];
const HOUR_MS = 3_600_000;
const iso = (w: W, offsetMs: number) => new Date(w.h.clock.now().toDate().getTime() + offsetMs).toISOString();

function world() {
  const w = setup();
  const admin = (fn: Parameters<typeof w.h.withReducerTx>[1]) => w.h.withReducerTx(w.admin, fn);
  admin(ctx => mod.set_discovery_config(ctx, { key: 'tags', values: ['new-to-city', 'hiking'] }));
  admin(ctx => mod.set_discovery_config(ctx, { key: 'areas', values: ['berkeley-campus'] }));
  admin(ctx => mod.set_discovery_config(ctx, { key: 'enabled', values: ['true'] }));
  return w;
}
const mine = (w: W, who: Who) => view<any>(w, who, mod.my_discovery_profile)[0];
function participate(w: W, who: Who, name: string) {
  const expected_revision = mine(w, who)?.revision ?? 0;
  w.call(who, ctx => mod.publish_discovery_profile(ctx, { display_name: name, interest_tags: ['new-to-city'], audience: 'area_discoverers',
    notice_version: 1, expires_at: inDays(w, 3), expected_revision }));
  w.call(who, ctx => mod.set_discovery_area(ctx, { area_key: 'berkeley-campus' }));
}
const cards = (w: W, who: Who) => view<any>(w, who, mod.discovery_cards);

describe('pair consent never authorizes discovery', () => {
  it('pair members with presets, approvals and support consent are still invisible to each other in discovery until they publish', () => {
    const w = world();
    const { pairId } = pairUp(w);
    confirmPreset(w, w.alice, pairId, 'partner', ['support_preference']);
    const args = approveArgs(w, w.alice, pairId, { support_mode: 'short_call' });
    w.call(w.alice, ctx => mod.approve_signal(ctx, args));
    grantPrefs(w, w.bob, pairId);
    expect(cards(w, w.alice)).toHaveLength(0);
    expect(cards(w, w.bob)).toHaveLength(0);
    expect(view(w, w.alice, mod.event_companions)).toHaveLength(0);
  });

  it('a stranger\'s pair state never reaches a discoverer, even one in the same area', () => {
    const w = world();
    const { pairId } = pairUp(w);
    confirmPreset(w, w.alice, pairId, 'partner', ['support_preference']);
    participate(w, w.alice, 'Alice S'); participate(w, w.carol, 'Carol S');
    expect(cards(w, w.carol).map(c => c.display_name)).toEqual(['Alice S']);
    for (const v of [mod.my_pairs, mod.my_presets, mod.my_preset_assignments, mod.my_signals, mod.my_support_preferences, mod.my_nudges]) {
      expect(view(w, w.carol, v)).toHaveLength(0);
    }
  });
});

describe('discovery opt-in never authorizes pair sharing', () => {
  it('discovering someone (even after an accepted introduction) gives no right to approve a support signal for them', () => {
    const w = world();
    participate(w, w.alice, 'Alice S'); participate(w, w.bob, 'Bob S');
    const bobRef = mine(w, w.bob).publication_id;
    w.call(w.alice, ctx => mod.send_introduction_request(ctx, { card_ref: bobRef, client_request_id: 'req-indep-0001' }));
    const introId = view<any>(w, w.bob, mod.my_introductions)[0].intro_id;
    w.call(w.bob, ctx => mod.respond_introduction_request(ctx, { intro_id: introId, accept: true }));
    // No pair exists, so there is nothing to approve for: any pair id the caller isn't in is not_found.
    expect(() => w.call(w.alice, ctx => mod.approve_signal(ctx, { pair_id: introId, support_mode: 'short_call', availability: undefined,
      payload_revision: 1, recipient_policy_version: 1, preset_assignment_version: 1, consent_version: 1, client_request_id: 'req-indep-0002' })))
      .toThrow(/^(not_found|invalid|unauthorized|stale):/);
    expect(view(w, w.alice, mod.my_signals)).toHaveLength(0);
    expect(view(w, w.alice, mod.my_pairs)).toHaveLength(0);
  });

  it('an accepted pair with both intents for the same event yields a plan candidate without activity approvals', () => {
    const w = world();
    const { pairId } = pairUp(w);
    w.h.withReducerTx(w.admin, ctx => mod.upsert_catalogue_event(ctx, {
      event_id: 'evt-indep-1', title: 'Hike', starts_at: iso(w, 72 * HOUR_MS), ends_at: undefined, status: 'scheduled', fetched_at: iso(w, 0),
      topics: ['hiking'], format: 'in_person', area_key: 'berkeley-campus', source_url: undefined,
    }));
    for (const who of [w.alice, w.bob]) w.call(who, ctx => mod.publish_event_intent(ctx, { event_id: 'evt-indep-1', kind: 'going', expected_version: 0 }));
    const worker = jwtAuth('dor-worker', 50n, 'https://worker.spacetimedb.example');
    const workerId = w.h.withReducerTx(worker, ctx => ctx.sender);
    w.h.withReducerTx(w.admin, ctx => mod.set_worker_identity(ctx, { worker: workerId, enabled: true }));
    const rows = view<any>(w, worker, mod.worker_plan_candidates);
    expect(rows.map(r => [r.basis_ref, r.approval_ids])).toEqual([[pairId, []]]);
  });
});

describe('support consent, pause and block stay in their own lanes', () => {
  it('recipient support consent (D035) never makes anyone discoverable', () => {
    const w = world();
    const { pairId } = pairUp(w);
    grantPrefs(w, w.bob, pairId);
    participate(w, w.alice, 'Alice S');
    expect(cards(w, w.alice)).toHaveLength(0); // Bob consented to nudges, not to being discovered
  });

  it('a D041 pause leaves discovery untouched and reveals nothing there; a discovery block leaves pair sharing untouched', () => {
    const w = world();
    const { pairId } = pairUp(w);
    confirmPreset(w, w.alice, pairId, 'partner', ['support_preference']);
    participate(w, w.alice, 'Alice S'); participate(w, w.carol, 'Carol S');
    const before = cards(w, w.carol);
    w.call(w.alice, ctx => mod.pause_recipient(ctx, { pair_id: pairId, expires_at: inDays(w, 0.5), expected_version: 0 }));
    expect(cards(w, w.carol)).toEqual(before); // a third party sees no change
    const y = world();
    const pair2 = pairUp(y).pairId;
    confirmPreset(y, y.alice, pair2, 'partner', ['support_preference']);
    participate(y, y.alice, 'Alice S'); participate(y, y.bob, 'Bob S');
    // a linked pair is hidden from discovery (D046), so block via a third person's card to show block stays in discovery
    participate(y, y.carol, 'Carol S');
    const carolRef = mine(y, y.carol).publication_id;
    y.call(y.alice, ctx => mod.block_discovery_user(ctx, { card_ref: carolRef }));
    const args = approveArgs(y, y.alice, pair2, { support_mode: 'short_call' }, 'req-indep-0003');
    y.call(y.alice, ctx => mod.approve_signal(ctx, args)); // pair sharing with Bob unaffected by a discovery block
    expect(view(y, y.alice, mod.my_signals)).toHaveLength(1);
  });
});
