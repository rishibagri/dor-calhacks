import { t } from 'spacetimedb/server';
import type { Identity } from 'spacetimedb';
import {
  DISCOVERY_CARD_LIMIT, guardDiscoveryVisibility, guardPreferenceStanding, guardSignalStanding, projectDiscoveryCard,
  templateForSignal,
} from '@kinetic/contracts/policy';
import { spacetimedb, account, approved_signal, nudge, disclosure_receipt, nudge_delivery, support_preference } from './schema';
import {
  blockedEitherWay, discoveryEnabled, hex, loadDiscoveryParty, loadPreference, loadStanding, signalExpiredMarked,
  toStoredSignal, type ReadDb,
} from './policy_state';

// Every view filters strictly by ctx.sender. Tables stay private; only these are public.
// Views project minimal client-facing rows (column names are the CS client seam,
// see src/lib/spacetime/mappers.ts). Nothing here reads another user's preset.

const pairViewRow = t.row('PairViewRow', {
  pair_id: t.string(),
  counterpart_identity: t.option(t.identity()),
  counterpart_display_name: t.option(t.string()),
  status: t.string(),
  created_at: t.timestamp(),
});

const inviteViewRow = t.row('InviteViewRow', {
  invite_token: t.string(),
  pair_id: t.string(),
  expires_at: t.timestamp(),
});

const presetViewRow = t.row('PresetViewRow', {
  policy_id: t.string(),
  owner_id: t.identity(),
  preset_kind: t.string(),
  allowed_categories: t.array(t.string()),
  version: t.u32(),
  expires_at: t.timestamp(),
  revoked_at: t.option(t.timestamp()),
});

const assignmentViewRow = t.row('AssignmentViewRow', {
  owner_id: t.identity(),
  recipient_id: t.identity(),
  pair_id: t.string(),
  preset_id: t.string(),
  preset_kind: t.string(),
  assignment_version: t.u32(),
});

export const my_account = spacetimedb.view(
  { name: 'my_account', public: true }, t.option(account.rowType),
  ctx => ctx.db.account.identity.find(ctx.sender) ?? undefined
);

export const my_pairs = spacetimedb.view(
  { name: 'my_pairs', public: true }, t.array(pairViewRow),
  ctx => [...ctx.db.pair.iter()]
    .filter(p => p.member_a.isEqual(ctx.sender) || (p.member_b?.isEqual(ctx.sender) ?? false))
    .map(p => {
      const other = p.member_a.isEqual(ctx.sender) ? p.member_b : p.member_a;
      const otherAccount = other ? ctx.db.account.identity.find(other) : undefined;
      return {
        pair_id: p.pair_id,
        counterpart_identity: other ?? undefined,
        counterpart_display_name: otherAccount?.display_name ?? undefined,
        status: p.status,
        created_at: p.created_at,
      };
    })
);

export const my_invites = spacetimedb.view(
  { name: 'my_invites', public: true }, t.array(inviteViewRow),
  ctx => [...ctx.db.invite.iter()]
    .filter(i => i.creator.isEqual(ctx.sender) && !i.used)
    .map(i => ({ invite_token: i.token, pair_id: i.pair_id, expires_at: i.expires_at }))
);

export const my_presets = spacetimedb.view(
  { name: 'my_presets', public: true }, t.array(presetViewRow),
  ctx => [...ctx.db.relationship_preset.iter()]
    .filter(p => p.owner.isEqual(ctx.sender))
    .map(p => ({
      policy_id: p.preset_id,
      owner_id: p.owner,
      preset_kind: p.preset_kind,
      allowed_categories: p.allowed_categories,
      version: p.version,
      expires_at: p.expires_at,
      revoked_at: p.revoked_at ?? undefined,
    }))
);

export const my_preset_assignments = spacetimedb.view(
  { name: 'my_preset_assignments', public: true }, t.array(assignmentViewRow),
  ctx => {
    const presets = [...ctx.db.relationship_preset.iter()].filter(p => p.owner.isEqual(ctx.sender));
    return [...ctx.db.preset_assignment.iter()]
      .filter(a => a.owner.isEqual(ctx.sender))
      .flatMap(a => {
        const preset = presets.find(p => p.preset_kind === a.preset_kind);
        return preset ? [{
          owner_id: a.owner,
          recipient_id: a.recipient,
          pair_id: a.pair_id,
          preset_id: preset.preset_id,
          preset_kind: a.preset_kind,
          assignment_version: a.assignment_version,
        }] : [];
      });
  }
);

