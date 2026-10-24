/**
 * Maps generated view rows (snake_case or camelCase, SDK Timestamp/Identity
 * objects) to contract wire types, then validates with the canonical Zod
 * schemas. Rows that fail validation are dropped (fail closed), never shown.
 */
import {
  ApprovedSignalSchema,
  DisclosureReceiptSchema,
  NudgeSchema,
  RecipientPresetAssignmentSchema,
  RelationshipPresetSchema,
} from '@dor/contracts';
import type { ApprovedSignal, DisclosureReceipt, Nudge, RecipientPresetAssignment, RelationshipPreset } from '@dor/contracts';
import { validRecipientDelivery, validSupportPreferences } from '@dor/contracts/policy';
import type { InviteView, NudgeDeliveryView, PairView, SignalView, SupportPreferencesView } from '@/lib/backend/ports';
import { toCamel, type LooseRow } from './bindings';

type Mapper<T> = (row: LooseRow) => T | null;

function get(row: LooseRow, snake: string): unknown {
  return row[snake] ?? row[toCamel(snake)];
}

/** Converts SDK Identity / Timestamp / primitives into plain wire values. */
function plain(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return value;
  const v = value as { toHexString?: () => string; toISOString?: () => string };
  if (typeof v.toHexString === 'function') return v.toHexString();
  if (typeof v.toISOString === 'function') return v.toISOString();
  return value;
}

function str(row: LooseRow, key: string): string | null {
  const v = plain(get(row, key));
  return v === null ? null : String(v);
}

function parsed<T>(schema: { safeParse(v: unknown): { success: boolean; data?: T } }, value: unknown): T | null {
  const r = schema.safeParse(value);
  return r.success ? (r.data as T) : null;
}

const PAIR_STATUS: readonly PairView['status'][] = ['pending', 'accepted', 'unlinked'];

export const mapPair: Mapper<PairView> = (row) => {
  const pairId = str(row, 'pair_id');
  const status = PAIR_STATUS.find((s) => s === str(row, 'status'));
  const createdAt = str(row, 'created_at');
  if (!pairId || !status || !createdAt) return null;
  return {
    pairId,
    counterpartIdentityHex: str(row, 'counterpart_identity'),
    counterpartDisplayName: str(row, 'counterpart_display_name'),
    status,
    createdAt,
  };
};

export const mapInvite: Mapper<InviteView> = (row) => {
  const inviteToken = str(row, 'invite_token');
  const expiresAt = str(row, 'expires_at');
  return inviteToken && expiresAt ? { inviteToken, expiresAt } : null;
};

export const mapAccount = (row: LooseRow): { displayName: string } | null => {
  const displayName = str(row, 'display_name');
  return displayName ? { displayName } : null;
};

export const mapPreset: Mapper<RelationshipPreset> = (row) =>
  parsed<RelationshipPreset>(RelationshipPresetSchema, {
    schemaVersion: 1,
    policyId: str(row, 'policy_id'),
    ownerId: str(row, 'owner_id'),
    presetKind: str(row, 'preset_kind'),
    purpose: 'support_nudge',
    allowedCategories: get(row, 'allowed_categories') ?? [],
    approvalMode: 'each_item',
    version: Number(plain(get(row, 'version'))),
    expiresAt: str(row, 'expires_at'),
    revokedAt: str(row, 'revoked_at'),
  });

export const mapAssignment: Mapper<RecipientPresetAssignment> = (row) =>
  parsed<RecipientPresetAssignment>(RecipientPresetAssignmentSchema, {
    schemaVersion: 1,
    ownerId: str(row, 'owner_id'),
    recipientId: str(row, 'recipient_id'),
    pairId: str(row, 'pair_id'),
    presetId: str(row, 'preset_id'),
    assignmentVersion: Number(plain(get(row, 'assignment_version'))),
  });

