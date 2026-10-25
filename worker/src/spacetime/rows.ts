import { DEFAULT_RECIPIENT_DELIVERY, DiscoveryTagSchema, type ApprovedSignal, type CatalogueEventRef, type PolicySnapshot,
  type RecipientDelivery, type RecipientSupportPreferences, type StoredSignal } from '@dor/contracts';

/**
 * Pure mappers from the worker-only views (spacetimedb/src/views.ts: worker_signal_context, worker_delivery)
 * to contract types. Rows come either from the in-process module harness (snake_case, SDK Identity/Timestamp
 * objects) or from generated client bindings (camelCase); both are accepted. A row that does not map cleanly
 * is dropped, so a schema drift fails closed (no signal, not opted in) rather than guessing.
 */
export type Row = Readonly<Record<string, unknown>>;

export class RowShapeError extends Error {
  constructor(readonly field: string) { super(`row_shape: ${field}`); this.name = 'RowShapeError'; }
}

const camel = (snake: string) => snake.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());

function field(row: Row, name: string): unknown {
  return name in row ? row[name] : row[camel(name)];
}
/** SpacetimeDB options arrive as undefined/null, a bare value, or a tagged `{ tag: 'some', value }`. */
function optional(row: Row, name: string): unknown {
  const v = field(row, name);
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'object' && v !== null && 'tag' in v) {
    const tagged = v as { tag: unknown; value?: unknown };
    return tagged.tag === 'some' || tagged.tag === 'Some' ? tagged.value : undefined;
  }
  return v;
}
function str(row: Row, name: string): string {
  const v = field(row, name);
  if (typeof v !== 'string' || v.length === 0) throw new RowShapeError(name);
  return v;
}
function optStr(row: Row, name: string): string | undefined {
  const v = optional(row, name);
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw new RowShapeError(name);
  return v;
}
function int(value: unknown, name: string): number {
  const n = typeof value === 'bigint' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n)) throw new RowShapeError(name);
  return n;
}
function identityHex(value: unknown, name: string): string {
  if (typeof value === 'string' && value.length > 0) return value;
  if (value && typeof (value as { toHexString?: unknown }).toHexString === 'function') {
    return (value as { toHexString(): string }).toHexString();
  }
  throw new RowShapeError(name);
}
function epochMs(value: unknown, name: string): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return Date.parse(value);
  const micros = (value as { microsSinceUnixEpoch?: unknown } | null)?.microsSinceUnixEpoch;
  if (typeof micros === 'bigint') return Number(micros / 1000n);
  throw new RowShapeError(name);
}

export interface SignalContext {
  signal: StoredSignal;
  snapshot: Omit<PolicySnapshot, 'nowMs'>;
}

/**
 * One worker_signal_context row → the StoredSignal plus standing snapshot DisclosurePolicy needs. Mirrors
 * spacetimedb/src/policy_state.ts (toStoredSignal, loadStanding). The view already drops revoked signals,
 * so revokedAtMs is null; a revoked preset only arrives as a flag and maps to a past revocation time.
 */
