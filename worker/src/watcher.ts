import type { CoordinationJob, CoordinationOutcome, CoordinationOutcomeCode } from '@dor/contracts';
import type { WorkerStateSource } from './spacetime/adapters.js';
import { mapRows, toSignalContext } from './spacetime/rows.js';
import { isDisconnected } from './spacetime/connection.js';

/**
 * Outcomes that depend only on the recipient's current settings (opt-in, quiet hours, cooldown, preference consent and
 * its modes). They mean "not now", not "never": the signal is retried on later sweeps while worker_signal_context
 * still lists it, so a recipient who opts in or consents after the approval still gets the nudge without a worker
 * restart. Each is decided by the coordinator's pre-checks before any model call, so a retry costs no model calls.
 */
const DEFERRED: ReadonlySet<CoordinationOutcomeCode> = new Set(['not_opted_in', 'quiet_hours', 'cooldown',
  'preferences_unavailable', 'no_intersection']);

export interface SignalWatcherOptions {
  /** Runs one job (normally runCoordinationJob with a JobLedger). */
  run: (job: CoordinationJob) => Promise<CoordinationOutcome[]>;
  /** Numbers/codes only; never log rows. */
  onOutcome?: (outcomes: CoordinationOutcome[]) => void;
  onError?: (error: unknown) => void;
  /**
   * Attempts per signal before it is left alone until the process restarts. Default 3. A dropped database
   * connection is not counted: the job is simply retried after reconnecting, and commit_nudge dedupes the
   * request-stable nudge ID if the first commit had already landed.
   */
  maxAttempts?: number;
}

/**
 * Turns newly visible approved signals into coordination jobs: one job per signal, with the signal ID as the
 * request ID. That makes the nudge ID stable across retries and restarts, so commit_nudge deduplicates, and
 * the coordinator's cooldown pre-check stops a restarted worker from spending model calls on a pair it has
 * already nudged. Sweeps never overlap; a sweep reads the worker view once.
 */
export class SignalWatcher {
  private readonly done = new Set<string>();
  private readonly attempts = new Map<string, number>();
  /** Deferred runs per signal: each retry needs a fresh jobId, since the JobLedger replays a completed jobId. */
  private readonly deferrals = new Map<string, number>();
  private sweeping: Promise<number> | null = null;

  constructor(private readonly source: WorkerStateSource, private readonly options: SignalWatcherOptions) {}

  /** Returns the number of jobs started. */
  sweep(): Promise<number> {
    this.sweeping ??= this.runSweep().finally(() => { this.sweeping = null; });
    return this.sweeping;
  }

  private async runSweep(): Promise<number> {
    const contexts = mapRows(await this.source.signalContext(), toSignalContext);
    const max = this.options.maxAttempts ?? 3;
    const pending = contexts.map(c => c.signal).filter(s => !this.done.has(s.signalId) &&
      (this.attempts.get(s.signalId) ?? 0) < max);
    for (const signal of pending) {
      // requestId stays the signal ID (stable nudge ID); only the jobId changes between deferred retries.
      const deferred = this.deferrals.get(signal.signalId) ?? 0;
      const job: CoordinationJob = { schemaVersion: 1,
        jobId: deferred === 0 ? `job_${signal.signalId}` : `job_${signal.signalId}_r${deferred}`, pairId: signal.pairId,
        requestId: signal.signalId, signalIds: [signal.signalId], createdAt: new Date().toISOString() };
      try {
        const outcomes = await this.options.run(job);
        this.attempts.delete(signal.signalId);
        if (outcomes.length > 0 && outcomes.every(o => DEFERRED.has(o.outcome))) {
          this.deferrals.set(signal.signalId, deferred + 1);
          // Report a deferral once, not on every sweep that retries it.
          if (deferred === 0) this.options.onOutcome?.(outcomes);
          continue;
        }
        this.done.add(signal.signalId);
        this.deferrals.delete(signal.signalId);
        this.options.onOutcome?.(outcomes);
      } catch (error) {
        if (!isDisconnected(error)) this.attempts.set(signal.signalId, (this.attempts.get(signal.signalId) ?? 0) + 1);
        this.options.onError?.(error);
      }
    }
    // Signals that left the view (revoked, expired, paused, unlinked) need no retry bookkeeping.
    const visible = new Set(contexts.map(c => c.signal.signalId));
    for (const id of this.deferrals.keys()) if (!visible.has(id)) this.deferrals.delete(id);
    return pending.length;
  }
}
