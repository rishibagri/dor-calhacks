// D048 viewer-initiated suggestions over the REAL module in-process: request_introduction_suggestion →
// worker_introduction_requests → IntroductionRequestWatcher → runIntroductionRequest → commit_introduction_proposal →
// close_introduction_suggestion_request, then the viewer sends a real introduction from the suggestion.
// Synthetic: accounts, tags and the Droid subprocess (scripted). Offline evidence only: no provider call.
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { Timestamp } from 'spacetimedb';
import { DroidRunner, IntroductionRequestWatcher, runIntroductionRequest, type WorkerStateSource } from '../dist/index.js';
import { inDays, jwtAuth, mod, setup, view, type World } from '../../spacetimedb/tests/helpers';

type Who = World['alice'];

function world() {
  const w = setup();
  const admin = (fn: Parameters<typeof w.h.withReducerTx>[1]) => w.h.withReducerTx(w.admin, fn);
  admin(ctx => mod.set_discovery_config(ctx, { key: 'tags', values: ['board-games', 'hiking', 'live-music'] }));
  admin(ctx => mod.set_discovery_config(ctx, { key: 'areas', values: ['berkeley-campus'] }));
  admin(ctx => mod.set_discovery_config(ctx, { key: 'enabled', values: ['true'] }));
  const worker = jwtAuth('dor-worker', 50n, 'https://worker.spacetimedb.example');
  const workerId = w.h.withReducerTx(worker, ctx => ctx.sender);
  admin(ctx => mod.set_worker_identity(ctx, { worker: workerId, enabled: true }));
  return Object.assign(w, { worker });
}
type EW = ReturnType<typeof world>;

const mine = (w: World, who: Who) => view<any>(w, who, mod.my_discovery_profile)[0];
const refOf = (w: World, who: Who) => mine(w, who).publication_id as string;
function participate(w: World, who: Who, tags: string[]) {
  const expected_revision = mine(w, who)?.revision ?? 0; // read views outside the reducer tx
  w.call(who, ctx => mod.publish_discovery_profile(ctx, { display_name: 'Synthetic', interest_tags: tags, audience: 'area_discoverers',
    notice_version: 1, expires_at: inDays(w, 7), expected_revision }));
  w.call(who, ctx => mod.set_discovery_area(ctx, { area_key: 'berkeley-campus' }));
}
/** Alice (viewer) shares hiking with Bob and hiking + live-music with Carol. */
function trio() {
  const w = world();
  participate(w, w.alice, ['hiking', 'live-music']);
  participate(w, w.bob, ['hiking']);
  participate(w, w.carol, ['hiking', 'live-music']);
  return w;
}
let seq = 0;
const ask = (w: World, who: Who) =>
  w.call(who, ctx => mod.request_introduction_suggestion(ctx, { client_request_id: `suggest-${String(++seq).padStart(4, '0')}` }));
const suggestions = (w: World, who: Who) => view<any>(w, who, mod.my_introduction_proposals);
const myRequest = (w: World, who: Who) => view<any>(w, who, mod.my_introduction_suggestion_request);

function source(w: EW, hooks: { beforeCommit?: () => void; closeFails?: () => boolean } = {}) {
  const counts = { commits: 0, closes: 0 };
  const src: WorkerStateSource = {
    signalContext: async () => [], delivery: async () => [], commitNudge: async () => { throw new Error('unused'); },
    introductionRequests: async () => view<any>(w, w.worker, mod.worker_introduction_requests),
    commitIntroductionProposal: async args => {
      hooks.beforeCommit?.();
      counts.commits++;
      w.call(w.worker, ctx => mod.commit_introduction_proposal(ctx, args as Parameters<typeof mod.commit_introduction_proposal>[1]));
    },
    closeIntroductionRequest: async request_id => {
      if (hooks.closeFails?.()) throw new Error('unavailable: transient');
      counts.closes++;
      w.call(w.worker, ctx => mod.close_introduction_suggestion_request(ctx, { request_id }));
    },
  };
  return { src, counts };
}

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

