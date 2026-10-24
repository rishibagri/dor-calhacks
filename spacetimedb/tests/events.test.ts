// PROPOSED C7/C8 events, intents, activity approvals and shared-plan finalization (Cyber, CYBER-R3, D039):
// direct reducer and view calls with a third account. Synthetic events, names and tags only. In-process
// harness: no deployed isolation, real Apify source, real scheduler or browser evidence.
import { describe, expect, it } from 'vitest';
import { Timestamp } from 'spacetimedb';
import { confirmPreset, inDays, jwtAuth, mod, pairUp, setup, sweep, view } from './helpers';

type W = ReturnType<typeof setup>;
type Who = W['alice'];
const HOUR_MS = 3_600_000;
const advance = (w: W, ms: number) => w.h.clock.set(new Timestamp(w.h.clock.now().microsSinceUnixEpoch + BigInt(ms) * 1000n));
const iso = (w: W, offsetMs: number) => new Date(w.h.clock.now().toDate().getTime() + offsetMs).toISOString();
const json = (v: unknown) => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? String(x) : x);

function world() {
  const w = setup();
  const admin = (fn: Parameters<typeof w.h.withReducerTx>[1]) => w.h.withReducerTx(w.admin, fn);
  admin(ctx => mod.set_discovery_config(ctx, { key: 'tags', values: ['board-games', 'hiking', 'live-music'] }));
  admin(ctx => mod.set_discovery_config(ctx, { key: 'areas', values: ['berkeley-campus', 'oakland-downtown'] }));
  admin(ctx => mod.set_discovery_config(ctx, { key: 'source_hosts', values: ['events.example.edu'] }));
  admin(ctx => mod.set_discovery_config(ctx, { key: 'enabled', values: ['true'] }));
  const worker = jwtAuth('dor-worker', 50n, 'https://worker.spacetimedb.example');
  const workerId = w.h.withReducerTx(worker, ctx => ctx.sender);
  admin(ctx => mod.set_worker_identity(ctx, { worker: workerId, enabled: true }));
  return Object.assign(w, { worker });
}
type EW = ReturnType<typeof world>;

function upsert(w: W, id = 'evt-hike-1', over: Record<string, unknown> = {}) {
  w.h.withReducerTx(w.admin, ctx => mod.upsert_catalogue_event(ctx, {
    event_id: id, title: 'Saturday hike', starts_at: iso(w, 72 * HOUR_MS), ends_at: iso(w, 75 * HOUR_MS), status: 'scheduled',
    fetched_at: iso(w, 0), topics: ['hiking'], format: 'in_person', area_key: 'berkeley-campus',
    source_url: 'https://events.example.edu/e/1', ...over,
  } as Parameters<typeof mod.upsert_catalogue_event>[1]));
}
const mine = (w: W, who: Who) => view<any>(w, who, mod.my_discovery_profile)[0];
const refOf = (w: W, who: Who) => mine(w, who).publication_id as string;
function participate(w: W, who: Who, name: string, area = 'berkeley-campus') {
  const expected_revision = mine(w, who)?.revision ?? 0;
  w.call(who, ctx => mod.publish_discovery_profile(ctx, { display_name: name, interest_tags: ['hiking'], audience: 'area_discoverers',
    notice_version: 1, expires_at: inDays(w, 7), expected_revision }));
  w.call(who, ctx => mod.set_discovery_area(ctx, { area_key: area }));
}
const intentVersion = (w: W, who: Who, eventId: string) =>
  (view<any>(w, who, mod.my_event_intents).find(i => i.event_id === eventId)?.version ?? 0) as number;
