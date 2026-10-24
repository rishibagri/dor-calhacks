// BACKEND DEMO: one Alex → Sam journey through the real dor pipeline, narrated step by step with the sponsor track
// each step exercises. Offline by default (synthetic providers, still the real module + real AI code); opt into
// real providers FROM THE SHELL ONLY:  DOR_DEMO_LIVE=cartesia,claude,droid npm run demo -w @dor/worker
// DOR_DEMO_TRACE=<path> also writes the steps as JSON lines (for a /console replay view).
// The database is the real SpacetimeDB module running in-process (Cyber/CS reducers, views and guards); a published
// module with two browsers is Core 3, not this script. Synthetic accounts and story only.
import { appendFileSync, writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { NUDGE_TEMPLATE_COPY, templateForSignal } from '@dor/contracts';
import { CartesiaVoiceAdapter, ClaudeReflectionAdapter, handleReflectionRequest } from '@dor/agents';
import { SyntheticReflectionAdapter } from '@dor/agents/testing';
import { VoiceDictation, speak } from '@dor/agents/client';
import { DroidSdkTransport, SignalWatcher, createLiveWorker, droidEnv, spacetimeWorkerPorts, type DroidTransport,
  type WorkerStateSource } from '../dist/index.js';
import { assessedRecipients, initialLoopState } from '../../src/features/voice/assessment.ts';
import { QUESTION_COPY, answerCompany, answerWho, decide } from '../../src/components/feature/decision-loop-model.ts';
import { allSignals, approveArgs, confirmPreset, grantPrefs, jwtAuth, mod, pairUp, setup, view }
  from '../../spacetimedb/tests/helpers';

// Live providers are chosen from the shell before .env.local is read, so the file can never make this run paid.
const LIVE = new Set((process.env.DOR_DEMO_LIVE ?? '').split(',').map(s => s.trim()).filter(Boolean));
if (LIVE.size) { try { process.loadEnvFile(new URL('../../.env.local', import.meta.url)); } catch { /* optional */ } }
const live = (p: 'cartesia' | 'claude' | 'droid') => LIVE.has(p);
const TRACE = process.env.DOR_DEMO_TRACE;
if (TRACE) writeFileSync(TRACE, '');

type Track = 'Cartesia' | 'Claude' | 'Human-in-the-loop' | 'SpacetimeDB' | 'Factory' | 'Boundary' | 'Meta';
const steps: { n: number; track: Track; actor: string; title: string; detail: Record<string, unknown>; evidence: string; ms: number }[] = [];
const t0 = performance.now();
function show(track: Track, actor: string, title: string, detail: Record<string, unknown>, evidence: string) {
  const s = { n: steps.length + 1, track, actor, title, detail, evidence, ms: Math.round(performance.now() - t0) };
  steps.push(s);
  if (TRACE) appendFileSync(TRACE, JSON.stringify(s) + '\n');
}

const ENTRY = 'I just finished a brutal lab. I am exhausted, but I really miss Sam.';
/** Offline stand-in for Claude, shaped exactly like the real adapter's reply (D040/D042). */
const SYNTHETIC_REPLY = { schemaVersion: 1,
  reflection: 'That lab sounds like it took a lot out of you. Missing Sam makes sense after a day like that; a short, easy call could be a soft landing.',
  candidate: { supportMode: 'short_call', availability: 'this_week' },
  assessment: { intent: 'wants_connection', excludedNames: [], preferredNames: ['Sam'] } } as const;

/** Cartesia live: speech for the entry (stand-in for a microphone) streamed through the real browser dictation. */
async function dictate(): Promise<{ transcript: string; detail: Record<string, unknown> }> {
  if (!live('cartesia')) return { transcript: ENTRY, detail: { transcript: ENTRY } };
  const session = await new CartesiaVoiceAdapter().createSession('demo');
  let wav!: ArrayBuffer;
  await speak(session, ENTRY, { play: async b => { wav = b; } }).done;
  const dv = new DataView(wav); const rate = dv.getUint32(24, true);
  let off = 12; while (new TextDecoder().decode(new Uint8Array(wav, off, 4)) !== 'data') off += 8 + dv.getUint32(off + 4, true);
  const pcm = new Int16Array(wav.slice(off + 8, off + 8 + dv.getUint32(off + 4, true)));
  const audio = new Int16Array(pcm.length + rate); audio.set(pcm); // + 1 s of silence to end the turn
  const mic = async (onFrame: (f: Float32Array, r: number) => void) => {
    let i = 0, stopped = false; const n = Math.round(rate / 50);
    const tick = () => { if (stopped || i >= audio.length) return;
      const f = new Float32Array(Math.min(n, audio.length - i)); for (let k = 0; k < f.length; k++) f[k] = audio[i + k]! / 32768;
      i += f.length; onFrame(f, rate); setTimeout(tick, 20); };
    tick(); return { stop: () => { stopped = true; } };
  };
  const d = new VoiceDictation({ getSession: async () => session, mic, socket: url => new WebSocket(url) as never, onChange: () => {} });
  const started = performance.now();
  await d.start();
  await new Promise(r => setTimeout(r, Math.ceil(audio.length / rate * 1000) + 300));
  const transcript = await d.stop();
  return { transcript, detail: { transcript, sttModel: session.sttModel, tokenLifetimeS: 60, streamMs: Math.round(performance.now() - started) } };
}

/** Droid transport: the real SDK when live, otherwise a recorded stand-in. Either way every prompt is captured. */
async function droidTransport(prompts: string[], usage: Record<string, unknown>[]): Promise<DroidTransport> {
  let inner: DroidTransport;
  if (live('droid')) {
    const specifier = '@factory/droid-sdk/node';
    const sdk = await import(specifier) as { createSession: never };
    inner = new DroidSdkTransport({ createSession: sdk.createSession, apiKey: process.env.FACTORY_API_KEY,
      env: droidEnv(process.env, { withKey: false }) });
  } else {
    inner = { call: async () => ({ reply: { decision: 'compatible', optionIndex: 0 },
      usage: { factoryCredits: null, cacheReadTokens: null, cacheCreationTokens: null } }), close: async () => {} };
  }
  return { call: async req => { prompts.push(req.prompt); const r = await inner.call(req); usage.push(r.usage); return r; },
    close: () => inner.close() };
}

afterAll(() => {
  // Written straight to stdout: vitest does not surface console output from afterAll hooks.
  const out = (l = '') => process.stdout.write(l + '\n');
  const line = '─'.repeat(100);
  out(`\n${line}\ndor backend demo · live: ${[...LIVE].join(', ') || 'none (offline, synthetic providers)'}\n${line}`);
  for (const s of steps) {
    out(`\n${String(s.n).padStart(2)}. [${s.track}] ${s.actor} — ${s.title}   (+${s.ms} ms, ${s.evidence})`);
    for (const [k, v] of Object.entries(s.detail)) out(`      ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  }
  out(`\n${line}`);
});

describe('backend demo: Alex → Sam', () => {
  it('voice → private reflection → owner picks Sam → approval → Factory worker → Sam\'s live nudge; boundaries hold', async () => {
    // World: Alex (sender) and Sam (recipient) are paired; Carol is a signed-in third account with no pair.
    const w = setup();
    const [alex, sam, carol] = [w.alice, w.bob, w.carol];
    const { pairId } = pairUp(w);
    confirmPreset(w, alex, pairId, 'partner', ['support_preference', 'coarse_availability']);
    w.call(sam, ctx => mod.set_nudge_delivery(ctx, { pair_id: pairId, opted_in: true, quiet_start_minute: undefined,
      quiet_end_minute: undefined, utc_offset_minutes: 0 }));
    grantPrefs(w, sam, pairId, ['short_call', 'encouraging_note'], ['today', 'this_week']);
    const worker = jwtAuth('dor-worker', 50n, 'https://worker.spacetimedb.example');
    const workerId = w.h.withReducerTx(worker, ctx => ctx.sender);
    w.h.withReducerTx(w.admin, ctx => mod.set_worker_identity(ctx, { worker: workerId, enabled: true }));
    show('SpacetimeDB', 'setup', 'Alex and Sam are paired; Sam opted into nudges and chose what support is welcome',
      { samAccepts: ['short_call', 'encouraging_note'], samWindows: ['today', 'this_week'], carol: 'signed in, not paired' }, 'module');

    // 1. Voice entry (Cartesia).
    const voice = await dictate();
    show('Cartesia', 'Alex', 'records a voice journal entry; streaming speech-to-text fills the entry', voice.detail,
      live('cartesia') ? 'live Cartesia (browser dictation code, short-lived token)' : 'synthetic transcript');

    // 2. Private reflection + assessment (Claude), through the real authenticated route handler.
    const port = live('claude') ? new ClaudeReflectionAdapter() : new SyntheticReflectionAdapter(SYNTHETIC_REPLY as never);
    const res = await handleReflectionRequest(new Request('http://demo/api/reflections', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ selectedText: voice.transcript, clientRequestId: 'demo-1' }) }),
    { session: { configured: true, userId: 'synthetic-alex' }, reflection: port });
    expect(res.status).toBe(200);
    const reflection = await res.json();
    show('Claude', 'Alex (owner only)', 'gets a private reflection and an owner-only assessment of who they want to hear from',
      { reflection: reflection.reflection, draftCandidate: reflection.candidate, assessment: reflection.assessment,
        persisted: 'reflection text only, encrypted in Alex\'s local vault', neverSent: 'entry, candidate, assessment' },
      live('claude') ? 'live Claude (Opus 5.5, structured output)' : 'synthetic reply in the real adapter shape');
    if (!reflection.candidate) {
      show('Meta', 'dor', 'chooses silence: nothing to share, so nobody is asked or nudged', {}, 'real decision loop');
      return;
    }

    // 3. Human in the loop: the decision loop narrows with the assessment; Alex chooses; nothing is sent yet.
    const connections = [{ pairId, name: 'Sam' }, { pairId: 'pair-jordan-synthetic', name: 'Jordan' }];
    const options = () => assessedRecipients(connections, reflection.assessment);
    let loop = initialLoopState(reflection.candidate, reflection.assessment);
    const asked: { question: string; answer: string }[] = [];
    let out = decide(loop, options());
    // Walk the real loop the way Alex would: answer each private question until the exact preview (≤ 2 questions).
    while (out.kind === 'needs_clarification') {
      if (out.question === 'company') { loop = answerCompany(loop, 'company'); asked.push({ question: QUESTION_COPY.company, answer: 'Company would be nice' }); }
      else { asked.push({ question: QUESTION_COPY.who, answer: `Sam (offered: ${out.options.map(o => o.name).join(', ')})` }); loop = answerWho(loop, pairId); }
      out = decide(loop, options());
    }
    expect(out.kind).toBe('ready_for_preview');
    const template = templateForSignal(reflection.candidate)!;
    show('Human-in-the-loop', 'Alex', 'answers private, neutral questions (never pre-picked), taps Sam, and sees the exact preview',
      { assessmentIntent: reflection.assessment?.intent, privateQuestions: asked,
        samWouldSee: NUDGE_TEMPLATE_COPY[template], sharedFields: reflection.candidate }, 'real decision loop (CS) + D040 helpers');

    // 4. Explicit approval → SpacetimeDB (enums only).
    const args = approveArgs(w, alex, pairId, { support_mode: reflection.candidate.supportMode,
      availability: reflection.candidate.availability }, 'demo-approve');
    w.call(alex, ctx => mod.approve_signal(ctx, args));
    const signal = allSignals(w).find(s => s.client_request_id === 'demo-approve')!;
    const workerRow = view<Record<string, unknown>>(w, worker, mod.worker_signal_context)[0]!;
    show('SpacetimeDB', 'Alex', 'approves; the reducer re-checks consent and stores an enum-only approved signal',
      { stored: { support_mode: signal.support_mode, availability: signal.availability, consent_version: signal.consent_version },
        textStored: 'none', workerViewColumns: Object.keys(workerRow).length, carolSeesSignals: view(w, carol, mod.my_signals).length },
      'real module in-process');

    // 5. Factory: the worker reacts to the new approved signal and runs one bounded Droid SDK session.
    const prompts: string[] = [], usage: Record<string, unknown>[] = [];
    const transport = await droidTransport(prompts, usage);
    const source: WorkerStateSource = {
      signalContext: async () => view(w, worker, mod.worker_signal_context),
      delivery: async () => view(w, worker, mod.worker_delivery),
      supportPreferences: async () => view(w, worker, mod.worker_support_preferences),
      commitNudge: async a => { w.call(worker, ctx => mod.commit_nudge(ctx, a)); },
    };
    const lw = createLiveWorker({ authToken: 'synthetic-worker-token-0123456789abcdef', ...spacetimeWorkerPorts(source),
      clock: { now: () => w.h.clock.now().toDate() }, droid: { transport, timeoutMs: 20_000 } });
    const outcomes: Record<string, unknown>[] = [];
    await new SignalWatcher(source, { run: j => lw.runJob(j), onOutcome: os => outcomes.push(...os) }).sweep();
    await lw.close();
    const prompt = prompts[0] ?? '';
    // Whole words from the private story, names and the reflection must never reach the Droid ("lab" is inside "availability").
    for (const word of ['lab', 'brutal', 'exhausted', 'miss', 'sam', 'alex']) expect(prompt).not.toMatch(new RegExp(`\\b${word}\\b`, 'i'));
    expect(prompt).not.toContain(reflection.reflection.slice(0, 30));
    show('Factory', 'worker (Droid SDK)', 'policy check → one locked-down Droid session picks the lowest-pressure option → guarded commit',
      { trigger: 'new row in worker_signal_context (event-driven sweep)', droidSaw: prompt.split('\n').filter(l => /Approved|^\d+:/.test(l)),
        droidNeverSaw: 'journal, reflection, names, assessment', droidCalls: prompts.length, usage: usage[0],
        outcome: outcomes.map(o => ({ outcome: o.outcome, rounds: o.rounds, decidedBy: o.decidedBy })) },
      live('droid') ? 'live Factory Droid SDK' : 'recorded Droid stand-in; real coordinator, policy and commit');

    // 6. Sam's view updates (in a browser this arrives over the live subscription).
    const samRows = view<Record<string, unknown>>(w, sam, mod.my_nudges);
    expect(samRows).toHaveLength(1);
    expect(Object.keys(samRows[0]!).sort()).toEqual(['id', 'pair_id', 'template_id', 'visible_until']);
    show('SpacetimeDB', 'Sam', 'sees a nudge appear: fixed, approved copy only (D043 narrow row)',
      { samSees: NUDGE_TEMPLATE_COPY[samRows[0]!.template_id as keyof typeof NUDGE_TEMPLATE_COPY], rowColumns: Object.keys(samRows[0]!),
        notIncluded: 'entry, reflection, mood, exact times, signal ids' }, 'real module in-process');

    // 7. Boundaries.
    const carolNudges = view(w, carol, mod.my_nudges).length;
    w.call(alex, ctx => mod.revoke_signal(ctx, { signal_id: signal.signal_id }));
    const afterRevoke = view(w, sam, mod.my_nudges).length;
    expect([carolNudges, afterRevoke]).toEqual([0, 0]);
    show('Boundary', 'Carol / Alex', 'a third account sees nothing; Alex revokes and Sam\'s nudge disappears',
      { carolSeesNudges: carolNudges, samNudgesAfterRevoke: afterRevoke }, 'real module in-process');

    show('Meta', 'Sam', 'decides whether to reach out to Alex: dor never messages anyone for them',
      { samsChoice: NUDGE_TEMPLATE_COPY[template] }, 'product rule');
  }, 120_000);
});