/**
 * Defence in depth (C6): even if a suppression write was missed, a nudge is shown only while
 * every source signal still has standing for this recipient (not revoked, not sweep-expired, pair
 * accepted, same preset/assignment versions, categories still allowed). Views have no clock: expiry
 * reaches views through sweep_expired markers/suppression (stale window ≤ one sweep interval).
 */
function nudgeSourcesStand(db: ReadDb, n: { pair_id: string; source_signal_ids: string[]; source_consent_versions: number[] }, viewer: Identity): boolean {
  if (n.source_signal_ids.length === 0 || n.source_signal_ids.length !== n.source_consent_versions.length) return false;
  return n.source_signal_ids.every((id, i) => {
    const s = db.approved_signal.signal_id.find(id);
    if (!s || s.pair_id !== n.pair_id || s.consent_version !== n.source_consent_versions[i]) return false;
    if (signalExpiredMarked(db, id)) return false;
    return guardSignalStanding(toStoredSignal(s), loadStanding(db, s.sender_id, s.pair_id), hex(viewer)).allowed;
  });
}

/** The recipient's consent the nudge was bound to is still the same record, standing, and still covers its mode. */
function nudgeConsentStands(db: ReadDb, n: { pair_id: string; template_id: string; recipient_consent_id: string }, viewer: Identity): boolean {
  const p = loadPreference(db, viewer, n.pair_id);
  if (!p || p.consentId !== n.recipient_consent_id) return false;
  if (!guardPreferenceStanding(p, hex(viewer), n.pair_id, null).allowed || p.expiresAtMs === 0) return false;
  return p.supportModes.some(m => templateForSignal({ supportMode: m }) === n.template_id);
}

/** Recipient only. Hidden while snoozed (sweep_expired clears snoozed_until when due), dismissed or suppressed. */
export const my_nudges = spacetimedb.view(
  { name: 'my_nudges', public: true }, t.array(nudge.rowType),
  ctx => [...ctx.db.nudge.iter()].filter(n => n.recipient_id.isEqual(ctx.sender) && !n.suppressed && !n.dismissed &&
    n.snoozed_until === undefined && nudgeSourcesStand(ctx.db, n, ctx.sender) && nudgeConsentStands(ctx.db, n, ctx.sender))
);

/** Sender-only: the owner's own approved signals (privacy center: recipient, expiry, revoke). */
export const my_signals = spacetimedb.view(
  { name: 'my_signals', public: true }, t.array(approved_signal.rowType),
  ctx => [...ctx.db.approved_signal.iter()].filter(s => s.sender_id.isEqual(ctx.sender))
);

/**
 * Sender-only (D026). Recipients must not see approved/revoked/suppressed receipts: that would
 * reveal a disclosure that produced no nudge, or a revocation. Recipients learn only via my_nudges.
 */
export const my_receipts = spacetimedb.view(
  { name: 'my_receipts', public: true }, t.array(disclosure_receipt.rowType),
  ctx => [...ctx.db.disclosure_receipt.iter()].filter(r => r.sender_id.isEqual(ctx.sender))
);

/** Recipient only: the caller's own support-preference consents (D035). Never visible to the sender. */
export const my_support_preferences = spacetimedb.view(
  { name: 'my_support_preferences', public: true }, t.array(support_preference.rowType),
  ctx => [...ctx.db.support_preference.iter()].filter(p => p.recipient.isEqual(ctx.sender))
);

/** The caller's own recipient delivery settings (D017/D018). */
export const my_nudge_delivery = spacetimedb.view(
  { name: 'my_nudge_delivery', public: true }, t.array(nudge_delivery.rowType),
  ctx => [...ctx.db.nudge_delivery.iter()].filter(d => d.recipient.isEqual(ctx.sender))
);

// ---- Worker-only views (C4/F6). Empty for every identity not in worker_identity. ----
// They give the worker's DisclosurePolicy an AUTHORITATIVE reader (not the envelope it was handed).
// Advisory only: commit_nudge re-checks everything at commit.