function intend(w: W, who: Who, eventId = 'evt-hike-1', kind = 'going') {
  const expected_version = intentVersion(w, who, eventId);
  w.call(who, ctx => mod.publish_event_intent(ctx, { event_id: eventId, kind, expected_version }));
}
/** Alice and Bob met through an accepted introduction; Carol is a published third account in the same area. */
function introduced() {
  const w = world();
  participate(w, w.alice, 'Alice S'); participate(w, w.bob, 'Bob S'); participate(w, w.carol, 'Carol S');
  const bobRef = refOf(w, w.bob);
  w.call(w.alice, ctx => mod.send_introduction_request(ctx, { card_ref: bobRef, client_request_id: 'intro-request-1' }));
  const introId = view<any>(w, w.bob, mod.my_introductions)[0].intro_id as string;
  w.call(w.bob, ctx => mod.respond_introduction_request(ctx, { intro_id: introId, accept: true }));
  upsert(w);
  intend(w, w.alice); intend(w, w.bob);
  return { w, introId };
}
const candidates = (w: EW) => view<any>(w, w.worker, mod.worker_plan_candidates);
function commitArgs(w: EW, over: Record<string, unknown> = {}) {
  const c = candidates(w)[0];
  return { plan_id: 'plan-0001', basis_kind: c.basis_kind, basis_ref: c.basis_ref, event_id: c.event_id, intent_ids: c.intent_ids,
    intent_versions: c.intent_versions, approval_ids: c.approval_ids, expires_at: iso(w, 48 * HOUR_MS), decided_by: 'deterministic', ...over,
  } as Parameters<typeof mod.commit_plan_proposal>[1];
}
const commit = (w: EW, a: ReturnType<typeof commitArgs>, who: Who = w.worker) => w.call(who, ctx => mod.commit_plan_proposal(ctx, a));
const plans = (w: W, who: Who) => view<any>(w, who, mod.my_plans);
const respond = (w: W, who: Who, accept = true, revision = 1, plan_id = 'plan-0001') =>
  w.call(who, ctx => mod.respond_plan(ctx, { plan_id, revision, accept }));
function planned() {
  const { w, introId } = introduced();
  commit(w, commitArgs(w));
  return { w, introId };
}

describe('catalogue records: server ingestion only, public data, never permission', () => {
  it('only the module owner or the allow-listed worker ingests; users cannot write events', () => {
    const w = world();
    expect(() => w.call(w.alice, ctx => mod.upsert_catalogue_event(ctx, {
      event_id: 'evt-x', title: 'x', starts_at: iso(w, HOUR_MS), ends_at: undefined, status: 'scheduled', fetched_at: iso(w, 0),
      topics: ['hiking'], format: 'online', area_key: undefined, source_url: undefined,
    }))).toThrow('unauthorized: ingester only');
    w.call(w.worker, ctx => mod.upsert_catalogue_event(ctx, {
      event_id: 'evt-online', title: 'Online games night', starts_at: iso(w, 24 * HOUR_MS), ends_at: undefined, status: 'scheduled',
      fetched_at: iso(w, 0), topics: ['board-games'], format: 'online', area_key: undefined, source_url: undefined,
    }));
  });

  it('normalizes untrusted records: markup stripped, topics/areas allowlisted, unsafe links and rollbacks refused', () => {
    const w = world();
    upsert(w, 'evt-1', { title: '<script>alert(1)</script> Hike‮' });
    const row = view<any>(w, w.alice, mod.catalogue_events)[0];
    expect(row.title).not.toMatch(/[<>‮]/);
    expect(() => upsert(w, 'evt-2', { topics: ['support-group'] })).toThrow('invalid: topic_not_allowlisted');
    expect(() => upsert(w, 'evt-2', { area_key: 'mission-district' })).toThrow('invalid: area_not_allowlisted');
    expect(() => upsert(w, 'evt-2', { source_url: 'http://events.example.edu/e/2' })).toThrow('invalid: unsafe_source_url');
    expect(() => upsert(w, 'evt-2', { source_url: 'https://evil.example.com/e/2' })).toThrow('invalid: unsafe_source_url');
    expect(() => upsert(w, 'evt-2', { format: 'online' })).toThrow('invalid: invalid_schema'); // online with an area
    expect(() => upsert(w, 'evt-2', { starts_at: iso(w, 90 * 24 * HOUR_MS) })).toThrow('invalid: too_far_ahead');
    expect(() => upsert(w, 'evt-1', { fetched_at: iso(w, -HOUR_MS) })).toThrow('stale: older_fetch');
  });

  it('the public catalogue view: registered callers only, usable records only, no user data joined', () => {
    const w = world();
    upsert(w, 'evt-ok'); upsert(w, 'evt-cancelled', { status: 'cancelled' }); upsert(w, 'evt-soon', { starts_at: iso(w, HOUR_MS / 2), ends_at: iso(w, HOUR_MS) });
    const anon = jwtAuth('nobody', 99n);
    expect(view(w, anon, mod.catalogue_events)).toHaveLength(0);
    let rows = view<any>(w, w.alice, mod.catalogue_events);
    expect(rows.map(r => r.event_id).sort()).toEqual(['evt-ok', 'evt-soon']);
    expect(Object.keys(rows[0]).sort()).toEqual(['area_key', 'ends_at', 'event_id', 'fetched_at', 'format', 'source_url', 'starts_at', 'title', 'topics']);
    advance(w, HOUR_MS); sweep(w);
    expect(view<any>(w, w.alice, mod.catalogue_events).map(r => r.event_id)).toEqual(['evt-ok']); // started
    advance(w, 48 * HOUR_MS); sweep(w);
    rows = view<any>(w, w.alice, mod.catalogue_events);
    expect(rows).toHaveLength(0); // our copy is older than 48 h: not shown as current
  });
});

