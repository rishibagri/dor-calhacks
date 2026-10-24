// Builds C6 guard snapshots from authoritative private tables (Cyber; CS plumbing).
// Always read in the same transaction as the write the guard protects.
import type { Identity, Timestamp } from 'spacetimedb';
import type { InferSchema, ViewCtx } from 'spacetimedb/server';
import { pauseActive, standingRuleActive } from '@dor/contracts/policy';
import type { StandingRuleState } from '@dor/contracts/policy';
import type { AreaState, DeliveryGate, DiscoveryParty, PolicySnapshot, PublicationState, StoredSignal, SupportPreferenceState } from '@dor/contracts/policy';
import type { spacetimedb } from './schema';
import type { Ctx } from './errors';

/** Read-only table access shared by reducer and view contexts. */
export type ReadDb = ViewCtx<InferSchema<typeof spacetimedb>>['db'];
type SignalRow = NonNullable<ReturnType<Ctx['db']['approved_signal']['signal_id']['find']>>;

export const hex = (id: Identity): string => id.toHexString();
export const toMs = (ts: Timestamp): number => Number(ts.microsSinceUnixEpoch / 1000n);
export const fromMs = (ms: number): bigint => BigInt(ms) * 1000n;

// ---- Indexed lookups for hot owner/pair paths (CS-R4). Each reads one index range, never a whole table. ----

/** The owner's assignment in one pair (owner index, then pair). */
export function findAssignment(db: ReadDb, owner: Identity, pairId: string) {
  for (const r of db.preset_assignment.owner.filter(owner)) if (r.pair_id === pairId) return r;
  return undefined;
}

/** The owner's preset of one kind (one row per owner + kind). */
export function findPreset(db: ReadDb, owner: Identity, kind: string) {
  for (const r of db.relationship_preset.owner.filter(owner)) if (r.preset_kind === kind) return r;
  return undefined;
}

/** Pairs the identity belongs to, via the pair_member index; each pair once. */
export function pairsOf(db: ReadDb, who: Identity) {
  const out = [];
  for (const m of db.pair_member.member.filter(who)) {
    const p = db.pair.pair_id.find(m.pair_id);
    if (p) out.push(p);
  }
  return out;
}

/** Pair + the owner's assignment in it + the confirmed preset that assignment points at. */
export function loadStanding(db: ReadDb, owner: Identity, pairId: string): Omit<PolicySnapshot, 'nowMs'> {
  const p = db.pair.pair_id.find(pairId);
  const pair = p ? { pairId: p.pair_id, memberA: hex(p.member_a), memberB: p.member_b ? hex(p.member_b) : null, status: p.status } : null;
  const a = findAssignment(db, owner, pairId);
  const preset = a ? findPreset(db, owner, a.preset_kind) : undefined;
  return {
    pair,
    assignment: a && preset ? {
      ownerId: hex(a.owner), recipientId: hex(a.recipient), pairId: a.pair_id,
      presetId: preset.preset_id, assignmentVersion: a.assignment_version,
    } : null,
    preset: preset ? {
      policyId: preset.preset_id, ownerId: hex(preset.owner), allowedCategories: preset.allowed_categories,
      version: preset.version, expiresAtMs: toMs(preset.expires_at),
      revokedAtMs: preset.revoked_at ? toMs(preset.revoked_at) : null,
    } : null,
  };
}

export function toStoredSignal(s: SignalRow): StoredSignal {
  return {
    signalId: s.signal_id, pairId: s.pair_id, senderId: hex(s.sender_id), recipientId: hex(s.recipient_id),
    purpose: s.purpose, supportMode: s.support_mode, availability: s.availability,
    consentVersion: s.consent_version, recipientPolicyId: s.recipient_policy_id,
    recipientPolicyVersion: s.recipient_policy_version, presetAssignmentVersion: s.preset_assignment_version,
    expiresAtMs: toMs(s.expires_at), revokedAtMs: s.revoked_at ? toMs(s.revoked_at) : null,
  };
}

