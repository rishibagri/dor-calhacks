import { DisclosurePolicy, type Clock, type PolicyStateReader } from '@kinetic/contracts';
import { BoundedCoordinator, type CoordinatorDeps, type DeliveryStatePort, type RecipientPreferencesPort }
  from '@kinetic/agents';
import { DroidAckProposer, type DroidAckProposerOptions } from './droid-proposer.js';
import { JobLedger, runCoordinationJob, type ApprovedSignalSource, type CoordinationCommitPort } from './jobs.js';
import { createJobRequestHandler } from './server.js';

/**
 * Production wiring. Every input is an authoritative adapter supplied by its owner; there is deliberately no
 * way to pass a policy object, so a fake policy cannot be wired into live mode.
 */
export interface LiveWorkerConfig {
  /** KINETIC_WORKER_AUTH_TOKEN, at least 32 characters. */
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
}

export function createLiveWorker(config: LiveWorkerConfig) {
  const clock = config.clock ?? { now: () => new Date() };
  const proposer = new DroidAckProposer(config.droid);
  const coordinator = new BoundedCoordinator({
    policy: new DisclosurePolicy(config.policyState, clock), preferences: config.preferences,
    delivery: config.delivery, proposer, clock, rank: config.rank,
  });
  const deps = { signals: config.signals, coordinator, commit: config.commit, ledger: new JobLedger() };
  const handler = createJobRequestHandler({ authToken: config.authToken, ...deps });
  /** Same ledger as the HTTP handler, so a watcher-started job and a POSTed retry share one run. */
  const runJob = (job: unknown) => runCoordinationJob(job, deps);
  return { handler, runJob, coordinator, close: () => proposer.close() };
}
