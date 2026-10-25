/**
 * Builds generated-reducer argument objects (camelCase keys). Every time argument the module declares is a
 * `t.string()` it parses itself (guards.parseFuture), so times go out as ISO strings, never SDK Timestamps: a
 * Timestamp in a string field serializes to something the module cannot parse ("must be an ISO timestamp").
 * `__tests__/reducer-args.test.ts` checks each builder against the generated bindings' field types.
 * If `spacetime generate` represents an enum/Timestamp differently, this is the single adapter file to adjust.
 */
import { ACTIVITY_CATEGORY, DISCOVERY_AUDIENCES, DISCOVERY_NOTICE_VERSION, SHARING_CATEGORIES } from '@dor/contracts/policy';
import type { SharedStatePort } from '@/lib/backend/ports';

type Input<K extends 'setRelationshipPreset' | 'assignRelationshipPreset' | 'approveSignal' | 'setSupportPreferences' | 'setNudgeDelivery' | 'publishDiscoveryProfile' | 'setStandingConsent' | 'approveSignalStanding' | 'recordReasoningDecision'> = Parameters<
  SharedStatePort[K]
>[0];

function date(iso: string): Date {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error('invalid: bad timestamp');
  return d;
}

/** Validated, normalized ISO string for a module `t.string()` time argument. */
function iso(value: string): string {
  return date(value).toISOString();
}

export const reducerArgs = {
  registerAccount: (displayName: string) => ({ displayName }),
  acceptPairInvite: (inviteToken: string) => ({ inviteToken }),
  unlinkPair: (pairId: string) => ({ pairId }),
  // The module stores the C7 activity permission as one more preset category (D039); it is added here only from the
  // explicit flag, and the core list may hold C3 categories only (D049).
  setRelationshipPreset: (i: Input<'setRelationshipPreset'>) => ({
    presetKind: i.presetKind,
    allowedCategories: [
      ...i.allowedCategories.map((c) => {
        if (!(SHARING_CATEGORIES as readonly string[]).includes(c)) throw new Error('invalid: not a core sharing category');
        return c;
      }),
      ...(i.activityInterestAllowed ? [ACTIVITY_CATEGORY] : []),
    ],
    expectedVersion: i.expectedVersion,
    expiresAt: iso(i.expiresAt),
  }),
  assignRelationshipPreset: (i: Input<'assignRelationshipPreset'>) => ({
    pairId: i.pairId,
    presetKind: i.presetKind,
    expectedAssignmentVersion: i.expectedAssignmentVersion,
  }),
  approveSignal: (i: Input<'approveSignal'>) => ({ ...i }),
  revokeSignal: (signalId: string) => ({ signalId }),
  dismissNudge: (nudgeId: string) => ({ nudgeId }),
  snoozeNudge: (nudgeId: string, until: string) => ({ nudgeId, until: iso(until) }),
  // expires_at is a string arg on this reducer (parsed server-side), not a Timestamp.
  setSupportPreferences: (i: Input<'setSupportPreferences'>) => ({
    pairId: i.pairId,
    supportModes: [...i.supportModes],
    availability: [...i.availability],
    expiresAt: date(i.expiresAt).toISOString(),
    expectedVersion: i.expectedVersion,
  }),
  revokeSupportPreferences: (pairId: string) => ({ pairId }),
  // SDK options: undefined = none.
  setNudgeDelivery: (i: Input<'setNudgeDelivery'>) => ({
    pairId: i.pairId,
    optedIn: i.optedIn,
    quietStartMinute: i.quietStartMinute ?? undefined,
    quietEndMinute: i.quietEndMinute ?? undefined,
    utcOffsetMinutes: i.utcOffsetMinutes,
  }),
  pauseRecipient: (pairId: string, expiresAt: string, expectedVersion: number) => ({ pairId, expiresAt, expectedVersion }),
  resumeRecipient: (pairId: string, expectedVersion: number) => ({ pairId, expectedVersion }),
  recordReasoningDecision: (i: Input<'recordReasoningDecision'>) => ({
    episodeId: i.episodeId, pairId: i.pairId ?? undefined, mode: i.mode, action: i.action ?? undefined, surface: i.surface ?? undefined,
    reasons: [...i.reasons], rejected: [...i.rejected], reassessAfterMinutes: i.reassessAfterMinutes ?? undefined, source: i.source, outcome: i.outcome,
  }),
  setStandingConsent: (i: Input<'setStandingConsent'>) => ({ ...i, categories: [...i.categories], expiresAt: iso(i.expiresAt) }),
  revokeStandingConsent: (pairId: string) => ({ pairId }),
  approveSignalStanding: (i: Input<'approveSignalStanding'>) => ({
    pairId: i.pairId, supportMode: i.supportMode ?? undefined, availability: i.availability ?? undefined,
    clientRequestId: i.clientRequestId, ruleVersion: i.ruleVersion,
  }),
  // C8: audience and notice version are fixed by the contract, never user-chosen.
  publishDiscoveryProfile: (i: Input<'publishDiscoveryProfile'>) => ({
    displayName: i.displayName,
    interestTags: [...i.interestTags],
    audience: DISCOVERY_AUDIENCES[0],
    noticeVersion: DISCOVERY_NOTICE_VERSION,
    expiresAt: date(i.expiresAt).toISOString(),
    expectedRevision: i.expectedRevision,
  }),
  setDiscoveryArea: (areaKey: string) => ({ areaKey }),
  cardRef: (cardRef: string) => ({ cardRef }),
  introId: (introId: string) => ({ introId }),
  sendIntroductionRequest: (cardRef: string, clientRequestId: string) => ({ cardRef, clientRequestId }),
  respondIntroductionRequest: (introId: string, accept: boolean) => ({ introId, accept }),
  reportDiscoveryUser: (target: { kind: 'card' | 'introduction'; ref: string }, reason: string) =>
    ({ targetKind: target.kind, targetRef: target.ref, reason }),
};
