import { DisclosurePolicy, type Clock, type CoordinationPort, type PolicyStateReader } from '@dor/contracts';
import { BoundedCoordinator, type CoordinatorDeps, type DeliveryStatePort, type RecipientPreferencesPort }
  from '@dor/agents';
import { DroidAckProposer, DroidRunner, type DroidAckProposerOptions } from './droid-proposer.js';
import { JobLedger, runCoordinationJob, type ApprovedSignalSource, type CoordinationCommitPort } from './jobs.js';
import { createJobRequestHandler } from './server.js';

/**
 * Production wiring. Every input is an authoritative adapter supplied by its owner; there is deliberately no
 * way to pass a policy object, so a fake policy cannot be wired into live mode.
 */
export interface LiveWorkerConfig {
  /** DOR_WORKER_AUTH_TOKEN, at least 32 characters. */
  authToken: string;
  /** Cyber/CS: authoritative signal + pair/assignment/preset state for DisclosurePolicy (never the presented envelope). */
  policyState: PolicyStateReader;
  /** CS: worker-identity reads of approved envelopes. */
  signals: ApprovedSignalSource;
  /** CS/Cyber: the recipient's current consent record. */
  preferences: RecipientPreferencesPort;
  /** CS: opt-in, quiet hours and last nudge (D017/D018). */
  delivery: DeliveryStatePort;
  /** CS: commit_nudge reducer that runs guardNudgeCommit and is idempotent on nudge.id. */
  commit: CoordinationCommitPort;
  /** DS: optional ranking; may reorder or drop options, never add. */
  rank?: CoordinatorDeps['rank'];
  droid?: DroidAckProposerOptions;
  clock?: Clock;
  /** Aggregate model budget per job, slot wait included; past it the coordinator falls back. Default 25 s. */
  jobDeadlineMs?: number;
}

/** R0 budget: ≤ 2 Droid calls of ≤ 10 s each, plus queueing, inside 25 s; then deterministic fallback or no-op. */
export const DEFAULT_JOB_DEADLINE_MS = 25_000;

export function createLiveWorker(config: LiveWorkerConfig) {
  const clock = config.clock ?? { now: () => new Date() };
  const runner = new DroidRunner(config.droid);
  const policy = new DisclosurePolicy(config.policyState, clock);
  const deadlineMs = config.jobDeadlineMs ?? DEFAULT_JOB_DEADLINE_MS;
  // One coordinator per job, so each job's model calls share one deadline (the coordinator itself is stateless).
  const coordinator: CoordinationPort = {
    coordinate: (signals, requestId) => new BoundedCoordinator({
      policy, preferences: config.preferences, delivery: config.delivery, clock, rank: config.rank,
      proposer: new DroidAckProposer({ runner, deadlineAt: Date.now() + deadlineMs }),
    }).coordinate(signals, requestId),
  };
  const deps = { signals: config.signals, coordinator, commit: config.commit, ledger: new JobLedger() };
  const handler = createJobRequestHandler({ authToken: config.authToken, ...deps });
  /** Same ledger as the HTTP handler, so a watcher-started job and a POSTed retry share one run. */
  const runJob = (job: unknown) => runCoordinationJob(job, deps);
  /** The Droid slot pool: plan and introduction agents share it, so all model calls count against one concurrency cap. */
  return { handler, runJob, coordinator, runner, close: () => runner.close() };
}
