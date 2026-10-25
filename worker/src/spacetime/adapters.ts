import type { PolicyStateReader } from '@dor/contracts';
import { defaultSupportPreferences as makeDefaultSupportPreferences } from '@dor/contracts/policy';
import type { DeliveryStatePort, RecipientPreferencesPort } from '@dor/agents';
import type { ApprovedSignalSource, CommitRejection, CoordinationCommitPort, CoordinationResult } from '../jobs.js';
import { DEFAULT_DELIVERY, mapRows, toApprovedSignal, toDeliveryContext, toSignalContext, toSupportPreferences } from './rows.js';

/** commit_nudge reducer arguments (spacetimedb/src/reducers/coordination.ts). */
export interface CommitNudgeArgs {
  nudge_id: string;
  pair_id: string;
  template_id: string;
  source_signal_ids: string[];
  source_consent_versions: number[];
  /** The recipient preference consent the coordinator's ACK was based on (D035); commit_nudge rechecks it. */
  recipient_consent_id: string;
  recipient_consent_version: number;
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
  /** Current rows of the worker_support_preferences view (D035). A source without it has no consent: no nudge. */
  supportPreferences?(): Promise<Iterable<unknown>>;
  /** Calls commit_nudge; rejects with the reducer's `code: reason` message on refusal. */
  commitNudge(args: CommitNudgeArgs): Promise<void>;
  /** Current rows of the worker_plan_candidates view (D039). A source without it proposes no plans. */
  planCandidates?(): Promise<Iterable<unknown>>;
  /** Calls commit_plan_proposal; rejects with the reducer's `code: reason` message on refusal. */
  commitPlanProposal?(args: CommitPlanArgs): Promise<void>;
  /** Calls commit_introduction_proposal (D038); rejects with the reducer's `code: reason` message on refusal. */
  commitIntroductionProposal?(args: CommitIntroductionArgs): Promise<void>;
  /** Current rows of the worker_introduction_requests view (D048). A source without it makes no suggestions. */
  introductionRequests?(): Promise<Iterable<unknown>>;
  /** Calls close_introduction_suggestion_request (D048); rejects with the reducer's `code: reason` message. */
  closeIntroductionRequest?(requestId: string): Promise<void>;
}

/** commit_introduction_proposal reducer arguments (spacetimedb/src/reducers/introductions.ts, D033/D038). */
export interface CommitIntroductionArgs {
  proposal_id: string;
  viewer_ref: string;
  candidate_ref: string;
  viewer_publication_version: number;
  candidate_publication_version: number;
  reason_code: string;
  shared_tags: string[];
  event_id?: string;
  opener_id: string;
  decided_by: string;
  expires_at: string;
}

/** commit_plan_proposal reducer arguments (spacetimedb/src/reducers/events.ts, D034/D039). */
export interface CommitPlanArgs {
  plan_id: string;
  basis_kind: string;
  basis_ref: string;
  event_id: string;
  intent_ids: string[];
  intent_versions: number[];
  approval_ids: string[];
  expires_at: string;
  decided_by: string;
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

/** Accepted pairs default to in-app nudges; a persisted recipient opt-out remains an explicit false row. */
export class SpacetimeDeliveryState implements DeliveryStatePort {
  constructor(private readonly source: WorkerStateSource) {}

  async current(pairId: string, recipientId: string) {
    // A malformed explicit row could be a recipient's opt-out. Do not drop it and then mistake it for the default-on case.
    const rows = [...await this.source.delivery()].map(row => toDeliveryContext(row as Parameters<typeof toDeliveryContext>[0]));
    const row = rows
      .find(d => d.pairId === pairId && d.recipientId === recipientId);
    return row ? { delivery: row.delivery, lastNudgeAt: row.lastNudgeAt } : { delivery: DEFAULT_DELIVERY, lastNudgeAt: null };
  }
}

/** Recipient support styles personalize proposals; accepted pairs use the standard styles until customized. */
export class SpacetimeRecipientPreferences implements RecipientPreferencesPort {
  constructor(private readonly source: WorkerStateSource) {}

  async current(pairId: string, recipientId: string) {
    if (!this.source.supportPreferences) return defaultSupportPreferences(pairId, recipientId);
    return mapRows(await this.source.supportPreferences(), toSupportPreferences)
      .find(p => p.pairId === pairId && p.recipientId === recipientId) ?? defaultSupportPreferences(pairId, recipientId);
  }
}

function defaultSupportPreferences(pairId: string, recipientId: string) {
  const pref = makeDefaultSupportPreferences(pairId, recipientId);
  return { schemaVersion: 1 as const, consentId: pref.consentId, consentVersion: pref.consentVersion,
    pairId, recipientId, purpose: 'support_nudge' as const, supportModes: [...pref.supportModes], availability: [...pref.availability],
    expiresAt: new Date(pref.expiresAtMs).toISOString(), revokedAt: null };
}

/** Always "no consent record": proposes no nudge. Kept for callers that must run without the preferences view. */
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
      // Bind the exact recipient consent the compatible ACK for this nudge's source was based on.
      const ack = result.acknowledgements.find(a => a.decision === 'compatible' && nudge.sourceSignalIds.includes(a.signalId));
      if (!ack) { rejections.push({ nudgeId: nudge.id, outcome: 'policy_denied' }); continue; }
      try {
        await this.source.commitNudge({
          nudge_id: nudge.id, pair_id: nudge.pairId, template_id: nudge.templateId,
          source_signal_ids: [...nudge.sourceSignalIds], source_consent_versions: [...nudge.sourceConsentVersions],
          recipient_consent_id: ack.recipientConsentId, recipient_consent_version: ack.recipientConsentVersion,
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

/** All database-backed worker ports over one source. Preferences default to the worker_support_preferences view. */
export function spacetimeWorkerPorts(source: WorkerStateSource, preferences: RecipientPreferencesPort =
  new SpacetimeRecipientPreferences(source)) {
  return {
    policyState: new SpacetimePolicyStateReader(source), signals: new SpacetimeSignalSource(source),
    delivery: new SpacetimeDeliveryState(source), commit: new SpacetimeCommit(source), preferences,
  };
}
