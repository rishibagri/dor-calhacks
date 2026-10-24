// AI dry run: the built worker (dist) against the REAL SpacetimeDB module running in-process — Cyber's
// reducers, worker-only views and guards, not fakes. What is synthetic is labeled: the accounts, the Droid
// subprocess (scripted unless DOR_DRYRUN_LIVE_DROID=1). Recipient consent is recorded through the real
// set_support_preferences reducer and read via worker_support_preferences (D035). This is offline evidence, not a
// published module or a deployed worker.
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { Timestamp } from 'spacetimedb';
import { createLiveWorker, SignalWatcher, spacetimeWorkerPorts, type WorkerStateSource } from '../dist/index.js';
import { allSignals, approveArgs, confirmPreset, grantPrefs, jwtAuth, mod, pairUp, setup, view, type World }
  from '../../spacetimedb/tests/helpers';

const BOTH = { support_mode: 'short_call', availability: 'this_week' };
const LIVE_DROID = process.env.DOR_DRYRUN_LIVE_DROID === '1';
type Auth = ReturnType<typeof jwtAuth>;

/** The worker's view of the module: worker-only views and commit_nudge, called as `who`. */
function harnessSource(w: World, who: Auth, hooks: { beforeCommit?: () => void } = {}): WorkerStateSource {
  return {
    signalContext: async () => view(w, who, mod.worker_signal_context),
    delivery: async () => view(w, who, mod.worker_delivery),
    supportPreferences: async () => view(w, who, mod.worker_support_preferences),
    commitNudge: async args => {
      hooks.beforeCommit?.();
      w.call(who, ctx => mod.commit_nudge(ctx, args));
    },
  };
}

/** SYNTHETIC Droid: scripted reply; `during` runs while the "model" is thinking (revocation races). */
function scriptedDroid(reply = '{"decision":"compatible","optionIndex":0}', during?: () => void) {
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
  return { spawn, calls: () => calls };
}

/** Bob's own consent, recorded through the real reducer (D035). */
const BOB_MODES = ['short_call', 'encouraging_note'];

function world(cats = ['support_preference', 'coarse_availability'], { consent = true } = {}) {
  const w = setup();
  const { pairId } = pairUp(w);
  confirmPreset(w, w.alice, pairId, 'partner', cats);
  if (consent) grantPrefs(w, w.bob, pairId, BOB_MODES, ['today', 'this_week']);
  const worker = jwtAuth('dor-worker', 50n, 'https://worker.spacetimedb.example');
  const workerId = w.h.withReducerTx(worker, ctx => ctx.sender);
  w.h.withReducerTx(w.admin, ctx => mod.set_worker_identity(ctx, { worker: workerId, enabled: true }));
  const bobHex = w.h.withReducerTx(w.bob, ctx => ctx.sender.toHexString());
  return { w, pairId, worker, bobHex };
}
const approve = (w: World, payload: Record<string, string>, req = 'r1') => {
  const pairId = view<any>(w, w.alice, mod.my_pairs)[0].pair_id;
  const args = approveArgs(w, w.alice, pairId, payload, req);
  w.call(w.alice, ctx => mod.approve_signal(ctx, args));
  return allSignals(w).find(s => s.client_request_id === req)!;
};
const optIn = (w: World, pairId: string, quiet: [number, number] | null = null) =>
  w.call(w.bob, ctx => mod.set_nudge_delivery(ctx, { pair_id: pairId, opted_in: true,
    quiet_start_minute: quiet?.[0], quiet_end_minute: quiet?.[1], utc_offset_minutes: 0 }));
const job = (pairId: string, signalId: string, requestId = signalId) => ({ schemaVersion: 1, jobId: `job_${requestId}`,
  pairId, requestId, signalIds: [signalId], createdAt: new Date().toISOString() });

const closers: (() => Promise<void>)[] = [];
afterEach(async () => { while (closers.length) await closers.pop()!(); });

function liveWorker(w: World, source: WorkerStateSource, droid: ReturnType<typeof scriptedDroid>) {
  const ports = spacetimeWorkerPorts(source); // default: worker_support_preferences
  const worker = createLiveWorker({
    authToken: 'synthetic-worker-token-0123456789abcdef', ...ports,
    clock: { now: () => w.h.clock.now().toDate() },
    droid: LIVE_DROID ? { timeoutMs: 20_000 } : { spawn: droid.spawn, env: {} },
  });
  closers.push(() => worker.close());
  return worker;
}