export const mapNudge: Mapper<Nudge> = (row) =>
  parsed<Nudge>(NudgeSchema, {
    schemaVersion: 1,
    id: str(row, 'nudge_id') ?? str(row, 'id'),
    pairId: str(row, 'pair_id'),
    recipientId: str(row, 'recipient_id'),
    sourceSignalIds: get(row, 'source_signal_ids'),
    sourceConsentVersions: ((get(row, 'source_consent_versions') as unknown[]) ?? []).map((n) => Number(plain(n))),
    templateId: str(row, 'template_id'),
    createdAt: str(row, 'created_at'),
    expiresAt: str(row, 'expires_at'),
  });

export const mapReceipt: Mapper<DisclosureReceipt> = (row) =>
  parsed<DisclosureReceipt>(DisclosureReceiptSchema, {
    schemaVersion: 1,
    receiptId: str(row, 'receipt_id'),
    signalId: str(row, 'signal_id'),
    senderId: str(row, 'sender_id'),
    recipientId: str(row, 'recipient_id'),
    categories: get(row, 'categories'),
    consentVersion: Number(plain(get(row, 'consent_version'))),
    recipientPolicyVersion: Number(plain(get(row, 'recipient_policy_version'))),
    presetAssignmentVersion: Number(plain(get(row, 'preset_assignment_version'))),
    action: str(row, 'action'),
    createdAt: str(row, 'created_at'),
  });

/** SDK option → value or undefined (the contract schema uses optional, not null). */
function opt(row: LooseRow, key: string): string | undefined {
  return str(row, key) ?? undefined;
}

export const mapSignal: Mapper<SignalView> = (row) => {
  const signal = parsed<ApprovedSignal>(ApprovedSignalSchema, {
    schemaVersion: 2,
    signalId: str(row, 'signal_id'),
    pairId: str(row, 'pair_id'),
    senderId: str(row, 'sender_id'),
    recipientId: str(row, 'recipient_id'),
    purpose: str(row, 'purpose'),
    supportMode: opt(row, 'support_mode'),
    availability: opt(row, 'availability'),
    consentVersion: Number(plain(get(row, 'consent_version'))),
    recipientPolicyId: str(row, 'recipient_policy_id'),
    recipientPolicyVersion: Number(plain(get(row, 'recipient_policy_version'))),
    presetAssignmentVersion: Number(plain(get(row, 'preset_assignment_version'))),
    expiresAt: str(row, 'expires_at'),
  });
  return signal ? { ...signal, revokedAt: str(row, 'revoked_at') } : null;
};

function num(row: LooseRow, key: string): number | null {
  const v = plain(get(row, key));
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

export const mapSupportPreferences: Mapper<SupportPreferencesView> = (row) => {
  const pairId = str(row, 'pair_id');
  const expiresAt = str(row, 'expires_at');
  const consentVersion = num(row, 'consent_version');
  const supportModes = get(row, 'support_modes');
  const availability = get(row, 'availability');
  if (!pairId || !expiresAt || consentVersion === null || !Array.isArray(supportModes) || !Array.isArray(availability)) return null;
  if (!validSupportPreferences({ supportModes, availability })) return null;
  return {
    pairId, expiresAt, consentVersion, revokedAt: str(row, 'revoked_at'),
    supportModes: supportModes as SupportPreferencesView['supportModes'],
    availability: availability as SupportPreferencesView['availability'],
  };
};

export const mapNudgeDelivery: Mapper<NudgeDeliveryView> = (row) => {
  const pairId = str(row, 'pair_id');
  const optedIn = get(row, 'opted_in');
  const utcOffsetMinutes = num(row, 'utc_offset_minutes');
  if (!pairId || typeof optedIn !== 'boolean' || utcOffsetMinutes === null) return null;
  const view = {
    pairId, optedIn, utcOffsetMinutes,
    quietStartMinute: num(row, 'quiet_start_minute'), quietEndMinute: num(row, 'quiet_end_minute'),
  };
  return validRecipientDelivery(view) ? view : null;
};

export function mapRows<T>(rows: Iterable<LooseRow>, mapper: Mapper<T>): T[] {
  const out: T[] = [];
  for (const row of rows) {
    const mapped = mapper(row);
    if (mapped) out.push(mapped);
  }
  return out;
}
