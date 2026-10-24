// FULL AI DRY RUN across the three Kinetic experiences. Prints a step trace labeled by evidence kind:
//   module    = the real SpacetimeDB module (Cyber/CS reducers, views, guards) running in-process
//   real      = production AI code (route handler, coordinators, worker adapters, LocalVault)
//   synthetic = a labeled stand-in (accounts, provider replies, C8/C7 eligibility that has no module state yet)
//   live      = a real provider call (opt-in: KINETIC_DRYRUN_LIVE_CLAUDE=1, KINETIC_DRYRUN_LIVE_DROID=1; costs credits)
// Offline by default. Not a published module, deployed worker or browser run.
// KINETIC_DRYRUN_REPORT=<path> also writes the trace as Markdown.
import { writeFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { applyPlanAction } from '@kinetic/contracts/plan-lifecycle';
import { ClaudeReflectionAdapter, IntroductionCoordinator, PlanCoordinator, handleReflectionRequest } from '@kinetic/agents';
import { SyntheticReflectionAdapter } from '@kinetic/agents/testing';
import { DroidIntroProposer, DroidPlanProposer, DroidRunner, SignalWatcher, createLiveWorker, spacetimeWorkerPorts,
  type WorkerStateSource } from '../dist/index.js';
import { LocalVault } from '../../src/vault/local-vault.ts';
import { IndexedDbVaultStore } from '../../src/vault/store.ts';
import { splitReflection } from '../../src/features/voice/model.ts';
import reflectionFixtures from '../../src/agents/fixtures/reflection.synthetic.json';
import { allSignals, approveArgs, confirmPreset, grantPrefs, jwtAuth, mod, pairUp, setup, view, type World }
  from '../../spacetimedb/tests/helpers';

try { process.loadEnvFile(new URL('../../.env.local', import.meta.url)); } catch { /* optional */ }
const LIVE_CLAUDE = process.env.KINETIC_DRYRUN_LIVE_CLAUDE === '1' && Boolean(process.env.ANTHROPIC_API_KEY);
const LIVE_DROID = process.env.KINETIC_DRYRUN_LIVE_DROID === '1';
const droidMode = LIVE_DROID ? 'live' : 'synthetic';

type Kind = 'module' | 'real' | 'synthetic' | 'live';
const trace: { journey: string; step: string; kinds: Kind[]; result: string; modelCalls?: number; ms: number }[] = [];
async function step<T>(journey: string, name: string, kinds: Kind[], fn: () => Promise<T> | T,
  summarize: (v: T) => string, calls?: (v: T) => number): Promise<T> {
  const t = performance.now();
  const value = await fn();
  trace.push({ journey, step: name, kinds: [...new Set(kinds)], result: summarize(value), modelCalls: calls?.(value), ms: Math.round(performance.now() - t) });
  return value;
}

/** SYNTHETIC droid subprocess replying in order; counts calls. Replaced by real droid with KINETIC_DRYRUN_LIVE_DROID=1. */
function scriptedRunner(replies: string[]) {
  let calls = 0;
  const spawn = (() => {
    const reply = replies[Math.min(calls++, replies.length - 1)]!;
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
    queueMicrotask(() => {
      child.stderr.end();
      child.stdout.end(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: reply,
        usage: { factory_credits: 0 } }));
      child.stdout.on('end', () => child.emit('close', 0));
    });
    return child;
  }) as never;
  return { calls: () => calls, options: LIVE_DROID ? { timeoutMs: 20_000 } : { spawn, env: {} } };
}

function harnessSource(w: World, who: ReturnType<typeof jwtAuth>): WorkerStateSource {
  return {
    signalContext: async () => view(w, who, mod.worker_signal_context),
    delivery: async () => view(w, who, mod.worker_delivery),
    supportPreferences: async () => view(w, who, mod.worker_support_preferences),
    commitNudge: async args => { w.call(who, ctx => mod.commit_nudge(ctx, args)); },
  };
}