function watcher(w: EW, src: WorkerStateSource, runner: DroidRunner, mode: 'deterministic' | 'agent' = 'deterministic') {
  const clock = { now: () => w.h.clock.now().toDate() };
  const outcomes: any[] = [];
  let lapsed = 0, runs = 0;
  const wt = new IntroductionRequestWatcher(src, {
    clock,
    run: req => { runs++; return runIntroductionRequest(req, { source: src, runner, clock, deterministicOnly: mode === 'deterministic' }); },
    onOutcome: o => outcomes.push(o), onLapsed: () => { lapsed++; },
  });
  return { wt, outcomes, lapsed: () => lapsed, runs: () => runs };
}

describe('viewer asks → worker suggests one person → viewer decides, over the real module', () => {
  it('deterministic default: zero model calls; the most-overlap candidate is suggested to the viewer only; request closed', async () => {
    const w = trio();
    ask(w, w.alice);
    const droid = scriptedRunner('{}');
    const { src, counts } = source(w);
    const { wt, outcomes } = watcher(w, src, droid.runner);
    expect(await wt.sweep()).toBe(1);
    expect(droid.calls()).toBe(0);
    expect(outcomes).toMatchObject([{ outcome: 'proposed', modelCalls: 0, decidedBy: 'deterministic', shortlisted: 2, eligible: 2 }]);
    expect(suggestions(w, w.alice)).toMatchObject([{ candidate_ref: refOf(w, w.carol), opener_id: 'suggest_shared_interest',
      decided_by: 'deterministic', shared_tags: ['hiking', 'live-music'] }]);
    for (const who of [w.bob, w.carol]) {
      expect(suggestions(w, who)).toHaveLength(0);
      expect(view(w, who, mod.my_introductions)).toHaveLength(0); // nobody is contacted
    }
    expect(counts.closes).toBe(1);
    expect(myRequest(w, w.alice)).toMatchObject([{ status: 'done' }]);
    expect(view(w, w.worker, mod.worker_introduction_requests)).toEqual([]);
    expect(await wt.sweep()).toBe(0); // nothing open: no rerun
  });

  it('agent mode: one Droid call picks among the shortlist; only refs it was given can commit', async () => {
    const w = trio();
    ask(w, w.alice);
    // Candidates arrive ranked by overlap: [Carol (2 tags), Bob (1 tag)]; the scripted model picks index 1.
    const droid = scriptedRunner(JSON.stringify({ decision: 'suggest', candidateIndex: 1, lead: 'tag', tagIndex: 0 }));
    const { src } = source(w);
    const { wt, outcomes } = watcher(w, src, droid.runner, 'agent');
    await wt.sweep();
    expect(droid.calls()).toBe(1);
    expect(outcomes).toMatchObject([{ outcome: 'proposed', modelCalls: 1, decidedBy: 'agent' }]);
    expect(suggestions(w, w.alice)).toMatchObject([{ candidate_ref: refOf(w, w.bob), shared_tags: ['hiking'] }]);
  });

  it('agent mode with one candidate makes no model call', async () => {
    const w = world();
    participate(w, w.alice, ['hiking']);
    participate(w, w.bob, ['hiking']);
    ask(w, w.alice);
    const droid = scriptedRunner('{}');
    const { wt, outcomes } = watcher(w, source(w).src, droid.runner, 'agent');
    await wt.sweep();
    expect(droid.calls()).toBe(0);
    expect(outcomes).toMatchObject([{ outcome: 'proposed', modelCalls: 0, decidedBy: 'deterministic' }]);
  });

  it('nobody to suggest: no_candidates, zero calls, no commit; the viewer sees the request done and no suggestion', async () => {
    const w = world();
    participate(w, w.alice, ['hiking']);
    participate(w, w.bob, ['board-games']);
    ask(w, w.alice);
    const droid = scriptedRunner('{}');
    const { src, counts } = source(w);
    const { wt, outcomes } = watcher(w, src, droid.runner, 'agent');
    await wt.sweep();
    expect(outcomes).toMatchObject([{ outcome: 'no_candidates', modelCalls: 0 }]);
    expect(droid.calls()).toBe(0);
    expect(counts.commits).toBe(0);
    expect(suggestions(w, w.alice)).toEqual([]);
    expect(myRequest(w, w.alice)).toMatchObject([{ status: 'done' }]);
  });

  it('candidates withdraw while the model runs: the live-view recheck stops it before any commit', async () => {
    const w = trio();
    ask(w, w.alice);
    const droid = scriptedRunner('{"decision":"suggest","candidateIndex":0,"lead":"tag"}',
      () => { for (const who of [w.bob, w.carol]) w.call(who, ctx => mod.withdraw_discovery_profile(ctx, {})); });
    const { src, counts } = source(w);
    const { wt, outcomes } = watcher(w, src, droid.runner, 'agent');
    await wt.sweep();
    expect(outcomes).toMatchObject([{ outcome: 'stale' }]);
    expect(counts.commits).toBe(0);
    expect(suggestions(w, w.alice)).toEqual([]);
    expect(myRequest(w, w.alice)).toMatchObject([{ status: 'done' }]);
  });

  it('a block between ask and sweep removes that person before the worker sees them', async () => {
    const w = trio();
    ask(w, w.alice);
    const carolRef = refOf(w, w.carol);
    w.call(w.alice, ctx => mod.block_discovery_user(ctx, { card_ref: carolRef }));
    const { wt } = watcher(w, source(w).src, scriptedRunner('{}').runner);
    await wt.sweep();
    expect(suggestions(w, w.alice).map(p => p.candidate_ref)).toEqual([refOf(w, w.bob)]);
  });

  it('a request past expires_at is closed without running', async () => {
    const w = trio();
    ask(w, w.alice);
    w.h.clock.set(new Timestamp(w.h.clock.now().microsSinceUnixEpoch + 11n * 60_000_000n));
    const { src, counts } = source(w);
    const t = watcher(w, src, scriptedRunner('{}').runner);
    await t.wt.sweep();
    expect(t.runs()).toBe(0);
    expect(t.lapsed()).toBe(1);
    expect(counts.closes).toBe(1);
    expect(suggestions(w, w.alice)).toEqual([]);
  });

  it('close fails after a committed suggestion: only the close is retried, never a second suggestion', async () => {
    const w = trio();
    ask(w, w.alice);
    let failClose = true;
    const { src, counts } = source(w, { closeFails: () => failClose });
    const t = watcher(w, src, scriptedRunner('{}').runner);
    await t.wt.sweep();
    expect(suggestions(w, w.alice)).toHaveLength(1);
    failClose = false;
    await t.wt.sweep(); // the view now lists Bob only (Carol has a suggestion), but the request already ran
    expect(t.runs()).toBe(1);
    expect(counts.commits).toBe(1);
    expect(suggestions(w, w.alice)).toHaveLength(1);
    expect(myRequest(w, w.alice)).toMatchObject([{ status: 'done' }]);
  });

  it('full newcomer path: suggestion → viewer sends a real request → recipient accepts → the suggestion is gone', async () => {
    const w = trio();
    ask(w, w.alice);
    await watcher(w, source(w).src, scriptedRunner('{}').runner).wt.sweep();
    const [p] = suggestions(w, w.alice);
    w.call(w.alice, ctx => mod.send_introduction_request(ctx, { card_ref: p.candidate_ref, client_request_id: 'intro-from-suggestion' }));
    const incoming = view<any>(w, w.carol, mod.my_introductions).find(i => i.direction === 'incoming')!;
    w.call(w.carol, ctx => mod.respond_introduction_request(ctx, { intro_id: incoming.intro_id, accept: true }));
    expect(view<any>(w, w.alice, mod.my_introductions)).toMatchObject([{ direction: 'outgoing', status: 'accepted' }]);
    expect(suggestions(w, w.alice)).toEqual([]);
    // Asking again never re-suggests someone already connected.
    ask(w, w.alice);
    await watcher(w, source(w).src, scriptedRunner('{}').runner).wt.sweep();
    expect(suggestions(w, w.alice).map(s => s.candidate_ref)).toEqual([refOf(w, w.bob)]);
  });
});
