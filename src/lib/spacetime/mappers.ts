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
import { MAX_EVENT_TITLE, MAX_EVENT_TOPICS, MAX_INTEREST_TAGS, MAX_PUBLIC_NAME, validRecipientDelivery, validSupportPreferences } from '@dor/contracts/policy';
import type {
  ActivityApprovalRow, CatalogueEventView, CatalogueStatusView, DiscoveryCardRow, EventCompanionRow, EventIntentRow, IntroductionProposalView, PlanStatus, PlanView, IntroductionView, UnreadableRow, InviteView, MyDiscoveryView, NudgeDeliveryView, PairView, RecipientPause, SignalView, SupportPreferencesView,
} from '@/lib/backend/ports';
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

export const mapRecipientPause: Mapper<RecipientPause> = (row) => {
  const pairId = str(row, 'pair_id');
  const version = num(row, 'version');
  const expiresAt = str(row, 'expires_at');
  const createdAt = str(row, 'created_at');
  const active = get(row, 'active');
  if (!pairId || version === null || version < 1 || !expiresAt || !createdAt || typeof active !== 'boolean') return null;
  if (Number.isNaN(Date.parse(expiresAt))) return null;
  return { pairId, version, expiresAt, active, createdAt };
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

function strings(row: LooseRow, key: string, max: number): string[] | null {
  const v = get(row, key);
  return Array.isArray(v) && v.length <= max && v.every((x) => typeof x === 'string') ? [...v] as string[] : null;
}

export const mapMyDiscovery: Mapper<MyDiscoveryView> = (row) => {
  const interestTags = strings(row, 'interest_tags', MAX_INTEREST_TAGS);
  const revision = num(row, 'revision');
  const flags = ['withdrawn', 'expired', 'area_active', 'discovery_enabled'].map((k) => get(row, k));
  if (!interestTags || revision === null || !flags.every((f) => typeof f === 'boolean')) return null;
  const [withdrawn, expired, areaActive, discoveryEnabled] = flags as boolean[];
  return {
    publicationId: str(row, 'publication_id'), published: str(row, 'publication_id') !== null, displayName: str(row, 'display_name'), interestTags, revision,
    expiresAt: str(row, 'expires_at'), withdrawn, expired, areaKey: str(row, 'area_key'),
    areaExpiresAt: str(row, 'area_expires_at'), areaActive, discoveryEnabled,
  };
};

/** Maps to exactly the C8 projection keys; DS's adapter does the strict content validation before ranking. */
export const mapDiscoveryCard: Mapper<DiscoveryCardRow> = (row) => {
  const cardRef = str(row, 'card_ref');
  const displayName = str(row, 'display_name');
  const interestTags = strings(row, 'interest_tags', MAX_INTEREST_TAGS);
  const sharedTags = strings(row, 'shared_tags', MAX_INTEREST_TAGS);
  const revision = num(row, 'revision');
  if (!cardRef || !displayName || displayName.length > MAX_PUBLIC_NAME || !interestTags || !sharedTags || revision === null) return null;
  return { cardRef, displayName, interestTags, sharedTags, revision };
};

const INTRO_STATUS: readonly IntroductionView['status'][] = ['pending', 'accepted', 'declined', 'closed'];

export const mapIntroduction: Mapper<IntroductionView> = (row) => {
  const introId = str(row, 'intro_id');
  const direction = str(row, 'direction');
  const status = INTRO_STATUS.find((s) => s === str(row, 'status'));
  const createdAt = str(row, 'created_at');
  const sharedTags = strings(row, 'shared_tags', MAX_INTEREST_TAGS);
  if (!introId || (direction !== 'incoming' && direction !== 'outgoing') || !status || !createdAt || !sharedTags) return null;
  // Outgoing rows never carry "declined" (D038); treat one as a server bug and drop it rather than reveal it.
  if (direction === 'outgoing' && status === 'declined') return null;
  return { introId, direction, status, counterpartName: str(row, 'counterpart_name'), sharedTags, createdAt, expiresAt: str(row, 'expires_at') };
};

const OPENERS: readonly IntroductionProposalView['openerId'][] = ['suggest_shared_interest', 'suggest_event_together'];

export const mapIntroductionProposal: Mapper<IntroductionProposalView> = (row) => {
  const proposalId = str(row, 'proposal_id');
  const candidateRef = str(row, 'candidate_ref');
  const reasonCode = str(row, 'reason_code');
  const openerId = OPENERS.find((o) => o === str(row, 'opener_id'));
  const sharedTags = strings(row, 'shared_tags', MAX_INTEREST_TAGS);
  const expiresAt = str(row, 'expires_at');
  if (!proposalId || !candidateRef || !reasonCode || !openerId || !sharedTags || !expiresAt) return null;
  return { proposalId, candidateRef, reasonCode, openerId, sharedTags, expiresAt };
};

const FORMATS: readonly CatalogueEventView['format'][] = ['in_person', 'online'];

export const mapCatalogueEvent: Mapper<CatalogueEventView> = (row) => {
  const eventId = str(row, 'event_id'), title = str(row, 'title'), startsAt = str(row, 'starts_at'), fetchedAt = str(row, 'fetched_at');
  const format = FORMATS.find((f) => f === str(row, 'format'));
  const topics = strings(row, 'topics', MAX_EVENT_TOPICS);
  if (!eventId || !title || title.length > MAX_EVENT_TITLE || !startsAt || !fetchedAt || !format || !topics) return null;
  return { eventId, title, startsAt, endsAt: str(row, 'ends_at'), topics, format, areaKey: str(row, 'area_key'), sourceUrl: str(row, 'source_url'), fetchedAt };
};

export const mapCatalogueStatus: Mapper<CatalogueStatusView> = (row) => {
  const feedKey = str(row, 'feed_key'), lastAttemptAt = str(row, 'last_attempt_at'), recordCount = num(row, 'record_count');
  const lastStatus = str(row, 'last_status');
  if (!feedKey || !lastAttemptAt || recordCount === null || (lastStatus !== 'ok' && lastStatus !== 'failed')) return null;
  return { feedKey, lastAttemptAt, lastSuccessAt: str(row, 'last_success_at'), lastStatus, recordCount };
};

export const mapEventIntent: Mapper<EventIntentRow> = (row) => {
  const eventId = str(row, 'event_id'), expiresAt = str(row, 'expires_at'), version = num(row, 'version');
  const kind = str(row, 'kind'), active = get(row, 'active');
  if (!eventId || !expiresAt || version === null || typeof active !== 'boolean' || (kind !== 'interested' && kind !== 'going')) return null;
  return { eventId, kind, version, active, expiresAt };
};

export const mapCompanion: Mapper<EventCompanionRow> = (row) => {
  const cardRef = str(row, 'card_ref'), eventId = str(row, 'event_id');
  return cardRef && eventId ? { cardRef, eventId } : null;
};

export const mapActivityApproval: Mapper<ActivityApprovalRow> = (row) => {
  const approvalId = str(row, 'approval_id'), pairId = str(row, 'pair_id'), expiresAt = str(row, 'expires_at');
  const topics = strings(row, 'topics', MAX_EVENT_TOPICS);
  return approvalId && pairId && expiresAt && topics ? { approvalId, pairId, topics, expiresAt } : null;
};

const PLAN_STATUS: readonly PlanStatus[] = ['pending', 'confirmed', 'stale', 'expired', 'declined', 'cancelled', 'closed'];

export const mapPlan: Mapper<PlanView> = (row) => {
  const planId = str(row, 'plan_id'), eventId = str(row, 'event_id'), eventStartsAt = str(row, 'event_starts_at');
  const expiresAt = str(row, 'expires_at'), revision = num(row, 'revision'), myAcceptance = get(row, 'my_acceptance');
  const status = PLAN_STATUS.find((s) => s === str(row, 'status'));
  if (!planId || !eventId || !eventStartsAt || !expiresAt || revision === null || !status || typeof myAcceptance !== 'boolean') return null;
  return {
    planId, revision, status, myAcceptance, eventId, eventTitle: str(row, 'event_title') ?? '', eventStartsAt,
    sourceUrl: str(row, 'source_url'), counterpartName: str(row, 'counterpart_name'), expiresAt,
  };
};

export function unreadableRow(row: LooseRow, idKey: string): UnreadableRow {
  return { id: str(row, idKey), pairId: str(row, 'pair_id') };
}

export function mapRows<T>(rows: Iterable<LooseRow>, mapper: Mapper<T>): T[] {
  const out: T[] = [];
  for (const row of rows) {
    const mapped = mapper(row);
    if (mapped) out.push(mapped);
  }
  return out;
}