function relationshipWorld(kind: 'partner' | 'friend' | 'family', cats: string[]) {
  const w = setup();
  const { pairId } = pairUp(w);
  confirmPreset(w, w.alice, pairId, kind, cats);
  const worker = jwtAuth('kinetic-worker', 50n, 'https://worker.spacetimedb.example');
  const workerId = w.h.withReducerTx(worker, ctx => ctx.sender);
  w.h.withReducerTx(w.admin, ctx => mod.set_worker_identity(ctx, { worker: workerId, enabled: true }));
  w.call(w.bob, ctx => mod.set_nudge_delivery(ctx, { pair_id: pairId, opted_in: true, quiet_start_minute: undefined,
    quiet_end_minute: undefined, utc_offset_minutes: 0 }));
  return { w, pairId, worker };
}


async function reflect(journey: string, caseId: string) {
  const fixture = reflectionFixtures.cases.find(c => c.id === caseId)!;
  const port = LIVE_CLAUDE ? new ClaudeReflectionAdapter({ model: process.env.KINETIC_CLAUDE_MODEL || undefined })
    : new SyntheticReflectionAdapter(fixture.output as never);
  return step(journey, 'reflect via POST /api/reflections handler', ['real', LIVE_CLAUDE ? 'live' : 'synthetic'], async () => {
    const res = await handleReflectionRequest(new Request('http://dry/api/reflections', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ selectedText: fixture.input, clientRequestId: `dry-${caseId}` }) }),
    { session: { configured: true, userId: 'synthetic-alice' }, reflection: port });
    expect(res.status).toBe(200);
    return res.json();
  }, r => `candidate ${JSON.stringify(r.candidate)}`, () => (LIVE_CLAUDE ? 1 : 0));
}

async function persistLocally(journey: string, result: { reflection: string; candidate: unknown }) {
  return step(journey, 'save reflection text to LocalVault; candidate stays in memory', ['real'], async () => {
    const idb = new IDBFactory();
    const vault = new LocalVault({ store: new IndexedDbVaultStore(idb), idleLockMs: 0, lockOnPageHide: false, unsafeTestIterations: 1000 });
    await vault.create('synthetic passphrase for the dry run');
    const { persist, memoryOnly } = splitReflection(result as never);
    await vault.saveReflection('entry-1', persist.reflection);
    expect(await vault.readReflection('entry-1')).toBe(result.reflection);
    expect(JSON.stringify(persist)).not.toContain('candidate');
    return memoryOnly;
  }, () => 'reflection persisted (encrypted); candidate not persisted');
}