// ---- Expiry markers (written by sweep_expired; views have no clock) ----
export type ExpiryKind = 'signal' | 'preference' | 'publication' | 'area' | 'intent' | 'catalogue' | 'activity' | 'pause' | 'standing_rule';
export const expiryKey = (kind: ExpiryKind, id: string, version: number): string => `${kind}:${id}:${version}`;
export const isExpiredMarked = (db: ReadDb, kind: ExpiryKind, id: string, version: number): boolean =>
  Boolean(db.expired_record.record_key.find(expiryKey(kind, id, version))); // find() returns null, not undefined
// Signals are immutable (edit = revoke + new approval), so their marker version is always 1.
export const signalExpiredMarked = (db: ReadDb, signalId: string): boolean => isExpiredMarked(db, 'signal', signalId, 1);

type PreferenceRow = NonNullable<ReturnType<Ctx['db']['support_preference']['consent_id']['find']>>;
export function findPreferenceRow(db: ReadDb, recipient: Identity, pairId: string): PreferenceRow | undefined {
  for (const p of db.support_preference.recipient.filter(recipient)) if (p.pair_id === pairId) return p;
  return undefined;
}

/** The recipient's current preference consent for a pair (null = none). Sweep-expired rows count as gone. */
export function loadPreference(db: ReadDb, recipient: Identity, pairId: string): SupportPreferenceState | null {
  const p = findPreferenceRow(db, recipient, pairId);
  if (!p) return null;
  const expired = isExpiredMarked(db, 'preference', p.consent_id, p.consent_version);
  return {
    consentId: p.consent_id, recipientId: hex(p.recipient), pairId: p.pair_id, supportModes: p.support_modes,
    availability: p.availability, consentVersion: p.consent_version,
    expiresAtMs: expired ? 0 : toMs(p.expires_at), revokedAtMs: p.revoked_at ? toMs(p.revoked_at) : null,
  };
}

// ---- C8 discovery state ----
export type DiscoveryConfigKey = 'enabled' | 'tags' | 'areas' | 'source_hosts';
export function discoveryList(db: ReadDb, key: DiscoveryConfigKey): string[] {
  return db.discovery_config.key.find(key)?.values ?? [];
}
/** Off unless the module owner explicitly enabled it after the C8 review (feature flag, default off). */
export const discoveryEnabled = (db: ReadDb): boolean => discoveryList(db, 'enabled')[0] === 'true';

type PublicationRow = NonNullable<ReturnType<Ctx['db']['discovery_publication']['publication_id']['find']>>;
export function findPublicationRow(db: ReadDb, owner: Identity): PublicationRow | undefined {
  return db.discovery_publication.owner.filter(owner).next().value ?? undefined;
}

export function toPublicationState(db: ReadDb, p: PublicationRow): PublicationState {
  return {
    publicationId: p.publication_id, ownerId: hex(p.owner), displayName: p.display_name, interestTags: p.interest_tags,
    audience: p.audience, noticeVersion: p.notice_version, revision: p.revision, expiresAtMs: toMs(p.expires_at),
    withdrawnAtMs: p.withdrawn_at ? toMs(p.withdrawn_at) : null,
    expiredMarked: isExpiredMarked(db, 'publication', p.publication_id, p.revision),
  };
}

export function loadDiscoveryParty(db: ReadDb, who: Identity): DiscoveryParty {
  const p = findPublicationRow(db, who);
  const a = db.area_participation.owner.find(who);
  const area: AreaState | null = a ? {
    ownerId: hex(a.owner), areaKey: a.area_key, expiresAtMs: toMs(a.expires_at), active: a.active,
    expiredMarked: isExpiredMarked(db, 'area', hex(a.owner), a.revision),
  } : null;
  return { id: hex(who), publication: p ? toPublicationState(db, p) : null, area };
}

export function blockedEitherWay(db: ReadDb, a: Identity, b: Identity): boolean {
  for (const r of db.discovery_block.blocker.filter(a)) if (r.blocked.isEqual(b)) return true;
  for (const r of db.discovery_block.blocker.filter(b)) if (r.blocked.isEqual(a)) return true;
  return false;
}