describe('event intents (C8): explicit, current events only, mutual visibility only', () => {
  it('intent needs a scheduled, fresh, not-started event; it ends with the event', () => {
    const w = world();
    upsert(w); upsert(w, 'evt-cancelled', { status: 'cancelled' }); upsert(w, 'evt-old', { fetched_at: iso(w, -49 * HOUR_MS) });
    expect(() => intend(w, w.alice, 'evt-missing')).toThrow('not_found: event_not_found');
    expect(() => intend(w, w.alice, 'evt-cancelled')).toThrow('stale: event_cancelled');
    expect(() => intend(w, w.alice, 'evt-old')).toThrow('stale: source_stale');
    expect(() => w.call(w.alice, ctx => mod.publish_event_intent(ctx, { event_id: 'evt-hike-1', kind: 'attending-with-bob', expected_version: 0 }))).toThrow('invalid: invalid_schema');
    intend(w, w.alice);
    expect(() => w.call(w.alice, ctx => mod.publish_event_intent(ctx, { event_id: 'evt-hike-1', kind: 'going', expected_version: 0 }))).toThrow('stale: stale_revision');
    const [i] = view<any>(w, w.alice, mod.my_event_intents);
    expect(i.expires_at.toDate().getTime()).toBe(Date.parse(iso(w, 75 * HOUR_MS)));
    advance(w, 75 * HOUR_MS); sweep(w);
    expect(view(w, w.alice, mod.my_event_intents)).toHaveLength(0);
  });

  it('you see someone\'s intent only for an event you marked too, only if you can see their card; kind is never shown', () => {
    const w = world();
    participate(w, w.alice, 'Alice S'); participate(w, w.bob, 'Bob S'); participate(w, w.carol, 'Carol S', 'oakland-downtown');
    upsert(w); upsert(w, 'evt-music', { topics: ['live-music'] });
    intend(w, w.bob); intend(w, w.carol);
    intend(w, w.alice, 'evt-music');
    expect(view(w, w.alice, mod.event_companions)).toHaveLength(0); // alice did not mark the hike
    intend(w, w.alice, 'evt-hike-1', 'interested');
    const rows = view<any>(w, w.alice, mod.event_companions);
    expect(rows).toEqual([{ card_ref: refOf(w, w.bob), event_id: 'evt-hike-1' }]); // carol is in another area
    expect(json(rows)).not.toMatch(/going|interested/);
    w.call(w.bob, ctx => mod.revoke_event_intent(ctx, { event_id: 'evt-hike-1' }));
    expect(view(w, w.alice, mod.event_companions)).toHaveLength(0);
  });

  it('a block hides event overlap both ways', () => {
    const w = world();
    participate(w, w.alice, 'Alice S'); participate(w, w.bob, 'Bob S');
    upsert(w); intend(w, w.alice); intend(w, w.bob);
    const bobRef = refOf(w, w.bob);
    w.call(w.alice, ctx => mod.block_discovery_user(ctx, { card_ref: bobRef }));
    expect(view(w, w.alice, mod.event_companions)).toHaveLength(0);
    expect(view(w, w.bob, mod.event_companions)).toHaveLength(0);
  });
});