describe('typed approval → worker → commit_nudge, over the real module', () => {
  it('approved + opted in + consent: one Droid call, a committed nudge for the recipient only', async () => {
    const { w, pairId, worker, bobHex } = world();
    optIn(w, pairId);
    const sig = approve(w, BOTH);
    const droid = scriptedDroid();
    const live = liveWorker(w, harnessSource(w, worker), droid);

    const outcomes = await live.runJob(job(pairId, sig.signal_id));
    expect(outcomes.map(o => o.outcome)).toEqual(['nudge_proposed']);
    if (!LIVE_DROID) expect(droid.calls()).toBe(1);
    const [nudge] = view<any>(w, w.bob, mod.my_nudges);
    expect(nudge.id).toBe(outcomes[0]!.nudgeId);
    expect(nudge.template_id).toBe('offer_short_call');
    expect(view(w, w.alice, mod.my_nudges)).toHaveLength(0);
    expect(view(w, w.carol, mod.my_nudges)).toHaveLength(0);
    // Core 3 audit item 3: the sender sees only their own actions; the recipient-side 'used' outcome stays private.
    expect(view<any>(w, w.alice, mod.my_receipts).map(r => r.action)).toEqual(['approved']);
  });

  it('recipient recorded no consent: no nudge and zero model calls (fail closed)', async () => {
    const { w, pairId, worker } = world(undefined, { consent: false });
    optIn(w, pairId);
    const sig = approve(w, BOTH);
    const droid = scriptedDroid();
    const live = liveWorker(w, harnessSource(w, worker), droid);
    expect((await live.runJob(job(pairId, sig.signal_id))).map(o => o.outcome)).toEqual(['preferences_unavailable']);
    expect(droid.calls()).toBe(0);
    expect(view(w, w.bob, mod.my_nudges)).toHaveLength(0);
  });

  it('recipient never opted in: not_opted_in before any model call', async () => {
    const { w, pairId, worker, bobHex } = world();
    const sig = approve(w, BOTH);
    const droid = scriptedDroid();
    const live = liveWorker(w, harnessSource(w, worker), droid);
    expect((await live.runJob(job(pairId, sig.signal_id))).map(o => o.outcome)).toEqual(['not_opted_in']);
    expect(droid.calls()).toBe(0);
  });

  it('revoked while the model runs: the coordinator recheck refuses it and nothing is committed', async () => {
    const { w, pairId, worker, bobHex } = world();
    optIn(w, pairId);
    const sig = approve(w, BOTH);
    const droid = scriptedDroid(undefined, () => w.call(w.alice, ctx => mod.revoke_signal(ctx, { signal_id: sig.signal_id })));
    const live = liveWorker(w, harnessSource(w, worker), droid);
    expect((await live.runJob(job(pairId, sig.signal_id))).map(o => o.outcome)).toEqual(['policy_denied']);
    expect(view(w, w.bob, mod.my_nudges)).toHaveLength(0);
  });

  it('revoked after the recheck, just before commit: commit_nudge refuses and the outcome records it', async () => {
    const { w, pairId, worker, bobHex } = world();
    optIn(w, pairId);
    const sig = approve(w, BOTH);
    const source = harnessSource(w, worker, {
      beforeCommit: () => w.call(w.alice, ctx => mod.revoke_signal(ctx, { signal_id: sig.signal_id })) });
    const live = liveWorker(w, source, scriptedDroid());
    const [outcome] = await live.runJob(job(pairId, sig.signal_id));
    expect(outcome!.outcome).toBe('policy_denied');
    expect(outcome!.nudgeId).toBeUndefined();
    expect(view(w, w.bob, mod.my_nudges)).toHaveLength(0);
  });

  it('quiet hours that start during generation are enforced at commit', async () => {
    const { w, pairId, worker, bobHex } = world();
    optIn(w, pairId);
    const sig = approve(w, BOTH);
    const now = w.h.clock.now().toDate();
    const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
    const source = harnessSource(w, worker, { beforeCommit: () => optIn(w, pairId, [minute, (minute + 30) % 1440]) });
    const live = liveWorker(w, source, scriptedDroid());
    expect((await live.runJob(job(pairId, sig.signal_id))).map(o => o.outcome)).toEqual(['quiet_hours']);
    expect(view(w, w.bob, mod.my_nudges)).toHaveLength(0);
  });

  it('recipient revokes consent while the model runs: commit_nudge refuses the bound consent (D035)', async () => {
    const { w, pairId, worker } = world();
    optIn(w, pairId);
    const sig = approve(w, BOTH);
    const source = harnessSource(w, worker, {
      beforeCommit: () => w.call(w.bob, ctx => mod.revoke_support_preferences(ctx, { pair_id: pairId })) });
    const live = liveWorker(w, source, scriptedDroid());
    expect((await live.runJob(job(pairId, sig.signal_id))).map(o => o.outcome)).toEqual(['policy_denied']);
    expect(view(w, w.bob, mod.my_nudges)).toHaveLength(0);
  });

  it('the committed nudge is bound to the consent version the ACK used', async () => {
    const { w, pairId, worker } = world();
    optIn(w, pairId);
    const sig = approve(w, BOTH);
    const [pref] = view<any>(w, w.bob, mod.my_support_preferences);
    const live = liveWorker(w, harnessSource(w, worker), scriptedDroid());
    expect((await live.runJob(job(pairId, sig.signal_id))).map(o => o.outcome)).toEqual(['nudge_proposed']);
    const n = w.h.withReducerTx(w.admin, ctx => [...ctx.db.nudge.iter()])[0]!;
    expect([n.recipient_consent_id, n.recipient_consent_version]).toEqual([pref.consent_id, pref.consent_version]);
  });

  it('recipient narrows consent while the model runs: the coordinator recheck refuses and nothing is committed', async () => {
    const { w, pairId, worker } = world();
    optIn(w, pairId);
    const sig = approve(w, BOTH);
    const droid = scriptedDroid(undefined, () => { grantPrefs(w, w.bob, pairId, ['encouraging_note'], ['today', 'this_week']); });
    const live = liveWorker(w, harnessSource(w, worker), droid);
    expect((await live.runJob(job(pairId, sig.signal_id))).map(o => o.outcome)).toEqual(['preferences_unavailable']);
    expect(view(w, w.bob, mod.my_nudges)).toHaveLength(0);
  });

  it('recipient re-saves the same consent after the recheck: only the version pin stops the commit (D035)', async () => {
    const { w, pairId, worker } = world();
    optIn(w, pairId);
    const sig = approve(w, BOTH);
    // Same modes and windows, so the consent still stands and covers the template; only consent_version moves.
    const source = harnessSource(w, worker, { beforeCommit: () => { grantPrefs(w, w.bob, pairId, BOB_MODES, ['today', 'this_week']); } });
    const live = liveWorker(w, source, scriptedDroid());
    expect((await live.runJob(job(pairId, sig.signal_id))).map(o => o.outcome)).toEqual(['policy_denied']);
    expect(view(w, w.bob, mod.my_nudges)).toHaveLength(0);
  });

  it('a non-worker identity sees no signals and cannot commit', async () => {
    const { w, pairId, bobHex } = world();
    optIn(w, pairId);
    const sig = approve(w, BOTH);
    const droid = scriptedDroid();
    const live = liveWorker(w, harnessSource(w, w.carol), droid);
    expect((await live.runJob(job(pairId, sig.signal_id))).map(o => o.outcome)).toEqual(['policy_denied']);
    expect(droid.calls()).toBe(0);
    await expect(harnessSource(w, w.carol).commitNudge({ nudge_id: 'n-x', pair_id: pairId, template_id: 'offer_short_call',
      source_signal_ids: [sig.signal_id], source_consent_versions: [sig.consent_version],
      recipient_consent_id: 'any', recipient_consent_version: 1 })).rejects.toThrow('worker only');
  });

  it('availability-only approval: no nudge and zero model calls', async () => {
    const { w, pairId, worker, bobHex } = world();
    optIn(w, pairId);
    const sig = approve(w, { availability: 'today' });
    const droid = scriptedDroid();
    const live = liveWorker(w, harnessSource(w, worker), droid);
    const outcomes = await live.runJob(job(pairId, sig.signal_id));
    expect(outcomes[0]!.outcome).not.toBe('nudge_proposed');
    expect(droid.calls()).toBe(0);
    expect(view(w, w.bob, mod.my_nudges)).toHaveLength(0);
  });
});

