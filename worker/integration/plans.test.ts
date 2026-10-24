// AI-R3 plan path over the REAL module in-process (Cyber's D039 reducers, views and guards): the built worker
// reads worker_plan_candidates, runs the bounded PlanCoordinator and commits through commit_plan_proposal.
// Synthetic: accounts, events, tags and the Droid subprocess (scripted). Offline evidence only; no published
// module, deployed worker, real Apify source or live model call.
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { DroidRunner, PlanWatcher, classifyPlanCommitError, groupPlanBases, mapRows, runPlanJob, toPlanCandidate,
  type WorkerStateSource } from '../dist/index.js';
import { inDays, jwtAuth, mod, setup, view, type World } from '../../spacetimedb/tests/helpers';

const HOUR_MS = 3_600_000;
type Who = World['alice'];
const iso = (w: World, offsetMs: number) => new Date(w.h.clock.now().toDate().getTime() + offsetMs).toISOString();

function world() {
  const w = setup();
  const admin = (fn: Parameters<typeof w.h.withReducerTx>[1]) => w.h.withReducerTx(w.admin, fn);
  admin(ctx => mod.set_discovery_config(ctx, { key: 'tags', values: ['board-games', 'hiking', 'live-music'] }));
  admin(ctx => mod.set_discovery_config(ctx, { key: 'areas', values: ['berkeley-campus'] }));
  admin(ctx => mod.set_discovery_config(ctx, { key: 'source_hosts', values: ['events.example.edu'] }));
  admin(ctx => mod.set_discovery_config(ctx, { key: 'enabled', values: ['true'] }));
  const worker = jwtAuth('dor-worker', 50n, 'https://worker.spacetimedb.example');
  const workerId = w.h.withReducerTx(worker, ctx => ctx.sender);
  admin(ctx => mod.set_worker_identity(ctx, { worker: workerId, enabled: true }));
  return Object.assign(w, { worker });
}
type EW = ReturnType<typeof world>;

function upsert(w: World, id: string, startsInHours: number, topics = ['hiking']) {
  w.h.withReducerTx(w.admin, ctx => mod.upsert_catalogue_event(ctx, {
    event_id: id, title: `Synthetic ${id}`, starts_at: iso(w, startsInHours * HOUR_MS), ends_at: iso(w, (startsInHours + 3) * HOUR_MS),
    status: 'scheduled', fetched_at: iso(w, 0), topics, format: 'in_person', area_key: 'berkeley-campus',
    source_url: `https://events.example.edu/e/${id}`,
  } as Parameters<typeof mod.upsert_catalogue_event>[1]));
}
const mine = (w: World, who: Who) => view<any>(w, who, mod.my_discovery_profile)[0];
function participate(w: World, who: Who, name: string) {
  const expected_revision = mine(w, who)?.revision ?? 0; // read views outside the reducer tx
  w.call(who, ctx => mod.publish_discovery_profile(ctx, { display_name: name, interest_tags: ['hiking'], audience: 'area_discoverers',
    notice_version: 1, expires_at: inDays(w, 7), expected_revision }));
  w.call(who, ctx => mod.set_discovery_area(ctx, { area_key: 'berkeley-campus' }));
}
function intend(w: World, who: Who, eventId: string) {
  const expected_version = (view<any>(w, who, mod.my_event_intents).find(i => i.event_id === eventId)?.version ?? 0) as number;
  w.call(who, ctx => mod.publish_event_intent(ctx, { event_id: eventId, kind: 'going', expected_version }));
}
/** Alice and Bob met through an accepted introduction and both intend each listed event; Carol is a bystander. */
function introduced(events: [string, number][] = [['evt-hike-1', 72]]) {
  const w = world();
  participate(w, w.alice, 'Alice S'); participate(w, w.bob, 'Bob S'); participate(w, w.carol, 'Carol S');
  const bobRef = mine(w, w.bob).publication_id as string;
  w.call(w.alice, ctx => mod.send_introduction_request(ctx, { card_ref: bobRef, client_request_id: 'intro-request-1' }));
  const introId = view<any>(w, w.bob, mod.my_introductions)[0].intro_id as string;
  w.call(w.bob, ctx => mod.respond_introduction_request(ctx, { intro_id: introId, accept: true }));
  for (const [id, hours] of events) { upsert(w, id, hours); intend(w, w.alice, id); intend(w, w.bob, id); }
  return w;
}