const workerSignalRow = t.row('WorkerSignalRow', {
  signal_id: t.string(), pair_id: t.string(), sender_id: t.identity(), recipient_id: t.identity(),
  purpose: t.string(), support_mode: t.option(t.string()), availability: t.option(t.string()),
  consent_version: t.u32(), recipient_policy_id: t.string(), recipient_policy_version: t.u32(),
  preset_assignment_version: t.u32(), expires_at: t.timestamp(),
  // standing snapshot (metadata only)
  pair_status: t.string(), pair_member_a: t.identity(), pair_member_b: t.option(t.identity()),
  assignment_recipient: t.option(t.identity()), assignment_preset_id: t.option(t.string()),
  assignment_version: t.option(t.u32()), preset_allowed_categories: t.array(t.string()),
  preset_version: t.option(t.u32()), preset_expires_at: t.option(t.timestamp()), preset_revoked: t.bool(),
});

const isWorker = (db: ReadDb, who: Identity): boolean => Boolean(db.worker_identity.identity.find(who)); // find() returns null, not undefined

export const worker_signal_context = spacetimedb.view(
  { name: 'worker_signal_context', public: true }, t.array(workerSignalRow),
  ctx => {
    if (!isWorker(ctx.db, ctx.sender)) return [];
    return [...ctx.db.approved_signal.iter()]
      .filter(s => !s.revoked_at && !signalExpiredMarked(ctx.db, s.signal_id) && guardSignalStanding(toStoredSignal(s), loadStanding(ctx.db, s.sender_id, s.pair_id)).allowed)
      .flatMap(s => {
        const p = ctx.db.pair.pair_id.find(s.pair_id);
        if (!p) return [];
        const a = [...ctx.db.preset_assignment.iter()].find(r => r.pair_id === s.pair_id && r.owner.isEqual(s.sender_id));
        const pr = a ? [...ctx.db.relationship_preset.iter()].find(r => r.owner.isEqual(s.sender_id) && r.preset_kind === a.preset_kind) : undefined;
        return [{
          signal_id: s.signal_id, pair_id: s.pair_id, sender_id: s.sender_id, recipient_id: s.recipient_id,
          purpose: s.purpose, support_mode: s.support_mode, availability: s.availability,
          consent_version: s.consent_version, recipient_policy_id: s.recipient_policy_id,
          recipient_policy_version: s.recipient_policy_version, preset_assignment_version: s.preset_assignment_version,
          expires_at: s.expires_at, pair_status: p.status, pair_member_a: p.member_a, pair_member_b: p.member_b,
          assignment_recipient: a?.recipient, assignment_preset_id: pr?.preset_id, assignment_version: a?.assignment_version,
          preset_allowed_categories: pr?.allowed_categories ?? [], preset_version: pr?.version,
          preset_expires_at: pr?.expires_at, preset_revoked: pr?.revoked_at !== undefined,
        }];
      });
  }
);

const workerDeliveryRow = t.row('WorkerDeliveryRow', {
  pair_id: t.string(), recipient: t.identity(), opted_in: t.bool(),
  quiet_start_minute: t.option(t.u16()), quiet_end_minute: t.option(t.u16()), utc_offset_minutes: t.i16(),
  last_nudge_at: t.option(t.timestamp()),
});

/** Opted-in delivery rows plus the pair's last nudge time, for the coordinator's pre-check (DeliveryStatePort). */
export const worker_delivery = spacetimedb.view(
  { name: 'worker_delivery', public: true }, t.array(workerDeliveryRow),
  ctx => {
    if (!isWorker(ctx.db, ctx.sender)) return [];
    return [...ctx.db.nudge_delivery.iter()].filter(d => d.opted_in).map(d => {
      const last = [...ctx.db.nudge.iter()].filter(n => n.pair_id === d.pair_id)
        .reduce<typeof d.updated_at | undefined>((m, n) => (!m || n.created_at.microsSinceUnixEpoch > m.microsSinceUnixEpoch ? n.created_at : m), undefined);
      return {
        pair_id: d.pair_id, recipient: d.recipient, opted_in: d.opted_in, quiet_start_minute: d.quiet_start_minute,
        quiet_end_minute: d.quiet_end_minute, utc_offset_minutes: d.utc_offset_minutes, last_nudge_at: last,
      };
    });
  }
);

const workerPreferenceRow = t.row('WorkerPreferenceRow', {
  consent_id: t.string(), pair_id: t.string(), recipient: t.identity(), support_modes: t.array(t.string()),
  availability: t.array(t.string()), consent_version: t.u32(), expires_at: t.timestamp(),
});

