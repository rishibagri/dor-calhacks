/**
 * Builds generated-reducer argument objects (camelCase keys, SDK Timestamp).
 * If `spacetime generate` represents an enum/Timestamp differently, this is
 * the single adapter file to adjust (see README.md).
 */
import { Timestamp } from 'spacetimedb';
import { DISCOVERY_AUDIENCES, DISCOVERY_NOTICE_VERSION } from '@dor/contracts/policy';
import type { SharedStatePort } from '@/lib/backend/ports';

type Input<K extends 'setRelationshipPreset' | 'assignRelationshipPreset' | 'approveSignal' | 'setSupportPreferences' | 'setNudgeDelivery' | 'publishDiscoveryProfile'> = Parameters<
  SharedStatePort[K]
>[0];

function date(iso: string): Date {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error('invalid: bad timestamp');
  return d;
}

function ts(iso: string): Timestamp {
  return Timestamp.fromDate(date(iso));
}

export const reducerArgs = {
  registerAccount: (displayName: string) => ({ displayName }),
  acceptPairInvite: (inviteToken: string) => ({ inviteToken }),
  unlinkPair: (pairId: string) => ({ pairId }),
  setRelationshipPreset: (i: Input<'setRelationshipPreset'>) => ({
    presetKind: i.presetKind,
    allowedCategories: i.allowedCategories,
    expectedVersion: i.expectedVersion,
    expiresAt: ts(i.expiresAt),
  }),
  assignRelationshipPreset: (i: Input<'assignRelationshipPreset'>) => ({
    pairId: i.pairId,
    presetKind: i.presetKind,
    expectedAssignmentVersion: i.expectedAssignmentVersion,
  }),
  approveSignal: (i: Input<'approveSignal'>) => ({ ...i }),
  revokeSignal: (signalId: string) => ({ signalId }),
  dismissNudge: (nudgeId: string) => ({ nudgeId }),
  snoozeNudge: (nudgeId: string, until: string) => ({ nudgeId, until: ts(until) }),
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
