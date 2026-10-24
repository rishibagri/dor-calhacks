import { ApprovedSignalSchema, CoordinationJobSchema, CoordinationOutcomeSchema, type CoordinationJob,
  type CoordinationOutcome, type CoordinationOutcomeCode, type CoordinationPort } from '@dor/contracts';

export type CoordinationResult = Awaited<ReturnType<CoordinationPort['coordinate']>>;

export interface ApprovedSignalSource {
  /** Worker-identity read of approved envelopes by ID within one pair (CS: SpacetimeDB view or reducer). */
  approvedSignals(pairId: string, signalIds: string[]): Promise<unknown[]>;
}
/** A proposed nudge the authoritative commit refused (e.g. revoked during generation, quiet hours at commit). */
export interface CommitRejection {
  nudgeId: string;
  outcome: Extract<CoordinationOutcomeCode, 'policy_denied' | 'not_opted_in' | 'quiet_hours' | 'cooldown'>;
}
export interface CoordinationCommitPort {
  /**
   * Version-checked reducer call. It must revalidate consent and reject stale or revoked proposals. Guard
   * refusals are returned so the job records them; transport or configuration failures throw so the job retries.
   */
  commit(result: CoordinationResult, job: CoordinationJob): Promise<void | CommitRejection[]>;
}
export interface JobDeps {
  signals: ApprovedSignalSource;
  coordinator: CoordinationPort;
  commit: CoordinationCommitPort;
  /** Replay protection; omit only in tests that exercise a single run. */
  ledger?: JobLedger;
}

export class InvalidJobError extends Error {
  constructor() { super('invalid_job'); this.name = 'InvalidJobError'; }
}
/** Same jobId, different pair, request or signals: refuse rather than guess which one is real. */
export class JobConflictError extends Error {
  constructor() { super('job_conflict'); this.name = 'JobConflictError'; }
}

/**
 * Per-process replay protection. Concurrent duplicates share one run; a completed job returns its recorded
 * outcomes without coordinating or committing again; a failed job is not recorded, so a retry runs fresh.
 * Across restarts, the commit_nudge reducer must also dedupe on the request-stable nudge ID.
 */
export class JobLedger {
  private readonly inFlight = new Map<string, { key: string; result: Promise<CoordinationOutcome[]> }>();
  private readonly done = new Map<string, { key: string; outcomes: CoordinationOutcome[]; at: number }>();
  constructor(private readonly limits = { maxEntries: 1000, ttlMs: 15 * 60 * 1000 },
    private readonly now: () => number = Date.now) {}

  run(job: CoordinationJob, work: () => Promise<CoordinationOutcome[]>): Promise<CoordinationOutcome[]> {
    const key = JSON.stringify([job.pairId, job.requestId, [...job.signalIds].sort()]);
    this.prune();
    const done = this.done.get(job.jobId);
    if (done) {
      if (done.key !== key) return Promise.reject(new JobConflictError());
      return Promise.resolve(structuredClone(done.outcomes));
    }
    const active = this.inFlight.get(job.jobId);
    if (active) return active.key === key ? active.result : Promise.reject(new JobConflictError());
    const result = work().then(outcomes => {
      this.done.set(job.jobId, { key, outcomes: structuredClone(outcomes), at: this.now() });
      return outcomes;
    }).finally(() => this.inFlight.delete(job.jobId));
    this.inFlight.set(job.jobId, { key, result });
    return result;
  }

  private prune(): void {
    const cutoff = this.now() - this.limits.ttlMs;
    for (const [id, entry] of this.done) if (entry.at < cutoff) this.done.delete(id);
    while (this.done.size > this.limits.maxEntries) this.done.delete(this.done.keys().next().value!);
  }
}

/** Runs one content-free job. Throws InvalidJobError so the transport can answer 422. */
export async function runCoordinationJob(rawJob: unknown, deps: JobDeps): Promise<CoordinationOutcome[]> {
  const parsedJob = CoordinationJobSchema.safeParse(rawJob);
  if (!parsedJob.success) throw new InvalidJobError();
  const job = parsedJob.data;
  return deps.ledger ? deps.ledger.run(job, () => coordinateJob(job, deps)) : coordinateJob(job, deps);
}

async function coordinateJob(job: CoordinationJob, deps: JobDeps): Promise<CoordinationOutcome[]> {
  const wanted = new Set(job.signalIds);
  const signals = (await deps.signals.approvedSignals(job.pairId, job.signalIds)).flatMap(raw => {
    const parsed = ApprovedSignalSchema.safeParse(raw);
    return parsed.success && parsed.data.pairId === job.pairId && wanted.has(parsed.data.signalId) ? [parsed.data] : [];
  });
  if (signals.length === 0) return [CoordinationOutcomeSchema.parse({ schemaVersion: 1, requestId: job.requestId,
    pairId: job.pairId, signalIds: job.signalIds, outcome: 'policy_denied', rounds: 0, decidedBy: 'none' })];
  const result = await deps.coordinator.coordinate(signals, job.requestId);
  const rejected = new Map((await deps.commit.commit(result, job) ?? []).map(r => [r.nudgeId, r.outcome]));
  return result.outcomes.map(o => {
    const refusal = o.nudgeId ? rejected.get(o.nudgeId) : undefined;
    if (!refusal) return o;
    const { nudgeId: _dropped, ...rest } = o;
    return CoordinationOutcomeSchema.parse({ ...rest, outcome: refusal });
  });
}