export function toSignalContext(row: Row): SignalContext {
  const senderId = identityHex(field(row, 'sender_id'), 'sender_id');
  const pairId = str(row, 'pair_id');
  const signal: StoredSignal = {
    signalId: str(row, 'signal_id'), pairId, senderId,
    recipientId: identityHex(field(row, 'recipient_id'), 'recipient_id'),
    purpose: str(row, 'purpose'), supportMode: optStr(row, 'support_mode'), availability: optStr(row, 'availability'),
    consentVersion: int(field(row, 'consent_version'), 'consent_version'),
    recipientPolicyId: str(row, 'recipient_policy_id'),
    recipientPolicyVersion: int(field(row, 'recipient_policy_version'), 'recipient_policy_version'),
    presetAssignmentVersion: int(field(row, 'preset_assignment_version'), 'preset_assignment_version'),
    expiresAtMs: epochMs(field(row, 'expires_at'), 'expires_at'), revokedAtMs: null,
  };
  const memberB = optional(row, 'pair_member_b');
  const pair = {
    pairId, memberA: identityHex(field(row, 'pair_member_a'), 'pair_member_a'),
    memberB: memberB === undefined ? null : identityHex(memberB, 'pair_member_b'),
    status: str(row, 'pair_status'),
  };

  const recipient = optional(row, 'assignment_recipient');
  const presetId = optStr(row, 'assignment_preset_id');
  const assignmentVersion = optional(row, 'assignment_version');
  const presetVersion = optional(row, 'preset_version');
  const presetExpires = optional(row, 'preset_expires_at');
  const categories = field(row, 'preset_allowed_categories');
  if (!Array.isArray(categories) || categories.some(c => typeof c !== 'string')) {
    throw new RowShapeError('preset_allowed_categories');
  }
  const hasPreset = presetId !== undefined && presetVersion !== undefined && presetExpires !== undefined;
  const snapshot: Omit<PolicySnapshot, 'nowMs'> = {
    pair,
    assignment: hasPreset && recipient !== undefined && assignmentVersion !== undefined ? {
      ownerId: senderId, recipientId: identityHex(recipient, 'assignment_recipient'), pairId, presetId,
      assignmentVersion: int(assignmentVersion, 'assignment_version'),
    } : null,
    preset: hasPreset ? {
      policyId: presetId, ownerId: senderId, allowedCategories: categories as string[],
      version: int(presetVersion, 'preset_version'), expiresAtMs: epochMs(presetExpires, 'preset_expires_at'),
      revokedAtMs: field(row, 'preset_revoked') === true ? 0 : null,
    } : null,
  };
  return { signal, snapshot };
}

/** The approved envelope as the coordinator receives it (ApprovedSignal v2). */
export function toApprovedSignal(stored: StoredSignal): ApprovedSignal {
  return {
    schemaVersion: 2, signalId: stored.signalId, pairId: stored.pairId, senderId: stored.senderId,
    recipientId: stored.recipientId, purpose: stored.purpose as ApprovedSignal['purpose'],
    ...(stored.supportMode ? { supportMode: stored.supportMode as ApprovedSignal['supportMode'] } : {}),
    ...(stored.availability ? { availability: stored.availability as ApprovedSignal['availability'] } : {}),
    consentVersion: stored.consentVersion, recipientPolicyId: stored.recipientPolicyId,
    recipientPolicyVersion: stored.recipientPolicyVersion, presetAssignmentVersion: stored.presetAssignmentVersion,
    expiresAt: new Date(stored.expiresAtMs).toISOString(),
  };
}

export interface DeliveryContext {
  pairId: string;
  recipientId: string;
  delivery: RecipientDelivery;
  lastNudgeAt: Date | null;
}

/** One worker_delivery row (only opted-in rows are listed by the view). */
export function toDeliveryContext(row: Row): DeliveryContext {
  const quietStart = optional(row, 'quiet_start_minute');
  const quietEnd = optional(row, 'quiet_end_minute');
  const last = optional(row, 'last_nudge_at');
  return {
    pairId: str(row, 'pair_id'), recipientId: identityHex(field(row, 'recipient'), 'recipient'),
    delivery: {
      optedIn: field(row, 'opted_in') === true,
      quietStartMinute: quietStart === undefined ? null : int(quietStart, 'quiet_start_minute'),
      quietEndMinute: quietEnd === undefined ? null : int(quietEnd, 'quiet_end_minute'),
      utcOffsetMinutes: int(field(row, 'utc_offset_minutes'), 'utc_offset_minutes'),
    },
    lastNudgeAt: last === undefined ? null : new Date(epochMs(last, 'last_nudge_at')),
  };
}

function strings(row: Row, name: string): string[] {
  const v = field(row, name);
  if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) throw new RowShapeError(name);
  return [...v] as string[];
}

/**
 * One worker_support_preferences row (D035) → the recipient's consent record. The view lists only standing
 * consents in accepted pairs, so revokedAt is null; the coordinator still Zod-validates and checks expiry.
 */
export function toSupportPreferences(row: Row): RecipientSupportPreferences {
  return {
    schemaVersion: 1, consentId: str(row, 'consent_id'),
    consentVersion: int(field(row, 'consent_version'), 'consent_version'), pairId: str(row, 'pair_id'),
    recipientId: identityHex(field(row, 'recipient'), 'recipient'), purpose: 'support_nudge',
    supportModes: strings(row, 'support_modes') as RecipientSupportPreferences['supportModes'],
    availability: strings(row, 'availability') as RecipientSupportPreferences['availability'],
    expiresAt: new Date(epochMs(field(row, 'expires_at'), 'expires_at')).toISOString(), revokedAt: null,
  };
}

