import { ApprovedSignalSchema, CoordinationJobSchema, CoordinationOutcomeSchema, type CoordinationJob,
  type CoordinationOutcome, type CoordinationPort } from '@kinetic/contracts';

export type CoordinationResult = Awaited<ReturnType<CoordinationPort['coordinate']>>;

export interface ApprovedSignalSource {
  /** Worker-identity read of approved envelopes by ID within one pair (CS: SpacetimeDB view or reducer). */
  approvedSignals(pairId: string, signalIds: string[]): Promise<unknown[]>;
}
export interface CoordinationCommitPort {
  /** Version-checked reducer call. It must revalidate consent and reject stale or revoked proposals. */
  commit(result: CoordinationResult, job: CoordinationJob): Promise<void>;
}
export interface JobDeps {
  signals: ApprovedSignalSource;
  coordinator: CoordinationPort;
  commit: CoordinationCommitPort;
}

export class InvalidJobError extends Error {
  constructor() { super('invalid_job'); this.name = 'InvalidJobError'; }
}

/** Runs one content-free job. Throws InvalidJobError so the transport can answer 422. */
export async function runCoordinationJob(rawJob: unknown, deps: JobDeps): Promise<CoordinationOutcome[]> {
  const parsedJob = CoordinationJobSchema.safeParse(rawJob);
  if (!parsedJob.success) throw new InvalidJobError();
  const job = parsedJob.data;
  const wanted = new Set(job.signalIds);
  const signals = (await deps.signals.approvedSignals(job.pairId, job.signalIds)).flatMap(raw => {
    const parsed = ApprovedSignalSchema.safeParse(raw);
    return parsed.success && parsed.data.pairId === job.pairId && wanted.has(parsed.data.signalId) ? [parsed.data] : [];
  });
  if (signals.length === 0) return [CoordinationOutcomeSchema.parse({ schemaVersion: 1, requestId: job.requestId,
    pairId: job.pairId, signalIds: job.signalIds, outcome: 'policy_denied', rounds: 0, decidedBy: 'none' })];
  const result = await deps.coordinator.coordinate(signals, job.requestId);
  await deps.commit.commit(result, job);
  return result.outcomes;
}
