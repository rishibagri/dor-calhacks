// Live Factory Droid check of the bounded exchange with synthetic fixtures.
// REAL: droid exec subprocess and model call. OFFLINE STAND-INS (labeled in output): contracts FakeDisclosurePolicy,
// fixture recipient preferences and delivery state. This is an isolated Droid check, not end-to-end verification.
// Usage: node scripts/live-droid.mjs [--runs N] [--model ID] [--transport sdk|cli]   (model also via DOR_DROID_MODEL)
// Default transport is the @factory/droid-sdk warm-session path (needs FACTORY_API_KEY); --transport cli uses droid exec.
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { FakeClock, FakeDisclosurePolicy } from '@dor/contracts/fakes';
import { BoundedCoordinator } from '@dor/agents';
import { DEFAULT_DROID_MODEL, DroidAckProposer, DroidRunner, DroidSdkTransport, droidEnv } from '../dist/index.js';

try { process.loadEnvFile(new URL('../../.env.local', import.meta.url)); } catch { /* optional */ }
const arg = (name) => { const i = process.argv.indexOf(name); return i === -1 ? undefined : process.argv[i + 1]; };
const runs = Math.max(1, Math.min(10, Number(arg('--runs')) || 1));
const model = arg('--model') || process.env.DOR_DROID_MODEL || DEFAULT_DROID_MODEL;
// Same default as the worker: the SDK transport; `--transport cli` measures the per-call droid exec path.
const transportKind = arg('--transport') === 'cli' ? 'cli' : 'sdk';
const json = async (url) => JSON.parse(await readFile(new URL(url, import.meta.url), 'utf8'));
const scenarios = await json('../../contracts/fixtures/scenarios.json');
const { preferences, defaultDelivery } = await json('../../src/agents/fixtures/coordination.synthetic.json');
const standIns = { policy: 'offline FakeDisclosurePolicy', preferences: 'synthetic fixture', delivery: 'synthetic opted-in fixture', commit: 'none' };

const version = spawnSync(process.env.DOR_DROID_PATH || 'droid', ['--version'], { encoding: 'utf8' });
if (version.status !== 0) {
  console.log(JSON.stringify({ check: 'factory.droid', status: 'SKIPPED_MISSING_RUNTIME', missing: 'droid CLI on PATH' }));
  process.exit(0);
}
console.log(JSON.stringify({ check: 'factory.droid.runtime', droidVersion: version.stdout.trim(), node: process.version, model,
  transport: transportKind, auth: process.env.FACTORY_API_KEY ? 'FACTORY_API_KEY' : 'droid CLI login' }));

let transport;
if (transportKind === 'sdk') {
  const specifier = '@factory/droid-sdk/node';
  let sdk;
  try { sdk = await import(specifier); } catch {
    console.log(JSON.stringify({ check: 'factory.droid.sdk', status: 'SKIPPED_MISSING_RUNTIME', missing: '@factory/droid-sdk' }));
    process.exit(0);
  }
  if (!process.env.FACTORY_API_KEY) {
    console.log(JSON.stringify({ check: 'factory.droid.sdk', status: 'SKIPPED_MISSING_CREDENTIAL', missing: 'FACTORY_API_KEY' }));
    process.exit(0);
  }
  transport = new DroidSdkTransport({ createSession: sdk.createSession, apiKey: process.env.FACTORY_API_KEY, model,
    droidPath: process.env.DOR_DROID_PATH || undefined, env: droidEnv(process.env, { withKey: false }) });
}

// One proposer for the whole run, as in the worker: its reused workdir is what lets the prompt cache hit.
const usage = [];
const droid = new DroidAckProposer({ runner: new DroidRunner({ model, droidPath: process.env.DOR_DROID_PATH || undefined,
  timeoutMs: Number(process.env.DOR_DROID_TIMEOUT_MS) || undefined, onUsage: (u) => usage.push(u), transport }) });

// Friends with a sender window gives two eligible options, so the model has a real choice to make.
const cases = [
  ...scenarios.map(s => ({ name: s.scenario, signal: s.approvedSignal, prefs: preferences[s.scenario], expectedTemplate: s.expectedTemplate })),
  { name: 'friends_two_options', signal: { ...scenarios.find(s => s.scenario === 'friends').approvedSignal, availability: 'this_week' },
    prefs: preferences.friends, expectedTemplate: 'offer_shared_activity' },
];