describe('full AI dry run', () => {
  it('partner: reflect → vault → owner approves preview → worker coordinates → recipient nudge → revoke hides it', async () => {
    const J = 'partner';
    const reply = await reflect(J, 'partners-exam');
    const candidate = await persistLocally(J, reply) as { supportMode?: string; availability?: string };
    const { w, pairId, worker } = relationshipWorld('partner', ['support_preference', 'coarse_availability']);
    const signal = await step(J, 'owner approves the exact preview (approve_signal)', ['module', 'synthetic'], () => {
      const args = approveArgs(w, w.alice, pairId, { support_mode: candidate.supportMode!, availability: candidate.availability! }, 'dry-p');
      w.call(w.alice, ctx => mod.approve_signal(ctx, args));
      return allSignals(w).find(s => s.client_request_id === 'dry-p')!;
    }, s => `signal ${s.support_mode}/${s.availability}`);

    await step(J, 'recipient records support-preference consent (set_support_preferences)', ['module', 'synthetic'],
      () => grantPrefs(w, w.bob, pairId, ['short_call', 'encouraging_note'], ['today', 'this_week']),
      r => `consent v${r.consent_version}: ${r.support_modes.join(',')}`);
    const runner = scriptedRunner(['{"decision":"compatible","optionIndex":0}']);
    const live = createLiveWorker({ authToken: 'synthetic-worker-token-0123456789abcdef',
      ...spacetimeWorkerPorts(harnessSource(w, worker)),
      clock: { now: () => w.h.clock.now().toDate() }, droid: runner.options });
    const outcomes: string[] = [];
    const watcher = new SignalWatcher(harnessSource(w, worker), { run: j => live.runJob(j), onOutcome: o => outcomes.push(...o.map(x => x.outcome)) });
    await step(J, 'worker sweep → DisclosurePolicy → Droid ACK → commit_nudge', ['real', 'module', droidMode], () => watcher.sweep(),
      () => outcomes.join(','), () => (LIVE_DROID ? outcomes.length : runner.calls()));
    await live.close();
    expect(outcomes).toEqual(['nudge_proposed']);

    await step(J, 'caller-filtered views: recipient sees nudge, others do not', ['module'], () => ({
      bob: view<any>(w, w.bob, mod.my_nudges).map(n => n.template_id), alice: view(w, w.alice, mod.my_nudges).length,
      carol: view(w, w.carol, mod.my_nudges).length }), v => `bob ${v.bob.join()}; alice ${v.alice}; carol ${v.carol}`);
    await step(J, 'owner revokes; nudge disappears from recipient view', ['module'], () => {
      w.call(w.alice, ctx => mod.revoke_signal(ctx, { signal_id: signal.signal_id }));
      return view(w, w.bob, mod.my_nudges).length;
    }, n => `bob sees ${n} nudges`);
    expect(view(w, w.bob, mod.my_nudges)).toHaveLength(0);
  });

  it('friend: availability-only reflection → no nudge and zero model calls', async () => {
    const J = 'friend';
    const { w, pairId, worker } = relationshipWorld('friend', ['support_preference', 'coarse_availability']);
    grantPrefs(w, w.bob, pairId, ['short_call', 'encouraging_note'], ['today', 'this_week']);
    await step(J, 'owner approves availability only', ['module', 'synthetic'], () => {
      const args = approveArgs(w, w.alice, pairId, { availability: 'today' }, 'dry-f');
      w.call(w.alice, ctx => mod.approve_signal(ctx, args));
    }, () => 'approved');
    const runner = scriptedRunner(['{"decision":"compatible","optionIndex":0}']);
    const live = createLiveWorker({ authToken: 'synthetic-worker-token-0123456789abcdef',
      ...spacetimeWorkerPorts(harnessSource(w, worker)),
      clock: { now: () => w.h.clock.now().toDate() }, droid: runner.options });
    const outcomes: string[] = [];
    await step(J, 'worker sweep', ['real', 'module'], () => new SignalWatcher(harnessSource(w, worker),
      { run: j => live.runJob(j), onOutcome: o => outcomes.push(...o.map(x => x.outcome)) }).sweep(),
    () => outcomes.join(','), () => runner.calls());
    await live.close();
    expect(runner.calls()).toBe(0);
    expect(view(w, w.bob, mod.my_nudges)).toHaveLength(0);
  });

  it('family: preset shares nothing → approval refused by the module before any AI work', async () => {
    const J = 'family';
    const { w, pairId } = relationshipWorld('family', []);
    const refused = await step(J, 'owner tries to approve support preference', ['module'], () => {
      const args = approveArgs(w, w.alice, pairId, { support_mode: 'short_call' }, 'dry-fa');
      try { w.call(w.alice, ctx => mod.approve_signal(ctx, args)); return 'accepted'; } catch (e) { return (e as Error).message; }
    }, r => r);
    expect(refused).not.toBe('accepted');
  });

  it('newcomer: shortlist → bounded introduction proposal (viewer-only)', async () => {
    const J = 'newcomer';
    const runner = new DroidRunner(scriptedRunner(['{"decision":"suggest","candidateIndex":1,"lead":"tag","tagIndex":0}']).options);
    const intro = new IntroductionCoordinator({ proposer: new DroidIntroProposer({ runner }), clock: { now: () => new Date() },
      eligibility: { current: async () => ({ viewerPublicationVersion: 1, candidatePublicationVersion: 1 }) } }); // SYNTHETIC: no C8 state yet
    const shortlist = { schemaVersion: 1, requestId: 'dry-intro', viewerRef: 'card-newcomer', viewerPublicationVersion: 1,
      candidates: [{ ref: 'card-1', publicationVersion: 1, reasons: ['shared_interest'], sharedTags: ['running'], sharedEventId: null },
        { ref: 'card-2', publicationVersion: 1, reasons: ['shared_interest'], sharedTags: ['board-games', 'coffee'], sharedEventId: null }] };
    const empty = await step(J, 'empty area: no candidates', ['real', 'synthetic'], () => intro.propose({ ...shortlist, candidates: [] }),
      r => r.outcome.outcome, r => r.outcome.modelCalls);
    expect(empty.outcome.modelCalls).toBe(0);
    const r = await step(J, 'two candidates: one bounded model call', ['real', 'synthetic', droidMode], () => intro.propose(shortlist),
      r => `${r.outcome.outcome} → ${r.proposal?.candidateRef ?? '-'} (${r.proposal?.sharedTags.join(',') ?? ''})`, r => r.outcome.modelCalls);
    await runner.close();
    expect(r.outcome.modelCalls).toBeLessThanOrEqual(2);
    expect(r.proposal).toBeDefined();
  });

  it('same event: mutual intents → plan proposal → both accept the same revision', async () => {
    const J = 'same-event';
    const now = Date.now(), H = 3_600_000;
    const ev = (id: string, hours: number, topics: string[]) => ({ eventId: id, startsAt: new Date(now + hours * H).toISOString(),
      status: 'scheduled' as const, fetchedAt: new Date(now - H).toISOString(), topics, format: 'in_person' as const });
    const events = [ev('evt-games', 30, ['board-games']), ev('evt-run', 40, ['running'])]; // SYNTHETIC catalogue records
    const runner = new DroidRunner(scriptedRunner(['{"decision":"suggest","eventIndex":0}']).options);
    const plans = new PlanCoordinator({ proposer: new DroidPlanProposer({ runner }), clock: { now: () => new Date() },
      current: { current: async (_b, _r, id) => ({ intentVersions: { ana: 1, ben: 1 }, bothIntend: true, // SYNTHETIC intents
        event: events.find(e => e.eventId === id) ?? null }) } });
    const result = await step(J, 'plan from mutual explicit intents', ['real', 'synthetic', droidMode], () => plans.propose({
      schemaVersion: 1, requestId: 'dry-plan', basis: { kind: 'introduction', ref: 'intro_dry' },
      participants: [{ ref: 'ana', intentVersion: 1, eventIds: ['evt-games', 'evt-run'] }, { ref: 'ben', intentVersion: 1, eventIds: ['evt-games', 'evt-run'] }],
      events }), r => `${r.outcome.outcome} → ${r.proposal?.eventId ?? '-'} rev ${r.proposal?.revision ?? '-'}`, r => r.outcome.modelCalls);
    await runner.close();
    const p = result.proposal!;
    const final = await step(J, 'both accept revision 1 (plan-lifecycle)', ['real'], () => {
      let s = { planId: p.planId, revision: p.revision, participants: [p.participants[0].ref, p.participants[1].ref] as [string, string],
        acceptedBy: [] as string[], status: 'pending' as const, expiresAtMs: Date.parse(p.expiresAt), eventStartsAtMs: Date.parse(p.eventStartsAt) };
      const check = { nowMs: Date.now(), eventScheduled: true, intentsCurrent: true, blocked: false };
      const outsider = applyPlanAction(s as never, { kind: 'accept', actor: 'carol', revision: 1 }, check);
      for (const actor of ['ana', 'ben']) s = applyPlanAction(s as never, { kind: 'accept', actor, revision: 1 }, check).state as never;
      return { status: s.status as string, outsider: outsider.ok ? 'accepted' : outsider.reason };
    }, v => `${v.status}; outsider ${v.outsider}`);
    expect(final).toEqual({ status: 'confirmed', outsider: 'not_participant' });
  });
});

afterAll(() => {
  const rows = trace.map(t => `| ${t.journey} | ${t.step} | ${t.kinds.join(' + ')} | ${t.result} | ${t.modelCalls ?? ''} | ${t.ms} |`);
  const md = [`AI dry run ${new Date().toISOString()} — Claude ${LIVE_CLAUDE ? 'LIVE' : 'synthetic'}, Droid ${LIVE_DROID ? 'LIVE' : 'synthetic'}`,
    '', '| Journey | Step | Evidence | Result | Model calls | ms |', '|---|---|---|---|---|---|', ...rows].join('\n');
  console.log('\n' + md + '\n');
  if (process.env.KINETIC_DRYRUN_REPORT) writeFileSync(process.env.KINETIC_DRYRUN_REPORT, md + '\n');
});