/** The worker's view of the module, called as `who`; `beforeCommit` runs just before the reducer (races). */
function source(w: EW, who: Who = w.worker, hooks: { beforeCommit?: () => void } = {}): WorkerStateSource {
  return {
    signalContext: async () => [], delivery: async () => [], commitNudge: async () => { throw new Error('unused'); },
    planCandidates: async () => view(w, who, mod.worker_plan_candidates),
    commitPlanProposal: async args => {
      hooks.beforeCommit?.();
      w.call(who, ctx => mod.commit_plan_proposal(ctx, args));
    },
  };
}

/** SYNTHETIC Droid subprocess; `during` runs while the "model" is thinking. */
function scriptedRunner(reply: string, during?: () => void) {
  let calls = 0;
  const spawn = (() => {
    calls++;
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
    queueMicrotask(() => {
      during?.();
      child.stderr.end();
      child.stdout.end(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: reply }));
      child.stdout.on('end', () => child.emit('close', 0));
    });
    return child;
  }) as never;
  return { runner: new DroidRunner({ spawn, env: {} }), calls: () => calls };
}

function watcher(w: EW, src: WorkerStateSource, runner: DroidRunner) {
  const outcomes: string[] = [], errors: string[] = [];
  const pw = new PlanWatcher(src, {
    run: basis => runPlanJob(basis, { source: src, runner, clock: { now: () => w.h.clock.now().toDate() } }),
    onOutcome: o => outcomes.push(o.outcome), onError: e => errors.push(e instanceof Error ? e.message : String(e)),
  });
  return { pw, outcomes, errors };
}