/** F5 gate inputs: the recipient's own delivery row for this pair (null = never opted in) and the last nudge in the pair. */
export function loadDeliveryGate(db: ReadDb, recipient: Identity, pairId: string, nowMs: number): DeliveryGate {
  let row;
  for (const d of db.nudge_delivery.recipient.filter(recipient)) if (d.pair_id === pairId) { row = d; break; }
  let last: number | null = null;
  // Every nudge counts toward the per-pair cooldown, including dismissed/suppressed ones (no revoke-and-retry spam).
  for (const n of db.nudge.pair_id.filter(pairId)) last = Math.max(last ?? 0, toMs(n.created_at));
  return {
    nowMs, lastNudgeAtMs: last, preferences: loadPreference(db, recipient, pairId),
    pref: row ? {
      optedIn: row.opted_in, quietStartMinute: row.quiet_start_minute ?? null,
      quietEndMinute: row.quiet_end_minute ?? null, utcOffsetMinutes: row.utc_offset_minutes,
    } : null,
  };
}

// ---- D041 recipient pause (owner index, then pair: never a whole-table scan) ----
type PauseRow = NonNullable<ReturnType<Ctx['db']['recipient_pause']['pause_id']['find']>>;

export function findPauseRow(db: ReadDb, owner: Identity, pairId: string): PauseRow | undefined {
  for (const p of db.recipient_pause.owner.filter(owner)) if (p.pair_id === pairId) return p;
  return undefined;
}

/**
 * Whether `owner` is pausing the other member of `pairId` now. Fail closed: a row that exists counts as in force
 * unless it is explicitly resumed or known to have lapsed (by ctx clock in reducers, by the sweep marker in views).
 */
export function pauseInForce(db: ReadDb, owner: Identity, pairId: string, nowMs: number | null): boolean {
  const p = findPauseRow(db, owner, pairId);
  if (!p) return false;
  return pauseActive({
    pauseId: p.pause_id, ownerId: hex(p.owner), targetId: hex(p.target), pairId: p.pair_id, version: p.version,
    expiresAtMs: toMs(p.expires_at), resumedAtMs: p.resumed_at ? toMs(p.resumed_at) : null,
    expiredMarked: isExpiredMarked(db, 'pause', p.pause_id, p.version),
  }, nowMs);
}

/**
 * Hex identities the caller is already connected with: an accepted introduction (either direction) or an accepted
 * pair. Index lookups only. Discovery hides these people from each other and refuses a new introduction to them.
 */
export function connectedCounterparts(db: ReadDb, me: Identity): Set<string> {
  const out = new Set<string>();
  for (const r of db.introduction.sender.filter(me)) if (r.status === 'accepted') out.add(hex(r.recipient));
  for (const r of db.introduction.recipient.filter(me)) if (r.status === 'accepted') out.add(hex(r.sender));
  for (const p of pairsOf(db, me)) {
    if (p.status !== 'accepted' || !p.member_b) continue;
    out.add(hex(p.member_a.isEqual(me) ? p.member_b : p.member_a));
  }
  return out;
}

// ---- D047 standing rules (owner index, then pair) ----
type RuleRow = NonNullable<ReturnType<Ctx['db']['standing_rule']['rule_id']['find']>>;

export function findRuleRow(db: ReadDb, owner: Identity, pairId: string): RuleRow | undefined {
  for (const r of db.standing_rule.owner.filter(owner)) if (r.pair_id === pairId) return r;
  return undefined;
}

export function toRuleState(db: ReadDb, r: RuleRow): StandingRuleState {
  return {
    ruleId: r.rule_id, ownerId: hex(r.owner), pairId: r.pair_id, supportModes: r.support_modes, availability: r.availability,
    purpose: r.purpose, version: r.version, expiresAtMs: toMs(r.expires_at), revokedAtMs: r.revoked_at ? toMs(r.revoked_at) : null,
    expiredMarked: isExpiredMarked(db, 'standing_rule', r.rule_id, r.version),
  };
}

/**
 * Whether the rule a signal was approved under still stands: same rule id and version, not revoked, not expired
 * (reducer clock, or the sweep marker in views). Signals approved by hand have no rule and always pass. Fail closed:
 * a missing rule row fails.
 */
export function signalRuleStands(db: ReadDb, s: SignalRow, nowMs: number | null): boolean {
  if (s.rule_id === undefined && s.rule_version === undefined) return true;
  const r = s.rule_id === undefined ? undefined : db.standing_rule.rule_id.find(s.rule_id);
  return Boolean(r && r.version === s.rule_version && standingRuleActive(toRuleState(db, r), nowMs));
}
