/**
 * Builds generated-reducer argument objects (camelCase keys, SDK Timestamp).
 * If `spacetime generate` represents an enum/Timestamp differently, this is
 * the single adapter file to adjust (see README.md).
 */
import { Timestamp } from 'spacetimedb';
import type { SharedStatePort } from '@/lib/backend/ports';

type Input<K extends 'setRelationshipPreset' | 'assignRelationshipPreset' | 'approveSignal'> = Parameters<
  SharedStatePort[K]
>[0];

function ts(iso: string): Timestamp {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error('invalid: bad timestamp');
  return Timestamp.fromDate(date);
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
};
