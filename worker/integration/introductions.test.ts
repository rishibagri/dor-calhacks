// AI-R2 introduction path over the REAL module in-process (Cyber's D038 commit_introduction_proposal and views):
// shortlist → IntroductionCoordinator → guarded commit into the viewer's private suggestions.
// Synthetic: accounts, tags, the Droid subprocess (scripted), and the shortlist + eligibility source, which are
// read here from the VIEWER's discovery_cards because the module has no worker view for discovery candidates yet.
// Offline evidence only.
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { DroidRunner, classifyIntroCommitError, runIntroductionJob, type WorkerStateSource } from '../dist/index.js';
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
function participate(w: World, who: Who, name: string, tags: string[]) {
  const expected_revision = mine(w, who)?.revision ?? 0; // read views outside the reducer tx
  w.call(who, ctx => mod.publish_discovery_profile(ctx, { display_name: name, interest_tags: tags, audience: 'area_discoverers',
    notice_version: 1, expires_at: inDays(w, 7), expected_revision }));
  w.call(who, ctx => mod.set_discovery_area(ctx, { area_key: 'berkeley-campus' }));
}
/** Alice (viewer) shares hiking with Bob and live-music + hiking with Carol. */
function trio() {
  const w = world();
  participate(w, w.alice, 'Alice S', ['hiking', 'live-music']);
  participate(w, w.bob, 'Bob S', ['hiking']);
  participate(w, w.carol, 'Carol S', ['hiking', 'live-music']);
  return w;
}

/** SYNTHETIC shortlist as the viewer's DS ranker would produce it: visible cards, overlap only, ≤ 3. */
function shortlist(w: World, viewer: Who, requestId = 'intro-req-0001') {
  const me = mine(w, viewer);
  const cards = view<any>(w, viewer, mod.discovery_cards).filter(c => c.shared_tags.length > 0).slice(0, 3);
  return {
    schemaVersion: 1, requestId, viewerRef: me.publication_id, viewerPublicationVersion: me.revision,
    candidates: cards.map(c => ({ ref: c.card_ref, publicationVersion: c.revision, reasons: ['shared_interest'],
      sharedTags: [...c.shared_tags], sharedEventId: null })),
  };
}
/** SYNTHETIC eligibility: the viewer's current visible cards (stand-in for a worker view that does not exist yet). */
const eligibility = (w: World, viewer: Who) => ({
  current: async (_viewerRef: string, candidateRef: string) => {
    const me = mine(w, viewer);
    const card = view<any>(w, viewer, mod.discovery_cards).find(c => c.card_ref === candidateRef);
    return me && card ? { viewerPublicationVersion: me.revision, candidatePublicationVersion: card.revision } : null;
  },
});