describe('worker plan inputs and commit guard', () => {
  it('only the worker sees plan candidates: opaque ids, topics and times, no names, identities or titles', () => {
    const { w } = introduced();
    expect(view(w, w.alice, mod.worker_plan_candidates)).toHaveLength(0);
    const rows = candidates(w);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(['approval_ids', 'basis_kind', 'basis_ref', 'event_id', 'event_starts_at', 'fetched_at',
      'format', 'intent_ids', 'intent_versions', 'topics']);
    expect(json(rows)).not.toMatch(/Alice|Bob|Saturday|example\.edu|identity/);
  });

  it('non-worker, stale intent version, a non-participant\'s intent, unaccepted basis and lead time are refused', () => {
    const { w } = introduced();
    const a = commitArgs(w);
    expect(() => commit(w, a, w.alice)).toThrow('unauthorized: worker only');
    intend(w, w.carol);
    const carolIntent = w.h.withReducerTx(w.admin, ctx => [...ctx.db.event_intent.iter()].find(i => i.owner.isEqual(ctx.sender) === false &&
      !a.intent_ids.includes(i.intent_id))!.intent_id);
    expect(() => commit(w, { ...a, intent_ids: [a.intent_ids[0]!, carolIntent], intent_versions: [a.intent_versions[0]!, 1] })).toThrow('stale: intent_not_current');
    expect(() => commit(w, { ...a, approval_ids: ['x', 'y'] })).toThrow('invalid: invalid_schema');
    expect(() => commit(w, { ...a, basis_kind: 'existing_connection' })).toThrow('stale: basis_not_current');
    intend(w, w.alice, 'evt-hike-1', 'interested'); // version bump during generation
    expect(() => commit(w, a)).toThrow('stale: intent_not_current');
    const fresh = commitArgs(w);
    upsert(w, 'evt-hike-1', { starts_at: iso(w, HOUR_MS / 2), ends_at: iso(w, HOUR_MS), fetched_at: iso(w, 1) });
    expect(() => commit(w, fresh)).toThrow('stale: lead_time');
  });

  it('times come from the catalogue (≤ 48 h, ≥ 1 h before start); replay is idempotent; one live plan per event and pair', () => {
    const { w } = introduced();
    const a = commitArgs(w, { expires_at: iso(w, 30 * 24 * HOUR_MS) });
    commit(w, a);
    commit(w, a);
    const [p] = plans(w, w.alice);
    expect(p.expires_at.toDate().getTime()).toBe(Date.parse(iso(w, 48 * HOUR_MS)));
    expect(() => commit(w, { ...a, plan_id: 'plan-0002' })).toThrow('stale: already_planned');
    expect(() => commit(w, { ...a, event_id: 'evt-other' })).toThrow('invalid: plan_id reused');
  });

  it('a withdrawn intent or a block during generation refuses the commit', () => {
    for (const race of [
      (w: EW) => w.call(w.bob, ctx => mod.revoke_event_intent(ctx, { event_id: 'evt-hike-1' })),
      (w: EW) => { const id = view<any>(w, w.bob, mod.my_introductions)[0].intro_id; w.call(w.bob, ctx => mod.block_introduction_participant(ctx, { intro_id: id })); },
    ]) {
      const { w } = introduced();
      const a = commitArgs(w);
      race(w);
      expect(() => commit(w, a)).toThrow(/^(stale|not_found):/);
      expect(plans(w, w.alice)).toHaveLength(0);
    }
  });
});

