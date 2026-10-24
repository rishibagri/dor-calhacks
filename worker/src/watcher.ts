import type { CoordinationJob, CoordinationOutcome } from '@dor/contracts';
import type { WorkerStateSource } from './spacetime/adapters.js';
import { mapRows, toSignalContext } from './spacetime/rows.js';
import { isDisconnected } from './spacetime/connection.js';

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
      const job: CoordinationJob = { schemaVersion: 1, jobId: `job_${signal.signalId}`, pairId: signal.pairId,
        requestId: signal.signalId, signalIds: [signal.signalId], createdAt: new Date().toISOString() };
      try {
        const outcomes = await this.options.run(job);
        this.done.add(signal.signalId);
        this.attempts.delete(signal.signalId);
        this.options.onOutcome?.(outcomes);
      } catch (error) {
        if (!isDisconnected(error)) this.attempts.set(signal.signalId, (this.attempts.get(signal.signalId) ?? 0) + 1);
        this.options.onError?.(error);
      }
    }
    return pending.length;
  }
}