describe('worker_plan_candidates → PlanCoordinator → commit_plan_proposal, over the real module', () => {
  it('one mutual event: zero model calls, one pending plan both participants see at revision 1, none for Carol', async () => {
    const w = introduced();
    const droid = scriptedRunner('{"decision":"none"}');
    const { pw, outcomes, errors } = watcher(w, source(w), droid.runner);
    expect(await pw.sweep()).toBe(1);
    expect(errors).toEqual([]);
    expect(outcomes).toEqual(['proposed']);
    expect(droid.calls()).toBe(0);
    for (const who of [w.alice, w.bob]) {
      const [plan] = view<any>(w, who, mod.my_plans);
      expect(plan).toMatchObject({ event_id: 'evt-hike-1', revision: 1, status: 'pending', my_acceptance: false });
      expect(plan.plan_id).toMatch(/^plan_[0-9a-f]{32}$/);
    }
    expect(view(w, w.carol, mod.my_plans)).toHaveLength(0);
    // Unchanged intents: the next sweep starts no job.
    expect(await pw.sweep()).toBe(0);
  });

  it('a restarted worker re-commits the same plan_id, which the reducer treats as a no-op', async () => {
    const w = introduced();
    await watcher(w, source(w), scriptedRunner('{}').runner).pw.sweep();
    const restarted = watcher(w, source(w), scriptedRunner('{}').runner);
    await restarted.pw.sweep();
    expect(restarted.errors).toEqual([]);
    expect(restarted.outcomes).toEqual(['proposed']);
    expect(view(w, w.alice, mod.my_plans)).toHaveLength(1);
  });

  it('two mutual events: one model call chooses among options only it was given; the plan binds that event', async () => {
    const w = introduced([['evt-hike-1', 72], ['evt-hike-2', 96]]);
    const droid = scriptedRunner('{"decision":"suggest","eventIndex":1}');
    const { pw, outcomes } = watcher(w, source(w), droid.runner);
    await pw.sweep();
    expect(droid.calls()).toBe(1);
    expect(outcomes).toEqual(['proposed']);
    expect(view<any>(w, w.bob, mod.my_plans).map(p => p.event_id)).toEqual(['evt-hike-2']);
  });

  it('an out-of-range model reply is repaired once, then the labeled fallback uses the soonest event', async () => {
    const w = introduced([['evt-hike-1', 72], ['evt-hike-2', 96]]);
    const droid = scriptedRunner('{"decision":"suggest","eventIndex":7}');
    const { pw, outcomes } = watcher(w, source(w), droid.runner);
    await pw.sweep();
    expect(droid.calls()).toBe(2);
    expect(outcomes).toEqual(['proposer_failed_fallback']);
    expect(view<any>(w, w.alice, mod.my_plans).map(p => p.event_id)).toEqual(['evt-hike-1']);
  });

  it('job budget already spent: no droid spawn, the labeled fallback still commits only a current plan', async () => {
    const w = introduced([['evt-hike-1', 72], ['evt-hike-2', 96]]);
    const droid = scriptedRunner('{"decision":"suggest","eventIndex":1}');
    const [basis] = groupPlanBases(mapRows(await source(w).planCandidates!(), toPlanCandidate));
    const outcome = await runPlanJob(basis!, { source: source(w), runner: droid.runner, deadlineMs: 0,
      clock: { now: () => w.h.clock.now().toDate() } });
    expect(droid.calls()).toBe(0);
    expect(outcome).toMatchObject({ outcome: 'proposer_failed_fallback', decidedBy: 'fixed_template', modelCalls: 2 });
    expect(view<any>(w, w.alice, mod.my_plans).map(p => p.event_id)).toEqual(['evt-hike-1']);
  });

  it('intent withdrawn while the model runs: recheck reports not_current and nothing is committed', async () => {
    const w = introduced([['evt-hike-1', 72], ['evt-hike-2', 96]]);
    const droid = scriptedRunner('{"decision":"suggest","eventIndex":0}',
      () => w.call(w.bob, ctx => mod.revoke_event_intent(ctx, { event_id: 'evt-hike-1' })));
    const { pw, outcomes } = watcher(w, source(w), droid.runner);
    await pw.sweep();
    expect(outcomes).toEqual(['not_current']);
    expect(view(w, w.alice, mod.my_plans)).toHaveLength(0);
  });

  it('intent re-published while the model runs: the adapter recheck catches the new version before any commit', async () => {
    const w = introduced([['evt-hike-1', 72], ['evt-hike-2', 96]]);
    let commits = 0;
    const src = source(w, w.worker, { beforeCommit: () => { commits++; } });
    const droid = scriptedRunner('{"decision":"suggest","eventIndex":0}', () => intend(w, w.alice, 'evt-hike-1'));
    const { pw, outcomes } = watcher(w, src, droid.runner);
    await pw.sweep();
    expect(outcomes).toEqual(['not_current']);
    expect(commits).toBe(0);
  });

  it('intent re-published after the recheck: the reducer refuses the old version and the job records not_current', async () => {
    const w = introduced();
    let raced = false;
    const src = source(w, w.worker, { beforeCommit: () => { if (!raced) { raced = true; intend(w, w.bob, 'evt-hike-1'); } } });
    const { pw, outcomes, errors } = watcher(w, src, scriptedRunner('{}').runner);
    await pw.sweep();
    expect(errors).toEqual([]);
    expect(outcomes).toEqual(['not_current']);
    expect(view(w, w.bob, mod.my_plans)).toHaveLength(0);
    // The new version is a new fingerprint: the next sweep proposes against it.
    await pw.sweep();
    expect(outcomes).toEqual(['not_current', 'proposed']);
    expect(view(w, w.bob, mod.my_plans)).toHaveLength(1);
  });

  it('a non-worker identity sees no candidates, and a commit it attempts is a thrown deployment fault, not a recorded outcome', async () => {
    const w = introduced();
    expect(view(w, w.alice, mod.worker_plan_candidates)).toHaveLength(0);
    const asAlice = source(w, w.alice);
    const { pw, errors } = watcher(w, asAlice, scriptedRunner('{}').runner);
    expect(await pw.sweep()).toBe(0);
    const args = { plan_id: 'plan_forged_0001', basis_kind: 'introduction', basis_ref: 'x', event_id: 'evt-hike-1',
      intent_ids: ['a', 'b'], intent_versions: [1, 1], approval_ids: [], expires_at: iso(w, HOUR_MS), decided_by: 'agent' };
    let thrown: unknown;
    try { await asAlice.commitPlanProposal!(args); } catch (e) { thrown = e; }
    expect(classifyPlanCommitError(thrown)).toBeNull();
    expect(errors).toEqual([]);
  });

  it('discovery switched off: the view is empty, so the worker spends nothing', async () => {
    const w = introduced();
    w.h.withReducerTx(w.admin, ctx => mod.set_discovery_config(ctx, { key: 'enabled', values: [] }));
    const droid = scriptedRunner('{}');
    expect(await watcher(w, source(w), droid.runner).pw.sweep()).toBe(0);
    expect(droid.calls()).toBe(0);
  });

  it('existing pair without C7 activity approvals is not a plan basis', async () => {
    const w = world();
    w.call(w.alice, ctx => mod.create_pair_invite(ctx, {}));
    const invite = view<any>(w, w.alice, mod.my_invites)[0];
    w.call(w.bob, ctx => mod.accept_pair_invite(ctx, { invite_token: invite.invite_token }));
    participate(w, w.alice, 'Alice S'); participate(w, w.bob, 'Bob S');
    upsert(w, 'evt-hike-1', 72); intend(w, w.alice, 'evt-hike-1'); intend(w, w.bob, 'evt-hike-1');
    expect(view(w, w.worker, mod.worker_plan_candidates)).toHaveLength(0);
  });
});