describe('finalization: both accept the same current revision while every source holds', () => {
  it('confirms only after both accept; neither sees the other\'s acceptance before that', () => {
    const { w } = planned();
    respond(w, w.alice);
    expect(plans(w, w.alice)[0]).toMatchObject({ status: 'pending', my_acceptance: true });
    expect(plans(w, w.bob)[0]).toMatchObject({ status: 'pending', my_acceptance: false }); // no "Alice accepted" leak
    respond(w, w.bob);
    expect(plans(w, w.alice)[0]).toMatchObject({ status: 'confirmed', counterpart_name: 'Bob S', event_title: 'Saturday hike' });
    expect(plans(w, w.bob)[0]).toMatchObject({ status: 'confirmed', counterpart_name: 'Alice S' });
    expect(() => respond(w, w.alice)).toThrow('stale: closed');
  });

  it('a third account and a wrong revision are refused; a repeat accept is refused', () => {
    const { w } = planned();
    expect(() => respond(w, w.carol)).toThrow('not_found: plan');
    expect(() => w.call(w.carol, ctx => mod.cancel_plan(ctx, { plan_id: 'plan-0001' }))).toThrow('not_found: plan');
    expect(plans(w, w.carol)).toHaveLength(0);
    expect(() => respond(w, w.alice, true, 2)).toThrow('stale: stale_revision');
    respond(w, w.alice);
    expect(() => respond(w, w.alice)).toThrow('stale: already_accepted');
  });

  it('one-sided acceptance never confirms; the plan lapses', () => {
    const { w } = planned();
    respond(w, w.alice);
    advance(w, 48 * HOUR_MS); sweep(w);
    expect(plans(w, w.alice)[0].status).toBe('expired');
    expect(() => respond(w, w.bob)).toThrow('stale: expired');
  });

  it('revoke-after-first-accept: an intent withdrawn after one acceptance refuses the second', () => {
    const { w } = planned();
    respond(w, w.alice);
    w.call(w.alice, ctx => mod.revoke_event_intent(ctx, { event_id: 'evt-hike-1' }));
    expect(() => respond(w, w.bob)).toThrow('stale: stale_source');
    expect(plans(w, w.bob)[0].status).toBe('stale');
    w.call(w.bob, ctx => mod.cancel_plan(ctx, { plan_id: 'plan-0001' })); // a stale plan can still be closed out
    expect(plans(w, w.bob)[0].status).toBe('cancelled');
    expect(plans(w, w.alice)[0].status).toBe('closed');
  });

  it('revoking and re-publishing an intent never revives a plan bound to the old version', () => {
    const { w } = planned();
    respond(w, w.alice);
    w.call(w.bob, ctx => mod.revoke_event_intent(ctx, { event_id: 'evt-hike-1' }));
    intend(w, w.bob);
    expect(() => respond(w, w.bob)).toThrow('stale: stale_source');
    expect(plans(w, w.alice)[0].status).toBe('stale');
  });

  it('a block, a cancelled event or a stale catalogue copy after the first acceptance refuses the second', () => {
    const cases: [(w: EW) => void, string, ((w: EW) => void)?][] = [
      [w => { const id = view<any>(w, w.bob, mod.my_introductions)[0].intro_id; w.call(w.alice, ctx => mod.block_introduction_participant(ctx, { intro_id: id })); }, 'stale: stale_source'],
      [w => upsert(w, 'evt-hike-1', { status: 'cancelled', fetched_at: iso(w, 1) }), 'stale: stale_source'],
      // the ingester stops refreshing: our copy passes 48 h before the plan lapses
      [w => advance(w, 47 * HOUR_MS), 'stale: stale_source', w => advance(w, 2 * HOUR_MS)],
      [w => intend(w, w.bob, 'evt-hike-1', 'interested'), 'stale: stale_source'],
    ];
    for (const [race, error, before] of cases) {
      const { w } = introduced();
      before?.(w);
      commit(w, commitArgs(w));
      respond(w, w.alice);
      race(w);
      expect(() => respond(w, w.bob)).toThrow(error);
    }
  });

  it('a moved event needs a new revision; old acceptances and the old revision no longer count', () => {
    const { w } = planned();
    respond(w, w.alice);
    upsert(w, 'evt-hike-1', { starts_at: iso(w, 96 * HOUR_MS), ends_at: iso(w, 99 * HOUR_MS), fetched_at: iso(w, 1) });
    expect(() => respond(w, w.bob)).toThrow('stale: stale_source');
    expect(() => w.call(w.alice, ctx => mod.revise_plan_proposal(ctx, { plan_id: 'plan-0001', expected_revision: 1, expires_at: iso(w, 40 * HOUR_MS) }))).toThrow('unauthorized: worker only');
    w.call(w.worker, ctx => mod.revise_plan_proposal(ctx, { plan_id: 'plan-0001', expected_revision: 1, expires_at: iso(w, 40 * HOUR_MS) }));
    expect(plans(w, w.alice)[0]).toMatchObject({ revision: 2, my_acceptance: false, status: 'pending' });
    expect(() => respond(w, w.bob, true, 1)).toThrow('stale: stale_revision');
    respond(w, w.bob, true, 2); respond(w, w.alice, true, 2);
    expect(plans(w, w.bob)[0].status).toBe('confirmed');
  });

  it('a decline is shown only to the person who declined; the other sees "closed"', () => {
    const { w } = planned();
    respond(w, w.alice);
    respond(w, w.bob, false);
    expect(plans(w, w.bob)[0].status).toBe('declined');
    expect(plans(w, w.alice)[0].status).toBe('closed');
    expect(() => respond(w, w.bob, true)).toThrow('stale: closed');
  });
});

