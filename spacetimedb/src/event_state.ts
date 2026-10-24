// C7/C8 event and shared-plan state loaders (Cyber, CYBER-R3, D039). Read in the same transaction as the write
// they protect; views pass nowMs = null and rely on sweep markers.
import type { Identity } from 'spacetimedb';
import {
  activityApprovalStands, intentStands, planSourceCheck,
  type ActivityApprovalState, type ActivityPresetState, type CatalogueEventState, type EventIntentState,
  type PlanSourceCheck, type PlanState, type PlanStatus,
} from '@dor/contracts/policy';
import type { Ctx } from './errors';
import { blockedEitherWay, hex, isExpiredMarked, loadStanding, toMs, type ReadDb } from './policy_state';

type EventRow = NonNullable<ReturnType<Ctx['db']['catalogue_event']['event_id']['find']>>;
type IntentRow = NonNullable<ReturnType<Ctx['db']['event_intent']['intent_id']['find']>>;
type ApprovalRow = NonNullable<ReturnType<Ctx['db']['activity_approval']['approval_id']['find']>>;
export type PlanRow = NonNullable<ReturnType<Ctx['db']['shared_plan']['plan_id']['find']>>;

export function toCatalogueState(db: ReadDb, e: EventRow): CatalogueEventState {
  return {
    eventId: e.event_id, startsAtMs: toMs(e.starts_at), endsAtMs: e.ends_at ? toMs(e.ends_at) : null, status: e.status,
    fetchedAtMs: toMs(e.fetched_at), topics: e.topics,
    staleMarked: isExpiredMarked(db, 'catalogue', e.event_id, toMs(e.fetched_at)),
  };
}
export function loadCatalogueEvent(db: ReadDb, eventId: string): CatalogueEventState | null {
  const e = db.catalogue_event.event_id.find(eventId);
  return e ? toCatalogueState(db, e) : null;
}

export function findIntentRow(db: ReadDb, owner: Identity, eventId: string): IntentRow | undefined {
  return [...db.event_intent.iter()].find(i => i.owner.isEqual(owner) && i.event_id === eventId);
}
export function toIntentState(db: ReadDb, i: IntentRow): EventIntentState {
  return {
    intentId: i.intent_id, ownerId: hex(i.owner), eventId: i.event_id, version: i.version, expiresAtMs: toMs(i.expires_at),
    revokedAtMs: i.revoked_at ? toMs(i.revoked_at) : null, expiredMarked: isExpiredMarked(db, 'intent', i.intent_id, i.version),
  };
}
export function loadIntent(db: ReadDb, intentId: string): EventIntentState | null {
  const i = db.event_intent.intent_id.find(intentId);
  return i ? toIntentState(db, i) : null;
}

/** The owner's preset currently assigned in this pair, as the C7 guard sees it (null = none). */
export function loadActivityPreset(db: ReadDb, owner: Identity, pairId: string): ActivityPresetState | null {
  const s = loadStanding(db, owner, pairId);
  if (!s.preset || !s.assignment) return null;
  return {
    allowedCategories: s.preset.allowedCategories, version: s.preset.version, assignmentVersion: s.assignment.assignmentVersion,
    expiresAtMs: s.preset.expiresAtMs, revoked: s.preset.revokedAtMs !== null,
  };
}
export function toApprovalState(db: ReadDb, a: ApprovalRow): ActivityApprovalState {
  return {
    approvalId: a.approval_id, ownerId: hex(a.owner), recipientId: hex(a.recipient), pairId: a.pair_id, topics: a.topics,
    recipientPolicyVersion: a.recipient_policy_version, presetAssignmentVersion: a.preset_assignment_version,
    consentVersion: a.consent_version, expiresAtMs: toMs(a.expires_at), revokedAtMs: a.revoked_at ? toMs(a.revoked_at) : null,
    expiredMarked: isExpiredMarked(db, 'activity', a.approval_id, 1),
  };
}
export function loadApproval(db: ReadDb, approvalId: string | undefined): ActivityApprovalState | null {
  if (!approvalId) return null;
  const a = db.activity_approval.approval_id.find(approvalId);
  return a ? toApprovalState(db, a) : null;
}

const samePeople = (x: Identity, y: Identity, a: Identity, b: Identity) =>
  (x.isEqual(a) && y.isEqual(b)) || (x.isEqual(b) && y.isEqual(a));

/** The two participants a basis names, if it is current: an accepted introduction or an accepted pair. */
export function basisParticipants(db: ReadDb, kind: string, ref: string): [Identity, Identity] | null {
  if (kind === 'introduction') {
    const r = db.introduction.intro_id.find(ref);
    return r && r.status === 'accepted' ? [r.sender, r.recipient] : null;
  }
  if (kind === 'existing_connection') {
    const p = db.pair.pair_id.find(ref);
    return p && p.status === 'accepted' && p.member_b ? [p.member_a, p.member_b] : null;
  }
  return null;
}

/** Each participant's C7 approval naming the other, current and covering the event (pair basis only). */
export function approvalsStand(db: ReadDb, pairId: string, a: Identity, b: Identity, approvalA: string | undefined,
  approvalB: string | undefined, eventTopics: readonly string[], nowMs: number | null): boolean {
  const ok = (owner: Identity, other: Identity, id: string | undefined) => activityApprovalStands(loadApproval(db, id),
    loadActivityPreset(db, owner, pairId), { ownerId: hex(owner), recipientId: hex(other), pairId, eventTopics }, nowMs) === null;
  return ok(a, b, approvalA) && ok(b, a, approvalB);
}

export function basisCurrent(db: ReadDb, p: PlanRow, eventTopics: readonly string[], nowMs: number | null): boolean {
  const people = basisParticipants(db, p.basis_kind, p.basis_ref);
  if (!people || !samePeople(people[0], people[1], p.participant_a, p.participant_b)) return false;
  if (p.basis_kind === 'introduction') return !p.approval_a && !p.approval_b;
  return approvalsStand(db, p.basis_ref, p.participant_a, p.participant_b, p.approval_a, p.approval_b, eventTopics, nowMs);
}

export function intentsCurrent(db: ReadDb, p: PlanRow, nowMs: number | null): boolean {
  return intentStands(loadIntent(db, p.intent_a), hex(p.participant_a), p.event_id, p.intent_a_version, nowMs) &&
    intentStands(loadIntent(db, p.intent_b), hex(p.participant_b), p.event_id, p.intent_b_version, nowMs);
}

export function toPlanState(p: PlanRow): PlanState {
  const a = hex(p.participant_a), b = hex(p.participant_b);
  return {
    planId: p.plan_id, revision: p.revision, participants: [a, b],
    acceptedBy: [...(p.accepted_a ? [a] : []), ...(p.accepted_b ? [b] : [])],
    status: p.status as PlanStatus, expiresAtMs: toMs(p.expires_at), eventStartsAtMs: toMs(p.event_starts_at),
  };
}

/** Everything the D034 lifecycle needs, read now. nowMs = null (views) skips clock checks; the sweep covers time. */
export function loadPlanCheck(db: ReadDb, p: PlanRow, nowMs: number | null): PlanSourceCheck {
  const event = loadCatalogueEvent(db, p.event_id);
  const check = planSourceCheck({
    nowMs: nowMs ?? 0, event, planEventStartsAtMs: toMs(p.event_starts_at),
    intentsCurrent: intentsCurrent(db, p, nowMs), basisCurrent: basisCurrent(db, p, event?.topics ?? [], nowMs),
    blocked: blockedEitherWay(db, p.participant_a, p.participant_b),
  });
  return check;
}