function source(w: EW, who: Who = w.worker, hooks: { beforeCommit?: () => void } = {}): WorkerStateSource {
  return {
    signalContext: async () => [], delivery: async () => [], commitNudge: async () => { throw new Error('unused'); },
    commitIntroductionProposal: async args => {
      hooks.beforeCommit?.();
      w.call(who, ctx => mod.commit_introduction_proposal(ctx, args as Parameters<typeof mod.commit_introduction_proposal>[1]));
    },
  };
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

const deps = (w: EW, src: WorkerStateSource, runner: DroidRunner) =>
  ({ source: src, runner, eligibility: eligibility(w, w.alice), clock: { now: () => w.h.clock.now().toDate() } });
const suggestions = (w: World, who: Who) => view<any>(w, who, mod.my_introduction_proposals);

describe('shortlist → IntroductionCoordinator → commit_introduction_proposal, over the real module', () => {
  it('two candidates: one model call; the suggestion lands in the viewer\'s private list only', async () => {
    const w = trio();
    const sl = shortlist(w, w.alice);
    const carolIndex = sl.candidates.findIndex(c => c.sharedTags.includes('live-music'));
    const droid = scriptedRunner(JSON.stringify({ decision: 'suggest', candidateIndex: carolIndex, lead: 'tag',
      tagIndex: sl.candidates[carolIndex]!.sharedTags.indexOf('live-music') }));
    const outcome = await runIntroductionJob(sl, deps(w, source(w), droid.runner));
    expect(outcome).toMatchObject({ outcome: 'proposed', modelCalls: 1, decidedBy: 'agent' });
    const [p] = suggestions(w, w.alice);
    expect(p).toMatchObject({ proposal_id: outcome.proposalId, candidate_ref: mine(w, w.carol).publication_id,
      reason_code: 'shared_interest', opener_id: 'suggest_shared_interest' });
    expect(p.shared_tags[0]).toBe('live-music');
    expect(suggestions(w, w.carol)).toHaveLength(0);
    expect(suggestions(w, w.bob)).toHaveLength(0);
    expect(view(w, w.carol, mod.my_introductions)).toHaveLength(0);
  });

  it('a retried job re-commits the same proposal_id: idempotent, still one suggestion', async () => {
    const w = trio();
    const sl = shortlist(w, w.alice);
    await runIntroductionJob(sl, { ...deps(w, source(w), scriptedRunner('{}').runner), deterministicOnly: true });
    const again = await runIntroductionJob(sl, { ...deps(w, source(w), scriptedRunner('{}').runner), deterministicOnly: true });
    expect(again.outcome).toBe('proposed');
    expect(suggestions(w, w.alice)).toHaveLength(1);
  });

  it('candidate withdraws while the model runs: the recheck stops it before any commit', async () => {
    const w = trio();
    const sl = shortlist(w, w.alice);
    let commits = 0;
    const droid = scriptedRunner('{"decision":"suggest","candidateIndex":0,"lead":"tag"}',
      () => { for (const who of [w.bob, w.carol]) w.call(who, ctx => mod.withdraw_discovery_profile(ctx, {})); });
    const outcome = await runIntroductionJob(sl, deps(w, source(w, w.worker, { beforeCommit: () => { commits++; } }), droid.runner));
    expect(outcome.outcome).toBe('stale');
    expect(commits).toBe(0);
    expect(suggestions(w, w.alice)).toHaveLength(0);
  });

  it('candidate edits their profile after the recheck: the reducer refuses the old version and the job records stale', async () => {
    const w = trio();
    const sl = shortlist(w, w.alice);
    const src = source(w, w.worker, { beforeCommit: () => participate(w, w.bob, 'Bob S', ['hiking', 'board-games']) });
    const outcome = await runIntroductionJob({ ...sl, candidates: sl.candidates.filter(c => !c.sharedTags.includes('live-music')) },
      deps(w, src, scriptedRunner('{}').runner));
    expect(outcome.outcome).toBe('stale');
    expect(outcome.proposalId).toBeUndefined();
    expect(suggestions(w, w.alice)).toHaveLength(0);
  });

  it('event-only overlap is dropped before any model call while the commit accepts shared_interest only', async () => {
    const w = trio();
    const sl = shortlist(w, w.alice);
    const eventOnly = { ...sl, candidates: [{ ...sl.candidates[0]!, sharedTags: [], reasons: ['same_event'], sharedEventId: 'evt-1' }] };
    const droid = scriptedRunner('{}');
    const outcome = await runIntroductionJob(eventOnly, deps(w, source(w), droid.runner));
    expect(outcome).toMatchObject({ outcome: 'no_candidates', modelCalls: 0 });
    expect(droid.calls()).toBe(0);
  });

  it('a non-worker commit is a thrown deployment fault, never recorded as a user outcome', async () => {
    const w = trio();
    const sl = shortlist(w, w.alice);
    let thrown: unknown;
    try {
      await runIntroductionJob(sl, { ...deps(w, source(w, w.alice), scriptedRunner('{}').runner), deterministicOnly: true });
    } catch (e) { thrown = e; }
    expect(String(thrown)).toMatch(/unauthorized: worker only/);
    expect(classifyIntroCommitError(thrown)).toBeNull();
    expect(suggestions(w, w.alice)).toHaveLength(0);
  });
});