/**
 * Standing recipient consents in accepted pairs, backing the worker's RecipientPreferencesPort (D021 #4).
 * Map to RecipientSupportPreferences with purpose 'support_nudge' and revokedAt null. Advisory: commit_nudge
 * re-checks the bound consent id/version against the live row.
 */
export const worker_support_preferences = spacetimedb.view(
  { name: 'worker_support_preferences', public: true }, t.array(workerPreferenceRow),
  ctx => {
    if (!isWorker(ctx.db, ctx.sender)) return [];
    return [...ctx.db.support_preference.iter()].flatMap(p => {
      const pref = loadPreference(ctx.db, p.recipient, p.pair_id);
      if (!pref || pref.expiresAtMs === 0 || !guardPreferenceStanding(pref, hex(p.recipient), p.pair_id, null).allowed) return [];
      if (ctx.db.pair.pair_id.find(p.pair_id)?.status !== 'accepted') return [];
      return [{
        consent_id: p.consent_id, pair_id: p.pair_id, recipient: p.recipient, support_modes: p.support_modes,
        availability: p.availability, consent_version: p.consent_version, expires_at: p.expires_at,
      }];
    });
  }
);

// ---- C8 discovery views (PROPOSED; empty while discovery is disabled) ----

const myDiscoveryRow = t.row('MyDiscoveryRow', {
  publication_id: t.option(t.string()), display_name: t.option(t.string()), interest_tags: t.array(t.string()),
  revision: t.u32(), expires_at: t.option(t.timestamp()), withdrawn: t.bool(), expired: t.bool(),
  area_key: t.option(t.string()), area_expires_at: t.option(t.timestamp()), area_active: t.bool(), discovery_enabled: t.bool(),
});

/** The caller's own publication and area status (privacy controls: what is published, until when, withdraw). */
export const my_discovery_profile = spacetimedb.view(
  { name: 'my_discovery_profile', public: true }, t.array(myDiscoveryRow),
  ctx => {
    const me = loadDiscoveryParty(ctx.db, ctx.sender);
    const p = me.publication, a = ctx.db.area_participation.owner.find(ctx.sender);
    const pubRow = [...ctx.db.discovery_publication.iter()].find(r => r.owner.isEqual(ctx.sender));
    return [{
      publication_id: p?.publicationId, display_name: p?.displayName, interest_tags: p ? [...p.interestTags] : [],
      revision: p?.revision ?? 0, expires_at: pubRow?.expires_at, withdrawn: p?.withdrawnAtMs != null,
      expired: Boolean(p?.expiredMarked || me.area?.expiredMarked), area_key: a?.area_key, area_expires_at: a?.expires_at,
      area_active: Boolean(a?.active), discovery_enabled: discoveryEnabled(ctx.db),
    }];
  }
);

const discoveryCardRow = t.row('DiscoveryCardRow', {
  card_ref: t.string(), display_name: t.string(), interest_tags: t.array(t.string()),
  shared_tags: t.array(t.string()), revision: t.u32(),
});

/**
 * C8 caller-filtered projection: only for a currently published viewer with active area participation; only
 * other published participants in the same configured area with no block either way. Opaque card refs and
 * approved public fields only: no identity, area key, expiry, pair, preset, preference, quiz or journal data.
 * Bounded to DISCOVERY_CARD_LIMIT; never a user directory.
 */
export const discovery_cards = spacetimedb.view(
  { name: 'discovery_cards', public: true }, t.array(discoveryCardRow),
  ctx => {
    const enabled = discoveryEnabled(ctx.db);
    if (!enabled || !ctx.db.account.identity.find(ctx.sender)) return [];
    const viewer = loadDiscoveryParty(ctx.db, ctx.sender);
    if (!viewer.publication || !viewer.area) return [];
    const cards = [];
    for (const r of ctx.db.discovery_publication.iter()) {
      if (cards.length >= DISCOVERY_CARD_LIMIT) break;
      if (r.owner.isEqual(ctx.sender)) continue;
      const target = loadDiscoveryParty(ctx.db, r.owner);
      if (!guardDiscoveryVisibility(viewer, target, blockedEitherWay(ctx.db, ctx.sender, r.owner), enabled, null).ok) continue;
      const c = projectDiscoveryCard(target.publication!, viewer.publication.interestTags);
      cards.push({ card_ref: c.cardRef, display_name: c.displayName, interest_tags: c.interestTags, shared_tags: c.sharedTags, revision: c.revision });
    }
    return cards;
  }
);