function ints(row: Row, name: string): number[] {
  const v = field(row, name);
  if (!Array.isArray(v)) throw new RowShapeError(name);
  return v.map(x => int(x, name));
}

/**
 * One worker_plan_candidates row (D039): a current basis plus one event both people currently intend, with the
 * exact intent (and C7 approval) ids and versions commit_plan_proposal binds. The view lists only usable
 * catalogue records, so the event maps as scheduled; the plan coordinator still checks age and lead time.
 */
export interface PlanCandidate {
  basisKind: 'introduction' | 'existing_connection';
  basisRef: string;
  eventId: string;
  /** [participant_a's intent, participant_b's intent], as the view orders them. */
  intentIds: [string, string];
  intentVersions: [number, number];
  approvalIds: string[];
  event: CatalogueEventRef;
}

export function toPlanCandidate(row: Row): PlanCandidate {
  const basisKind = str(row, 'basis_kind');
  if (basisKind !== 'introduction' && basisKind !== 'existing_connection') throw new RowShapeError('basis_kind');
  const eventId = str(row, 'event_id');
  const intentIds = strings(row, 'intent_ids'), intentVersions = ints(row, 'intent_versions');
  if (intentIds.length !== 2 || intentVersions.length !== 2) throw new RowShapeError('intent_ids');
  const format = str(row, 'format');
  if (format !== 'in_person' && format !== 'online') throw new RowShapeError('format');
  const topics = strings(row, 'topics');
  if (topics.length > 5 || topics.some(t => !DiscoveryTagSchema.safeParse(t).success)) throw new RowShapeError('topics');
  return {
    basisKind, basisRef: str(row, 'basis_ref'), eventId,
    intentIds: [intentIds[0]!, intentIds[1]!], intentVersions: [intentVersions[0]!, intentVersions[1]!],
    approvalIds: strings(row, 'approval_ids'),
    event: {
      eventId, startsAt: new Date(epochMs(field(row, 'event_starts_at'), 'event_starts_at')).toISOString(),
      status: 'scheduled', fetchedAt: new Date(epochMs(field(row, 'fetched_at'), 'fetched_at')).toISOString(),
      topics, format,
    },
  };
}

/**
 * One worker_introduction_requests row (D048): an open viewer request plus one candidate the viewer can see now and
 * shares at least one published tag with, or no candidate (nothing to suggest, or the viewer stopped taking part).
 */
export interface IntroductionRequestRow {
  requestId: string;
  /** '' when the viewer is no longer published; such a row never has a candidate. */
  viewerRef: string;
  viewerRevision: number;
  expiresAtMs: number;
  candidate: { ref: string; revision: number; sharedTags: string[] } | null;
}

export function toIntroductionRequestRow(row: Row): IntroductionRequestRow {
  const viewerRef = field(row, 'viewer_ref');
  if (typeof viewerRef !== 'string') throw new RowShapeError('viewer_ref');
  const ref = optStr(row, 'candidate_ref');
  const sharedTags = strings(row, 'shared_tags');
  if (sharedTags.some(t => !DiscoveryTagSchema.safeParse(t).success)) throw new RowShapeError('shared_tags');
  if (ref !== undefined && (viewerRef === '' || sharedTags.length === 0)) throw new RowShapeError('candidate_ref');
  return {
    requestId: str(row, 'request_id'), viewerRef, viewerRevision: int(field(row, 'viewer_revision'), 'viewer_revision'),
    expiresAtMs: epochMs(field(row, 'expires_at'), 'expires_at'),
    candidate: ref === undefined ? null : { ref, revision: int(field(row, 'candidate_revision'), 'candidate_revision'), sharedTags },
  };
}

/** No row means the recipient never opted in (D017 default off). */
export const NOT_OPTED_IN: RecipientDelivery = { ...DEFAULT_RECIPIENT_DELIVERY, optedIn: false };

/** Maps rows, dropping any that fail to map (fail closed on drift). */
export function mapRows<T>(rows: Iterable<unknown>, map: (row: Row) => T): T[] {
  const out: T[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    try {
      out.push(map(row as Row));
    } catch (error) {
      if (!(error instanceof RowShapeError)) throw error;
    }
  }
  return out;
}