function coordinatorFor(signal, prefs, { revoked = false } = {}) {
  const clock = new FakeClock(new Date().toISOString());
  const state = { clock, linked: true, revoked, approved: structuredClone(signal),
    preset: { schemaVersion: 1, policyId: signal.recipientPolicyId, ownerId: signal.senderId, presetKind: 'partner',
      purpose: 'support_nudge', allowedCategories: ['support_preference', 'coarse_availability'], approvalMode: 'each_item',
      version: signal.recipientPolicyVersion, expiresAt: signal.expiresAt, revokedAt: null },
    assignment: { schemaVersion: 1, ownerId: signal.senderId, recipientId: signal.recipientId, pairId: signal.pairId,
      presetId: signal.recipientPolicyId, assignmentVersion: signal.presetAssignmentVersion } };
  let proposerCalls = 0;
  const proposer = { propose: (input, id) => { proposerCalls++; return droid.propose(input, id); } };
  const coordinator = new BoundedCoordinator({ policy: new FakeDisclosurePolicy(state), clock, proposer,
    preferences: { current: async () => prefs },
    delivery: { current: async () => ({ delivery: defaultDelivery, lastNudgeAt: null }) } });
  return { coordinator, calls: () => proposerCalls };
}

const latencies = [];
let failures = 0, fallbacks = 0;
try {
  for (let run = 1; run <= runs; run++) {
    for (const c of cases) {
      const { coordinator, calls } = coordinatorFor(c.signal, c.prefs);
      const t = performance.now();
      const result = await coordinator.coordinate([c.signal], `live-${c.name}-${run}-${Date.now()}`);
      const latencyMs = Math.round(performance.now() - t);
      const [outcome] = result.outcomes, nudge = result.proposedNudges[0];
      const agentDecided = outcome.outcome === 'nudge_proposed' && outcome.decidedBy === 'agent';
      const status = agentDecided && nudge?.templateId === c.expectedTemplate ? 'LIVE_PASS'
        : nudge?.templateId === c.expectedTemplate ? 'LIVE_DEGRADED_FALLBACK' : 'LIVE_FAIL';
      if (status === 'LIVE_FAIL') failures++;
      if (status === 'LIVE_DEGRADED_FALLBACK') fallbacks++;
      if (agentDecided) latencies.push(latencyMs);
      console.log(JSON.stringify({ check: `factory.coordination.${c.name}`, run, status, latencyMs, droidCalls: calls(),
        outcome: outcome.outcome, rounds: outcome.rounds, decidedBy: outcome.decidedBy, templateId: nudge?.templateId ?? null,
        expectedTemplate: c.expectedTemplate, standIns }));
    }
  }

  const revokedCase = cases[0];
  const revoked = coordinatorFor(revokedCase.signal, revokedCase.prefs, { revoked: true });
  const revokedResult = await revoked.coordinator.coordinate([revokedCase.signal], `live-revoked-${Date.now()}`);
  const revokedOk = revokedResult.outcomes[0].outcome === 'policy_denied' && revoked.calls() === 0;
  if (!revokedOk) failures++;
  console.log(JSON.stringify({ check: 'factory.coordination.revoked_before_use', status: revokedOk ? 'LIVE_PASS' : 'LIVE_FAIL',
    outcome: revokedResult.outcomes[0].outcome, droidCalls: revoked.calls(), standIns }));
} finally {
  await droid.close();
}

const pct = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] : null;
};
const credits = usage.map(u => u.factoryCredits).filter(n => typeof n === 'number');
const cacheRead = usage.map(u => u.cacheReadTokens).filter(n => typeof n === 'number');
console.log(JSON.stringify({ summary: true, model, transport: transportKind, agentDecidedRuns: latencies.length, fallbacks, failures,
  coordinateMedianMs: pct(latencies, 0.5), coordinateP95Ms: pct(latencies, 0.95),
  droidCalls: usage.length, droidCallMedianMs: pct(usage.map(u => u.durationMs), 0.5),
  creditsTotal: credits.reduce((a, b) => a + b, 0), creditsMedianPerCall: pct(credits, 0.5), creditsMaxPerCall: pct(credits, 1),
  cacheReadMedianPerCall: pct(cacheRead, 0.5),
  callOutcomes: usage.reduce((acc, u) => ({ ...acc, [u.outcome ?? 'ok']: (acc[u.outcome ?? 'ok'] ?? 0) + 1 }), {}) }));
process.exitCode = failures ? 1 : 0;
