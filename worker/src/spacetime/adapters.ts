import type { PolicyStateReader } from '@kinetic/contracts';
import type { DeliveryStatePort, RecipientPreferencesPort } from '@kinetic/agents';
import type { ApprovedSignalSource, CommitRejection, CoordinationCommitPort, CoordinationResult } from '../jobs.js';
import { mapRows, NOT_OPTED_IN, toApprovedSignal, toDeliveryContext, toSignalContext } from './rows.js';

/** commit_nudge reducer arguments (spacetimedb/src/reducers/coordination.ts). */
export interface CommitNudgeArgs {
  nudge_id: string;
  pair_id: string;
  template_id: string;
  source_signal_ids: string[];
  source_consent_versions: number[];
}

/**
 * What the worker reads and calls, as the allow-listed worker identity. Implemented over the module harness
 * (dry run) or a SpacetimeDB client connection (live). Rows are read fresh on every call: they are the
 * authoritative state the policy checks against, so they are never cached across checks here.
 */
export interface WorkerStateSource {
  /** Current rows of the worker_signal_context view (empty for a non-worker identity). */
  signalContext(): Promise<Iterable<unknown>>;
  /** Current rows of the worker_delivery view. */
  delivery(): Promise<Iterable<unknown>>;
  /** Calls commit_nudge; rejects with the reducer's `code: reason` message on refusal. */
  commitNudge(args: CommitNudgeArgs): Promise<void>;
}

/** DisclosurePolicy's authoritative reader. An unknown or unmappable signal is null (deny). */
export class SpacetimePolicyStateReader implements PolicyStateReader {
  constructor(private readonly source: WorkerStateSource) {}

  async load(signalId: string) {
    return mapRows(await this.source.signalContext(), toSignalContext)
      .find(c => c.signal.signalId === signalId) ?? null;
  }
}

/** Approved envelopes for a job, read from the worker view rather than taken from the job request. */
export class SpacetimeSignalSource implements ApprovedSignalSource {
  constructor(private readonly source: WorkerStateSource) {}

  async approvedSignals(pairId: string, signalIds: string[]) {
    const wanted = new Set(signalIds);
    return mapRows(await this.source.signalContext(), toSignalContext)
      .filter(c => c.signal.pairId === pairId && wanted.has(c.signal.signalId))
      .map(c => toApprovedSignal(c.signal));
  }
}

/** F5 pre-check state. No row means never opted in (D017), which the coordinator treats as no nudge. */
export class SpacetimeDeliveryState implements DeliveryStatePort {
  constructor(private readonly source: WorkerStateSource) {}

  async current(pairId: string, recipientId: string) {
    const row = mapRows(await this.source.delivery(), toDeliveryContext)
      .find(d => d.pairId === pairId && d.recipientId === recipientId);
    return row ? { delivery: row.delivery, lastNudgeAt: row.lastNudgeAt } : { delivery: NOT_OPTED_IN, lastNudgeAt: null };
  }
}

/**
 * Recipient support-preference consent has no authoritative table yet (CYBER-R1). Until it does, live mode
 * has no consent record and therefore proposes no nudge. Replace with a view-backed reader, never a fixture.
 */
export class UnavailableRecipientPreferences implements RecipientPreferencesPort {
  async current(): Promise<null> {
    return null;
  }
}

/** Reducer refusals that are a policy decision about this nudge (recorded), as opposed to an ops failure (retried). */
const DELIVERY_REASONS = new Set(['not_opted_in', 'quiet_hours', 'cooldown']);
const REFUSAL_CODES = new Set(['unauthorized', 'stale', 'invalid', 'not_found', 'rate_limited']);

export function classifyCommitError(error: unknown): CommitRejection['outcome'] | null {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const match = /^([a-z_]+): (.*)$/s.exec(message);
  if (!match) return null;
  const [, code, reason] = match;
  // A missing worker allow-list entry is a deployment fault, not a user decision: surface it.
  if (!REFUSAL_CODES.has(code!) || reason === 'worker only') return null;
  return DELIVERY_REASONS.has(reason!) ? reason as CommitRejection['outcome'] : 'policy_denied';
}

/** Commits each proposed nudge through commit_nudge, which re-runs guardNudgeCommit and dedupes on nudge_id. */
export class SpacetimeCommit implements CoordinationCommitPort {
  constructor(private readonly source: WorkerStateSource) {}

  async commit(result: CoordinationResult): Promise<CommitRejection[]> {
    const rejections: CommitRejection[] = [];
    for (const nudge of result.proposedNudges) {
      try {
        await this.source.commitNudge({
          nudge_id: nudge.id, pair_id: nudge.pairId, template_id: nudge.templateId,
          source_signal_ids: [...nudge.sourceSignalIds], source_consent_versions: [...nudge.sourceConsentVersions],
        });
      } catch (error) {
        const outcome = classifyCommitError(error);
        if (!outcome) throw error;
        rejections.push({ nudgeId: nudge.id, outcome });
      }
    }
    return rejections;
  }
}

/** All database-backed worker ports over one source. Preferences stay fail-closed until CYBER-R1. */
export function spacetimeWorkerPorts(source: WorkerStateSource, preferences: RecipientPreferencesPort =
  new UnavailableRecipientPreferences()) {
  return {
    policyState: new SpacetimePolicyStateReader(source), signals: new SpacetimeSignalSource(source),
    delivery: new SpacetimeDeliveryState(source), commit: new SpacetimeCommit(source), preferences,
  };
}
