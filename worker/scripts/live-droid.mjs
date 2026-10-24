// Live Factory Droid check of the bounded exchange with synthetic fixtures.
// REAL: droid exec subprocess and model call. OFFLINE STAND-INS (labeled in output): contracts FakeDisclosurePolicy
// and fixture recipient preferences, until Cyber's policy and CS's SpacetimeDB adapters exist.
// Usage: node scripts/live-droid.mjs [--runs N]
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { FakeClock, FakeDisclosurePolicy } from '@kinetic/contracts/fakes';
import { BoundedCoordinator } from '@kinetic/agents';
import { DroidAckProposer } from '../dist/index.js';

try { process.loadEnvFile(new URL('../../.env.local', import.meta.url)); } catch { /* optional */ }
const runsArg = process.argv.indexOf('--runs');
const runs = runsArg === -1 ? 1 : Math.max(1, Math.min(10, Number(process.argv[runsArg + 1]) || 1));
const json = async (url) => JSON.parse(await readFile(new URL(url, import.meta.url), 'utf8'));
const scenarios = await json('../../contracts/fixtures/scenarios.json');
const { preferences } = await json('../../src/agents/fixtures/coordination.synthetic.json');
const standIns = { policy: 'offline FakeDisclosurePolicy', preferences: 'synthetic fixture', commit: 'none' };

const version = spawnSync(process.env.KINETIC_DROID_PATH || 'droid', ['--version'], { encoding: 'utf8' });
if (version.status !== 0) {
  console.log(JSON.stringify({ check: 'factory.droid', status: 'SKIPPED_MISSING_RUNTIME', missing: 'droid CLI on PATH' }));
  process.exit(0);
}
console.log(JSON.stringify({ check: 'factory.droid.runtime', droidVersion: version.stdout.trim(), node: process.version,
  auth: process.env.FACTORY_API_KEY ? 'FACTORY_API_KEY' : 'droid CLI login' }));

function coordinatorFor(signal, { revoked = false } = {}) {
  const clock = new FakeClock(new Date().toISOString());
  const state = { clock, linked: true, revoked, approved: structuredClone(signal),
    preset: { schemaVersion: 1, policyId: signal.recipientPolicyId, ownerId: signal.senderId, presetKind: 'partner',
      purpose: 'support_nudge', allowedCategories: ['support_preference', 'coarse_availability'], approvalMode: 'each_item',
      version: signal.recipientPolicyVersion, expiresAt: signal.expiresAt, revokedAt: null },
    assignment: { schemaVersion: 1, ownerId: signal.senderId, recipientId: signal.recipientId, pairId: signal.pairId,
      presetId: signal.recipientPolicyId, assignmentVersion: signal.presetAssignmentVersion } };
  let proposerCalls = 0;
  const droid = new DroidAckProposer({ droidPath: process.env.KINETIC_DROID_PATH || undefined,
    timeoutMs: Number(process.env.KINETIC_DROID_TIMEOUT_MS) || undefined });
  const proposer = { propose: (input, id) => { proposerCalls++; return droid.propose(input, id); } };
  const coordinator = new BoundedCoordinator({ policy: new FakeDisclosurePolicy(state), clock, proposer,
    preferences: { current: async () => preferences[scenarios.find(s => s.approvedSignal === signal).scenario] } });
  return { coordinator, calls: () => proposerCalls };
}

const latencies = [];
let failures = 0;
for (let run = 1; run <= runs; run++) {
  for (const { scenario, approvedSignal, expectedTemplate } of scenarios) {
    const { coordinator, calls } = coordinatorFor(approvedSignal);
    const t = performance.now();
    const result = await coordinator.coordinate([approvedSignal], `live-${scenario}-${run}-${Date.now()}`);
    const latencyMs = Math.round(performance.now() - t);
    const [outcome] = result.outcomes, nudge = result.proposedNudges[0];
    const agentDecided = outcome.outcome === 'nudge_proposed' && outcome.decidedBy === 'agent';
    const status = agentDecided && nudge?.templateId === expectedTemplate ? 'LIVE_PASS'
      : nudge?.templateId === expectedTemplate ? 'LIVE_DEGRADED_FALLBACK' : 'LIVE_FAIL';
    if (status === 'LIVE_FAIL') failures++;
    if (agentDecided) latencies.push(latencyMs);
    console.log(JSON.stringify({ check: `factory.coordination.${scenario}`, run, status, latencyMs, droidCalls: calls(),
      outcome: outcome.outcome, rounds: outcome.rounds, decidedBy: outcome.decidedBy, templateId: nudge?.templateId ?? null,
      expectedTemplate, standIns }));
  }
}

const revokedSignal = scenarios[0].approvedSignal;
const revoked = coordinatorFor(revokedSignal, { revoked: true });
const revokedResult = await revoked.coordinator.coordinate([revokedSignal], `live-revoked-${Date.now()}`);
const revokedOk = revokedResult.outcomes[0].outcome === 'policy_denied' && revoked.calls() === 0;
if (!revokedOk) failures++;
console.log(JSON.stringify({ check: 'factory.coordination.revoked_before_use', status: revokedOk ? 'LIVE_PASS' : 'LIVE_FAIL',
  outcome: revokedResult.outcomes[0].outcome, droidCalls: revoked.calls(), standIns }));

const sorted = [...latencies].sort((a, b) => a - b);
const pct = (p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] : null;
console.log(JSON.stringify({ summary: true, agentDecidedRuns: sorted.length, medianMs: pct(0.5), p95Ms: pct(0.95), failures }));
process.exitCode = failures ? 1 : 0;