describe('watcher: approved signals become jobs exactly once', () => {
  it('sweeps start one job per new signal; a restarted worker spends no model call and commits nothing new', async () => {
    const { w, pairId, worker, bobHex } = world();
    optIn(w, pairId);
    approve(w, BOTH);
    const source = harnessSource(w, worker);
    const droid = scriptedDroid();
    const first = liveWorker(w, source, droid);
    const seen: string[] = [];
    const watcher = new SignalWatcher(source, { run: j => first.runJob(j), onOutcome: o => seen.push(...o.map(x => x.outcome)) });
    expect(await watcher.sweep()).toBe(1);
    expect(await watcher.sweep()).toBe(0);
    expect(seen).toEqual(['nudge_proposed']);

    // Restart: fresh process, fresh ledger. The pair is inside its cooldown, so the pre-check stops it.
    const droid2 = scriptedDroid();
    const second = liveWorker(w, source, droid2);
    const again: string[] = [];
    await new SignalWatcher(source, { run: j => second.runJob(j), onOutcome: o => again.push(...o.map(x => x.outcome)) }).sweep();
    expect(again).toEqual(['cooldown']);
    expect(droid2.calls()).toBe(0);
    expect(view(w, w.bob, mod.my_nudges)).toHaveLength(1);
  });

  it('after the cooldown a new approval is coordinated; the old one stays done', async () => {
    const { w, pairId, worker, bobHex } = world();
    optIn(w, pairId);
    approve(w, BOTH, 'a');
    const source = harnessSource(w, worker);
    const live = liveWorker(w, source, scriptedDroid());
    const seen: string[] = [];
    const watcher = new SignalWatcher(source, { run: j => live.runJob(j), onOutcome: o => seen.push(...o.map(x => x.outcome)) });
    await watcher.sweep();
    w.h.clock.set(new Timestamp(w.h.clock.now().microsSinceUnixEpoch + 25n * 3_600_000_000n));
    approve(w, { support_mode: 'encouraging_note' }, 'b');
    await watcher.sweep();
    expect(seen).toEqual(['nudge_proposed', 'nudge_proposed']);
    expect(view<any>(w, w.bob, mod.my_nudges).map(n => n.template_id).sort()).toEqual(['offer_note', 'offer_short_call']);
  });
});