describe('C7 activity approvals for existing pairs', () => {
  function pairWorld({ category = true } = {}) {
    const w = world();
    const { pairId } = pairUp(w);
    const cats = category ? ['support_preference', 'activity_interest'] : ['support_preference'];
    confirmPreset(w, w.alice, pairId, 'friend', cats);
    confirmPreset(w, w.bob, pairId, 'friend', cats);
    upsert(w);
    return { w, pairId };
  }
  const versions = (w: W, who: Who, pairId: string) => {
    const asg = view<any>(w, who, mod.my_preset_assignments).find(a => a.pair_id === pairId);
    const preset = view<any>(w, who, mod.my_presets).find(p => p.policy_id === asg.preset_id);
    return { expected_policy_version: preset.version as number, expected_assignment_version: asg.assignment_version as number };
  };
  function approve(w: W, who: Who, pairId: string, over: Record<string, unknown> = {}, id = `activity-${Math.random().toString(36).slice(2, 10)}`) {
    const v = versions(w, who, pairId);
    w.call(who, ctx => mod.approve_activity_interest(ctx, { pair_id: pairId, topics: ['hiking'], ...v, consent_version: 1,
      client_request_id: id, ...over } as Parameters<typeof mod.approve_activity_interest>[1]));
  }

  it('off by default: without the preset category, approval is refused; the quiz/preset defaults never enable it', () => {
    const { w, pairId } = pairWorld({ category: false });
    expect(() => approve(w, w.alice, pairId)).toThrow('unauthorized: no_preset_category');
  });

  it('approval binds preset versions, allowlisted topics and the notice; outsiders and the recipient never see it', () => {
    const { w, pairId } = pairWorld();
    expect(() => approve(w, w.alice, pairId, { expected_policy_version: 99 })).toThrow('stale: stale_revision');
    expect(() => approve(w, w.alice, pairId, { topics: ['support-group'] })).toThrow('invalid: topic_not_allowlisted');
    expect(() => approve(w, w.alice, pairId, { consent_version: 0 })).toThrow('stale: stale_revision');
    expect(() => w.call(w.carol, ctx => mod.approve_activity_interest(ctx, { pair_id: pairId, topics: ['hiking'], expected_policy_version: 1,
      expected_assignment_version: 1, consent_version: 1, client_request_id: 'activity-carol-1' }))).toThrow('not_found: pair');
    approve(w, w.alice, pairId);
    expect(view(w, w.alice, mod.my_activity_approvals)).toHaveLength(1);
    expect(view(w, w.bob, mod.my_activity_approvals)).toHaveLength(0);
    expect(view(w, w.alice, mod.my_signals)).toHaveLength(0); // never a C3 signal
  });

  it('a pair plan needs both people\'s current approvals; revoking one after the first acceptance refuses the second', () => {
    const { w, pairId } = pairWorld();
    approve(w, w.alice, pairId); approve(w, w.bob, pairId);
    intend(w, w.alice); intend(w, w.bob);
    const c = candidates(w);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ basis_kind: 'existing_connection', basis_ref: pairId });
    expect(c[0].approval_ids).toHaveLength(2);
    commit(w, commitArgs(w));
    respond(w, w.alice);
    const approvalId = view<any>(w, w.alice, mod.my_activity_approvals)[0].approval_id;
    w.call(w.alice, ctx => mod.revoke_activity_interest(ctx, { approval_id: approvalId }));
    expect(() => respond(w, w.bob)).toThrow('stale: stale_source');
    expect(plans(w, w.bob)[0]).toMatchObject({ status: 'stale', counterpart_name: 'Alice' });
  });

  it('tightening the preset (removing the category) invalidates approvals and plans', () => {
    const { w, pairId } = pairWorld();
    approve(w, w.alice, pairId); approve(w, w.bob, pairId);
    intend(w, w.alice); intend(w, w.bob);
    commit(w, commitArgs(w));
    confirmPreset(w, w.bob, pairId, 'friend', ['support_preference']);
    expect(() => respond(w, w.alice)).toThrow('stale: stale_source');
    expect(candidates(w)).toHaveLength(0);
  });

  it('a revoked approval or a discovery block during generation refuses a pair plan commit', () => {
    for (const race of ['revoke', 'block'] as const) {
      const { w, pairId } = pairWorld();
      approve(w, w.alice, pairId); approve(w, w.bob, pairId);
      intend(w, w.alice); intend(w, w.bob);
      const a = commitArgs(w);
      if (race === 'revoke') {
        const id = view<any>(w, w.alice, mod.my_activity_approvals)[0].approval_id;
        w.call(w.alice, ctx => mod.revoke_activity_interest(ctx, { approval_id: id }));
        expect(() => commit(w, a)).toThrow('stale: approval_not_current');
      } else {
        participate(w, w.alice, 'Alice S'); participate(w, w.bob, 'Bob S');
        const bobRef = refOf(w, w.bob);
        w.call(w.alice, ctx => mod.block_discovery_user(ctx, { card_ref: bobRef }));
        expect(() => commit(w, a)).toThrow('not_found: blocked');
        expect(candidates(w)).toHaveLength(0);
      }
    }
  });

  it('one person\'s approval alone never produces a pair plan candidate', () => {
    const { w, pairId } = pairWorld();
    approve(w, w.alice, pairId);
    intend(w, w.alice); intend(w, w.bob);
    expect(candidates(w)).toHaveLength(0);
  });
});
