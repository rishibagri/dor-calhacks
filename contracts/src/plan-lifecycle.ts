/**
 * PROPOSED shared-plan lifecycle (D034; Cyber guard review and CS state review pending). Runtime-dependency-free
 * so a reducer can import it (`@dor/contracts/plan-lifecycle`). It is the transition rule only: the
 * reducer supplies the authenticated actor, an authoritative clock and CURRENT source checks, and owns storage.
 *
 * A plan is confirmed only when both participants accepted the SAME revision while the event is still
 * scheduled, both event intents are still published, neither has blocked the other and the plan has not
 * expired. Anything else refuses. Nothing here books, RSVPs, messages or buys anything.
 */

export const PLAN_STATUSES = ['pending', 'confirmed', 'declined', 'cancelled', 'expired', 'stale'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];
const TERMINAL: ReadonlySet<PlanStatus> = new Set(['declined', 'cancelled', 'expired', 'stale']);

export interface PlanState {
  planId: string;
  revision: number;
  /** Exactly two distinct participant refs. */
  participants: readonly [string, string];
  /** Participants who accepted THIS revision. */
  acceptedBy: readonly string[];
  status: PlanStatus;
  expiresAtMs: number;
  eventStartsAtMs: number;
}

export type PlanAction =
  | { kind: 'accept' | 'decline'; actor: string; revision: number }
  | { kind: 'cancel'; actor: string };

/** Authoritative facts the reducer reads in the same transaction as the write. */
export interface PlanSourceCheck {
  nowMs: number;
  eventScheduled: boolean;
  /** Both participants' event intents for this event are still published (not revoked or expired). */
  intentsCurrent: boolean;
  /** Either participant blocked the other. */
  blocked: boolean;
}

export type PlanRefusal = 'not_participant' | 'closed' | 'expired' | 'stale_revision' | 'stale_source' | 'already_accepted';
export type PlanTransition = { ok: true; state: PlanState } | { ok: false; reason: PlanRefusal; state: PlanState };

const refuse = (reason: PlanRefusal, state: PlanState): PlanTransition => ({ ok: false, reason, state });

/** Read-time status: a pending or confirmed plan whose time or sources lapsed is no longer live. */
export function currentPlanStatus(state: PlanState, check: PlanSourceCheck): PlanStatus {
  if (TERMINAL.has(state.status)) return state.status;
  if (check.blocked || !check.eventScheduled || !check.intentsCurrent) return 'stale';
  if (check.nowMs >= state.eventStartsAtMs || (state.status === 'pending' && check.nowMs >= state.expiresAtMs)) return 'expired';
  return state.status;
}

/** Own-action transition. The actor is the authenticated caller, never a field from the request body. */
export function applyPlanAction(state: PlanState, action: PlanAction, check: PlanSourceCheck): PlanTransition {
  if (!state.participants.includes(action.actor)) return refuse('not_participant', state);
  const status = currentPlanStatus(state, check);
  if (status === 'expired') return refuse('expired', { ...state, status });
  if (status === 'stale') {
    // Either person may still close it out; nobody can accept or confirm stale sources.
    if (action.kind === 'cancel' && !TERMINAL.has(state.status)) return { ok: true, state: { ...state, status: 'cancelled' } };
    return refuse(TERMINAL.has(state.status) ? 'closed' : 'stale_source', { ...state, status });
  }
  if (TERMINAL.has(status)) return refuse('closed', state);

  if (action.kind === 'cancel') return { ok: true, state: { ...state, status: 'cancelled' } };
  if (action.revision !== state.revision) return refuse('stale_revision', state);
  if (status === 'confirmed') return refuse('closed', state);
  if (action.kind === 'decline') return { ok: true, state: { ...state, status: 'declined', acceptedBy: [] } };
  if (state.acceptedBy.includes(action.actor)) return refuse('already_accepted', state);
  const acceptedBy = [...state.acceptedBy, action.actor];
  const both = state.participants.every(p => acceptedBy.includes(p));
  return { ok: true, state: { ...state, acceptedBy, status: both ? 'confirmed' : 'pending' } };
}

/**
 * A changed proposal (new time, new event details) is a new revision: earlier acceptances no longer count and
 * both people decide again. Only a live, unconfirmed plan can be revised; the caller supplies the new times.
 */
export function revisePlan(state: PlanState, next: { expiresAtMs: number; eventStartsAtMs: number }): PlanState | null {
  if (state.status !== 'pending') return null;
  return { ...state, revision: state.revision + 1, acceptedBy: [], status: 'pending', ...next };
}
