/**
 * Maps generated view rows (snake_case or camelCase, SDK Timestamp/Identity
 * objects) to contract wire types, then validates with the canonical Zod
 * schemas. Rows that fail validation are dropped (fail closed), never shown.
 */
import {
  DisclosureReceiptSchema,
  NudgeSchema,
  RecipientPresetAssignmentSchema,
  RelationshipPresetSchema,
} from '@dor/contracts';
import type { DisclosureReceipt, Nudge, RecipientPresetAssignment, RelationshipPreset } from '@dor/contracts';
import type { InviteView, PairView } from '@/lib/backend/ports';
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

export function mapRows<T>(rows: Iterable<LooseRow>, mapper: Mapper<T>): T[] {
  const out: T[] = [];
  for (const row of rows) {
    const mapped = mapper(row);
    if (mapped) out.push(mapped);
  }
  return out;
}
