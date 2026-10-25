import { connectedCounterparts, findAssignment, findPreset, findPublicationRow, pairsOf, pauseInForce, standingApprovalStands, standingRuleActive } from './policy_state';
import { t } from 'spacetimedb/server';
import { Timestamp, type Identity } from 'spacetimedb';
import {
  catalogueEventUsable, currentPlanStatus, intentStands,
  DISCOVERY_CARD_LIMIT, discoveryParticipantDenial, guardDiscoveryVisibility, guardPreferenceStanding, guardSignalStanding,
  projectDiscoveryCard, templateForSignal, WORKER_INTRODUCTION_CANDIDATE_LIMIT,
} from '@dor/contracts/policy';
import { spacetimedb, account, approved_signal, nudge, disclosure_receipt, nudge_delivery, support_preference } from './schema';
import {
  blockedEitherWay, discoveryEnabled, hex, loadDiscoveryParty, loadPreference, loadStanding, signalExpiredMarked,
  toStoredSignal, type ReadDb,
} from './policy_state';
import {
  approvalsStand, findIntentRow, loadCatalogueEvent, loadPlanCheck, toApprovalState, toCatalogueState, toIntentState, toPlanState,
  type PlanRow,
} from './event_state';

const CATALOGUE_VIEW_LIMIT = 200;
const WORKER_PLAN_LIMIT = 200;

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
  ctx => pairsOf(ctx.db, ctx.sender)
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
  ctx => [...ctx.db.invite.creator.filter(ctx.sender)]
    .filter(i => !i.used)
    .map(i => ({ invite_token: i.token, pair_id: i.pair_id, expires_at: i.expires_at }))
);

export const my_presets = spacetimedb.view(
  { name: 'my_presets', public: true }, t.array(presetViewRow),
  ctx => [...ctx.db.relationship_preset.owner.filter(ctx.sender)]
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
    const presets = [...ctx.db.relationship_preset.owner.filter(ctx.sender)];
    return [...ctx.db.preset_assignment.owner.filter(ctx.sender)]
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
    if (pauseInForce(db, s.sender_id, s.pair_id, null)) return false; // D041: the sender is pausing this person
    if (!standingApprovalStands(db, id, null)) return false; // D044: the approving rule no longer stands
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

const HOUR_MICROS = 3_600_000_000n;
/** Rounds up to the next whole hour, so the recipient can't recover the sender's approval moment from the expiry. */
const ceilToHour = (ts: Timestamp): Timestamp =>
  new Timestamp(((ts.microsSinceUnixEpoch + HOUR_MICROS - 1n) / HOUR_MICROS) * HOUR_MICROS);

const myNudgeRow = t.row('MyNudgeRow', {
  id: t.string(), pair_id: t.string(), template_id: t.string(), visible_until: t.timestamp(),
});

/**
 * Recipient only. Hidden while snoozed (sweep_expired clears snoozed_until when due), dismissed or suppressed.
 * Narrow projection (Core 3 audit item 2): no created_at, exact expires_at, source signal ids, consent versions or
 * consent id, because expires_at − SIGNAL_LIFETIME_MS was the sender's exact approval moment. `visible_until` is
 * rounded up to the hour. The moment a nudge first appears to a live subscriber is inherent to delivery and still
 * roughly tracks the commit; batching delivery would be the mitigation for that (not implemented).
 */
export const my_nudges = spacetimedb.view(
  { name: 'my_nudges', public: true }, t.array(myNudgeRow),
  ctx => [...ctx.db.nudge.recipient_id.filter(ctx.sender)].filter(n => !n.suppressed && !n.dismissed &&
    n.snoozed_until === undefined && nudgeSourcesStand(ctx.db, n, ctx.sender) && nudgeConsentStands(ctx.db, n, ctx.sender))
    .map(n => ({ id: n.id, pair_id: n.pair_id, template_id: n.template_id, visible_until: ceilToHour(n.expires_at) }))
);

/** Sender-only: the owner's own approved signals (privacy center: recipient, expiry, revoke). */
export const my_signals = spacetimedb.view(
  { name: 'my_signals', public: true }, t.array(approved_signal.rowType),
  ctx => [...ctx.db.approved_signal.sender_id.filter(ctx.sender)]
);

/** Receipt actions the sender caused themselves. `used` and `suppressed` are recipient-side outcomes (audit item 3). */
const SENDER_OWN_ACTIONS = new Set(['approved', 'revoked']);

/**
 * Sender-only (D026), and only the sender's OWN actions (Core 3 audit item 3). `used` (a nudge was committed) and
 * `suppressed` (unlink or recipient-side changes) would tell the sender whether the recipient is opted in, in quiet
 * hours or cooldown, accepts that mode, or changed settings: indirect disclosure from recipient to sender. Those rows
 * stay in the private table as an audit trail and are never projected. Recipients never see receipts at all.
 */
export const my_receipts = spacetimedb.view(
  { name: 'my_receipts', public: true }, t.array(disclosure_receipt.rowType),
  ctx => [...ctx.db.disclosure_receipt.sender_id.filter(ctx.sender)].filter(r => SENDER_OWN_ACTIONS.has(r.action))
);

/** Recipient only: the caller's own support-preference consents (D035). Never visible to the sender. */
export const my_support_preferences = spacetimedb.view(
  { name: 'my_support_preferences', public: true }, t.array(support_preference.rowType),
  ctx => [...ctx.db.support_preference.recipient.filter(ctx.sender)]
);

/** The caller's own recipient delivery settings (D017/D018). */
export const my_nudge_delivery = spacetimedb.view(
  { name: 'my_nudge_delivery', public: true }, t.array(nudge_delivery.rowType),
  ctx => [...ctx.db.nudge_delivery.recipient.filter(ctx.sender)]
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
      .filter(s => !s.revoked_at && !signalExpiredMarked(ctx.db, s.signal_id) &&
        !pauseInForce(ctx.db, s.sender_id, s.pair_id, null) && // D041: paused pairs' signals are not presented
        standingApprovalStands(ctx.db, s.signal_id, null) && // D044: automatic approvals only while their rule stands
        guardSignalStanding(toStoredSignal(s), loadStanding(ctx.db, s.sender_id, s.pair_id)).allowed)
      .flatMap(s => {
        const p = ctx.db.pair.pair_id.find(s.pair_id);
        if (!p) return [];
        const a = findAssignment(ctx.db, s.sender_id, s.pair_id);
        const pr = a ? findPreset(ctx.db, s.sender_id, a.preset_kind) : undefined;
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
      const last = [...ctx.db.nudge.pair_id.filter(d.pair_id)]
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
    const pubRow = findPublicationRow(ctx.db, ctx.sender);
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
 *
 * CS-R2 indexed query: reads only area_participation rows in the viewer's area (btree on area_key), never the whole
 * publication table. Cards are in card-ref order after the viewer's own discovery_page cursor, so a client can page
 * through a dense area deterministically. People the viewer already has an accepted introduction with are left out
 * (they are connected; a card would only invite a refused request).
 */
export const discovery_cards = spacetimedb.view(
  { name: 'discovery_cards', public: true }, t.array(discoveryCardRow),
  ctx => {
    const enabled = discoveryEnabled(ctx.db);
    if (!enabled || !ctx.db.account.identity.find(ctx.sender)) return [];
    const viewer = loadDiscoveryParty(ctx.db, ctx.sender);
    if (!viewer.publication || !viewer.area) return [];
    const after = ctx.db.discovery_page.owner.find(ctx.sender)?.after_ref ?? '';
    const connected = connectedCounterparts(ctx.db, ctx.sender); // accepted introductions and linked pairs
    const eligible = [];
    for (const a of ctx.db.area_participation.area_key.filter(viewer.area.areaKey)) {
      if (a.owner.isEqual(ctx.sender) || connected.has(a.owner.toHexString())) continue;
      const target = loadDiscoveryParty(ctx.db, a.owner);
      if (!target.publication || target.publication.publicationId <= after) continue;
      if (!guardDiscoveryVisibility(viewer, target, blockedEitherWay(ctx.db, ctx.sender, a.owner), enabled, null).ok) continue;
      eligible.push(projectDiscoveryCard(target.publication, viewer.publication.interestTags));
    }
    eligible.sort((x, y) => (x.cardRef < y.cardRef ? -1 : x.cardRef > y.cardRef ? 1 : 0));
    return eligible.slice(0, DISCOVERY_CARD_LIMIT).map(c => (
      { card_ref: c.cardRef, display_name: c.displayName, interest_tags: c.interestTags, shared_tags: c.sharedTags, revision: c.revision }));
  }
);


// ---- C8 introductions (CYBER-R2, PROPOSED) ----

const introductionRow = t.row('IntroductionRow', {
  intro_id: t.string(), direction: t.string(), status: t.string(), counterpart_name: t.option(t.string()),
  shared_tags: t.array(t.string()), created_at: t.timestamp(), expires_at: t.option(t.timestamp()),
});

/**
 * The caller's own introductions. No identities or card refs. Incoming: the sender's public name snapshot and
 * the published overlap; a pending request is shown only while the sender's profile still stands unchanged.
 * Outgoing: accepted | pending | closed. A decline is never revealed (it reads "pending" until it lapses), and the
 * recipient's name appears only after they accept. Anything between blocked people is hidden.
 */
export const my_introductions = spacetimedb.view(
  { name: 'my_introductions', public: true }, t.array(introductionRow),
  ctx => {
    if (!ctx.db.account.identity.find(ctx.sender)) return [];
    const out = [];
    for (const r of [...ctx.db.introduction.sender.filter(ctx.sender), ...ctx.db.introduction.recipient.filter(ctx.sender)]) {
      const incoming = r.recipient.isEqual(ctx.sender);
      if (incoming && r.sender.isEqual(ctx.sender)) continue; // self-introduction is impossible; never list twice
      if (blockedEitherWay(ctx.db, r.sender, r.recipient)) continue;
      let status: string;
      if (incoming) {
        if (r.status === 'pending') {
          const pub = loadDiscoveryParty(ctx.db, r.sender).publication;
          const stands = pub && pub.withdrawnAtMs === null && !pub.expiredMarked && pub.revision === r.sender_revision;
          if (!stands) continue;
          status = 'pending';
        } else status = r.status === 'accepted' || r.status === 'declined' ? r.status : 'closed';
      } else {
        // accepted | pending | closed only: whether the recipient declined, withdrew or let it lapse is theirs.
        status = r.status === 'accepted' ? 'accepted'
          : (r.status === 'pending' || r.status === 'declined') && !r.sender_closed ? 'pending' : 'closed';
      }
      out.push({
        intro_id: r.intro_id, direction: incoming ? 'incoming' : 'outgoing', status,
        counterpart_name: incoming ? r.sender_name : status === 'accepted' ? r.recipient_name : undefined,
        shared_tags: r.shared_tags, created_at: r.created_at, expires_at: status === 'pending' ? r.expires_at : undefined,
      });
    }
    return out;
  }
);

const introductionProposalRow = t.row('IntroductionProposalRow', {
  proposal_id: t.string(), candidate_ref: t.string(), reason_code: t.string(), shared_tags: t.array(t.string()),
  opener_id: t.string(), decided_by: t.string(), expires_at: t.timestamp(),
});

/**
 * The viewer's own AI introduction suggestions, rechecked live: the candidate must still be visible to the
 * viewer (publication, area, block, sweep expiry) and both profiles unchanged since the proposal.
 */
export const my_introduction_proposals = spacetimedb.view(
  { name: 'my_introduction_proposals', public: true }, t.array(introductionProposalRow),
  ctx => {
    const enabled = discoveryEnabled(ctx.db);
    if (!enabled || !ctx.db.account.identity.find(ctx.sender)) return [];
    const viewer = loadDiscoveryParty(ctx.db, ctx.sender);
    const out = [];
    for (const p of ctx.db.introduction_proposal.viewer.filter(ctx.sender)) {
      const cand = loadDiscoveryParty(ctx.db, p.candidate);
      if (!guardDiscoveryVisibility(viewer, cand, blockedEitherWay(ctx.db, p.viewer, p.candidate), enabled, null).ok) continue;
      if (viewer.publication!.revision !== p.viewer_revision || cand.publication!.revision !== p.candidate_revision) continue;
      out.push({ proposal_id: p.proposal_id, candidate_ref: p.candidate_ref, reason_code: p.reason_code, shared_tags: p.shared_tags,
        opener_id: p.opener_id, decided_by: p.decided_by, expires_at: p.expires_at });
    }
    return out;
  }
);

// ---- C7/C8 events and shared plans (CYBER-R3, PROPOSED) ----

const catalogueRow = t.row('CatalogueEventRow', {
  event_id: t.string(), title: t.string(), starts_at: t.timestamp(), ends_at: t.option(t.timestamp()), topics: t.array(t.string()),
  format: t.string(), area_key: t.option(t.string()), source_url: t.option(t.string()), fetched_at: t.timestamp(),
});

/**
 * Public catalogue for registered accounts: scheduled records not yet started or stale (sweep markers). Not
 * joined to any user row (the client filters by its own area). Bounded; never includes intents or counts.
 */
export const catalogue_events = spacetimedb.view(
  { name: 'catalogue_events', public: true }, t.array(catalogueRow),
  ctx => {
    if (!discoveryEnabled(ctx.db) || !ctx.db.account.identity.find(ctx.sender)) return [];
    const out = [];
    for (const e of ctx.db.catalogue_event.iter()) {
      if (out.length >= CATALOGUE_VIEW_LIMIT) break;
      if (catalogueEventUsable(toCatalogueState(ctx.db, e), null)) continue;
      out.push({ event_id: e.event_id, title: e.title, starts_at: e.starts_at, ends_at: e.ends_at, topics: e.topics, format: e.format,
        area_key: e.area_key, source_url: e.source_url, fetched_at: e.fetched_at });
    }
    return out;
  }
);

const catalogueStatusRow = t.row('CatalogueStatusRow', {
  feed_key: t.string(), last_attempt_at: t.timestamp(), last_success_at: t.option(t.timestamp()), last_status: t.string(),
  record_count: t.u32(),
});

/** Ingestion health per configured feed (registered accounts, discovery enabled). Operational metadata only. */
export const catalogue_status = spacetimedb.view(
  { name: 'catalogue_status', public: true }, t.array(catalogueStatusRow),
  ctx => {
    if (!discoveryEnabled(ctx.db) || !ctx.db.account.identity.find(ctx.sender)) return [];
    return [...ctx.db.catalogue_source.iter()].map(r => ({ ...r })); // bounded by the configured feed count
  }
);

const myIntentRow = t.row('MyEventIntentRow', {
  event_id: t.string(), kind: t.string(), version: t.u32(), active: t.bool(), expires_at: t.timestamp(),
});

/**
 * The caller's own event intents that have not lapsed, including withdrawn ones (active = false) so the client
 * knows the version to pass when publishing again. Withdraw from here.
 */
export const my_event_intents = spacetimedb.view(
  { name: 'my_event_intents', public: true }, t.array(myIntentRow),
  ctx => [...ctx.db.event_intent.owner.filter(ctx.sender)]
    .filter(i => !toIntentState(ctx.db, i).expiredMarked)
    .map(i => ({ event_id: i.event_id, kind: i.kind, version: i.version, active: !i.revoked_at, expires_at: i.expires_at }))
);

const companionRow = t.row('EventCompanionRow', { card_ref: t.string(), event_id: t.string() });

/**
 * Mutual event overlap only: (card, event) where the caller can see the card now AND both currently published
 * intent for the same usable event. You never learn someone's intent for an event you did not mark yourself.
 * The kind (interested/going) is not shown to others.
 */
export const event_companions = spacetimedb.view(
  { name: 'event_companions', public: true }, t.array(companionRow),
  ctx => {
    const enabled = discoveryEnabled(ctx.db);
    if (!enabled || !ctx.db.account.identity.find(ctx.sender)) return [];
    const viewer = loadDiscoveryParty(ctx.db, ctx.sender);
    if (!viewer.publication || !viewer.area) return [];
    const mine = new Set([...ctx.db.event_intent.owner.filter(ctx.sender)]
      .filter(i => intentStands(toIntentState(ctx.db, i), hex(ctx.sender), i.event_id, null, null) &&
        !catalogueEventUsable(loadCatalogueEvent(ctx.db, i.event_id), null))
      .map(i => i.event_id));
    if (mine.size === 0) return [];
    const out = [];
    for (const i of [...mine].flatMap(id => [...ctx.db.event_intent.event_id.filter(id)])) {
      if (out.length >= DISCOVERY_CARD_LIMIT) break;
      if (i.owner.isEqual(ctx.sender)) continue;
      if (!intentStands(toIntentState(ctx.db, i), hex(i.owner), i.event_id, null, null)) continue;
      const target = loadDiscoveryParty(ctx.db, i.owner);
      if (!guardDiscoveryVisibility(viewer, target, blockedEitherWay(ctx.db, ctx.sender, i.owner), enabled, null).ok) continue;
      out.push({ card_ref: target.publication!.publicationId, event_id: i.event_id });
    }
    return out;
  }
);

const myApprovalRow = t.row('MyActivityApprovalRow', { approval_id: t.string(), pair_id: t.string(), topics: t.array(t.string()), expires_at: t.timestamp() });

/** The caller's own standing C7 approvals (owner only; the recipient never sees topics outside a plan). */
export const my_activity_approvals = spacetimedb.view(
  { name: 'my_activity_approvals', public: true }, t.array(myApprovalRow),
  ctx => [...ctx.db.activity_approval.owner.filter(ctx.sender)]
    .filter(a => !a.revoked_at && !toApprovalState(ctx.db, a).expiredMarked)
    .map(a => ({ approval_id: a.approval_id, pair_id: a.pair_id, topics: a.topics, expires_at: a.expires_at }))
);

const planRow = t.row('SharedPlanRow', {
  plan_id: t.string(), revision: t.u32(), status: t.string(), my_acceptance: t.bool(), event_id: t.string(), event_title: t.string(),
  event_starts_at: t.timestamp(), source_url: t.option(t.string()), counterpart_name: t.option(t.string()), expires_at: t.timestamp(),
});

/**
 * The caller's own plans. Status is recomputed live from current sources (stale when an intent, approval,
 * basis, block or catalogue record no longer holds). The other person's acceptance is never shown before both
 * accepted ("confirmed"), and who declined or cancelled is shown only to that person (others see "closed").
 */
export const my_plans = spacetimedb.view(
  { name: 'my_plans', public: true }, t.array(planRow),
  ctx => {
    const out = [];
    for (const p of [...ctx.db.shared_plan.participant_a.filter(ctx.sender), ...ctx.db.shared_plan.participant_b.filter(ctx.sender)]) {
      const isA = p.participant_a.isEqual(ctx.sender);
      if (blockedEitherWay(ctx.db, p.participant_a, p.participant_b)) continue;
      const live = currentPlanStatus(toPlanState(p), loadPlanCheck(ctx.db, p, null));
      const status = live === 'declined' || live === 'cancelled'
        ? (p.closed_by?.isEqual(ctx.sender) ? live : 'closed') : live;
      const other = isA ? p.participant_b : p.participant_a;
      const e = ctx.db.catalogue_event.event_id.find(p.event_id);
      out.push({
        plan_id: p.plan_id, revision: p.revision, status, my_acceptance: isA ? p.accepted_a : p.accepted_b, event_id: p.event_id,
        event_title: e?.title ?? '', event_starts_at: p.event_starts_at, source_url: e?.source_url,
        counterpart_name: counterpartName(ctx.db, p, other), expires_at: p.expires_at,
      });
    }
    return out;
  }
);

/** Introduction basis: the public-name snapshots both people agreed to. Pair basis: the counterpart's account name. */
function counterpartName(db: ReadDb, p: PlanRow, other: Identity): string | undefined {
  if (p.basis_kind === 'introduction') {
    const r = db.introduction.intro_id.find(p.basis_ref);
    if (!r) return undefined;
    return r.sender.isEqual(other) ? r.sender_name : r.recipient_name;
  }
  return db.account.identity.find(other)?.display_name;
}

const planCandidateRow = t.row('WorkerPlanCandidateRow', {
  basis_kind: t.string(), basis_ref: t.string(), event_id: t.string(), intent_ids: t.array(t.string()),
  intent_versions: t.array(t.u32()), approval_ids: t.array(t.string()), event_starts_at: t.timestamp(), fetched_at: t.timestamp(),
  topics: t.array(t.string()), format: t.string(),
});

/**
 * Worker-only plan inputs: for each current basis, events both participants currently intend, with the exact
 * intent (and C7 approval) ids and versions commit_plan_proposal binds. Opaque ids, topics and times only: no
 * names, identities, titles or source text. Empty for every non-worker caller.
 */
export const worker_plan_candidates = spacetimedb.view(
  { name: 'worker_plan_candidates', public: true }, t.array(planCandidateRow),
  ctx => {
    if (!ctx.db.worker_identity.identity.find(ctx.sender) || !discoveryEnabled(ctx.db)) return [];
    const out = [];
    const bases: { kind: string; ref: string; a: Identity; b: Identity }[] = [];
    for (const r of ctx.db.introduction.iter()) if (r.status === 'accepted') bases.push({ kind: 'introduction', ref: r.intro_id, a: r.sender, b: r.recipient });
    for (const p of ctx.db.pair.iter()) if (p.status === 'accepted' && p.member_b) bases.push({ kind: 'existing_connection', ref: p.pair_id, a: p.member_a, b: p.member_b });
    for (const base of bases) {
      if (blockedEitherWay(ctx.db, base.a, base.b)) continue;
      for (const ia of ctx.db.event_intent.owner.filter(base.a)) {
        if (out.length >= WORKER_PLAN_LIMIT) return out;
        if (!intentStands(toIntentState(ctx.db, ia), hex(base.a), ia.event_id, null, null)) continue;
        const ib = findIntentRow(ctx.db, base.b, ia.event_id);
        if (!ib || !intentStands(toIntentState(ctx.db, ib), hex(base.b), ia.event_id, null, null)) continue;
        const e = ctx.db.catalogue_event.event_id.find(ia.event_id);
        if (!e || catalogueEventUsable(toCatalogueState(ctx.db, e), null)) continue;
        let approvals: string[] = [];
        if (base.kind === 'existing_connection') {
          const pick = (owner: Identity, other: Identity) => [...ctx.db.activity_approval.owner.filter(owner)].find(x => x.pair_id === base.ref &&
            x.recipient.isEqual(other) && !x.revoked_at && !toApprovalState(ctx.db, x).expiredMarked &&
            x.topics.some(t => e.topics.includes(t)))?.approval_id;
          const pa = pick(base.a, base.b), pb = pick(base.b, base.a);
          if (!pa || !pb || !approvalsStand(ctx.db, base.ref, base.a, base.b, pa, pb, e.topics, null)) continue;
          approvals = [pa, pb];
        }
        out.push({ basis_kind: base.kind, basis_ref: base.ref, event_id: e.event_id, intent_ids: [ia.intent_id, ib.intent_id],
          intent_versions: [ia.version, ib.version], approval_ids: approvals, event_starts_at: e.starts_at, fetched_at: e.fetched_at,
          topics: e.topics, format: e.format });
      }
    }
    return out;
  }
);

// ---- D041 recipient pause (owner only) ----

const myPauseRow = t.row('MyRecipientPauseRow', {
  pair_id: t.string(), version: t.u32(), expires_at: t.timestamp(), active: t.bool(), created_at: t.timestamp(),
});

/**
 * The caller's own pauses (one per pair they paused): who (by pair_id; the client shows the name from my_pairs),
 * until when, and whether it is still in force. `version` is what pause/resume pass as expected_version. Nobody
 * else, including the paused person, has any view of this table.
 */
export const my_recipient_pauses = spacetimedb.view(
  { name: 'my_recipient_pauses', public: true }, t.array(myPauseRow),
  ctx => [...ctx.db.recipient_pause.owner.filter(ctx.sender)].map(p => ({
    pair_id: p.pair_id, version: p.version, expires_at: p.expires_at, created_at: p.created_at,
    active: pauseInForce(ctx.db, ctx.sender, p.pair_id, null),
  }))
);

// ---- D044 automatic nudges (owner only) ----

const myStandingRow = t.row('MyStandingConsentRow', {
  pair_id: t.string(), categories: t.array(t.string()), version: t.u32(), expires_at: t.timestamp(), active: t.bool(), created_at: t.timestamp(),
});

/**
 * The caller's own standing rules: which pair, which categories, until when, and whether it still stands. `version` is
 * what set_standing_consent takes as expected_version and approve_signal_standing as rule_version. The recipient and
 * everyone else have no view of this table.
 */
export const my_standing_consents = spacetimedb.view(
  { name: 'my_standing_consents', public: true }, t.array(myStandingRow),
  ctx => [...ctx.db.standing_consent.owner.filter(ctx.sender)].map(r => ({
    pair_id: r.pair_id, categories: r.categories, version: r.version, expires_at: r.expires_at, created_at: r.created_at,
    // Same check the reducers use (standingRuleStands), so a rule made stale by a preset/assignment change reads inactive.
    active: standingRuleActive(ctx.db, r),
  }))
);

// ---- D048 viewer-initiated AI introduction suggestions (PROPOSED, AI; Cyber review requested) ----

const WORKER_INTRO_ROW_LIMIT = 200;

const workerIntroRequestRow = t.row('WorkerIntroductionRequestRow', {
  request_id: t.string(), viewer_ref: t.string(), viewer_revision: t.u32(), expires_at: t.timestamp(),
  candidate_ref: t.option(t.string()), candidate_revision: t.u32(), shared_tags: t.array(t.string()),
});

/**
 * Worker-only suggestion inputs: one row per (open request, candidate the viewer can see now and shares at least
 * one published tag with), at most WORKER_INTRODUCTION_CANDIDATE_LIMIT per request in card-ref order; or a single
 * row without a candidate, so the worker closes an empty request (or one whose viewer stopped participating)
 * without a model call. People the viewer is connected to, has a pending request with, or already has a
 * suggestion for are left out (commit_introduction_proposal would refuse them). Opaque refs, current revisions
 * and the published overlap only: no names, identities, area keys or other tags. Empty for every non-worker
 * caller. Clockless: the worker skips requests past expires_at.
 */
export const worker_introduction_requests = spacetimedb.view(
  { name: 'worker_introduction_requests', public: true }, t.array(workerIntroRequestRow),
  ctx => {
    if (!ctx.db.worker_identity.identity.find(ctx.sender) || !discoveryEnabled(ctx.db)) return [];
    const out = [];
    for (const r of ctx.db.introduction_suggestion_request.status.filter('open')) {
      if (out.length >= WORKER_INTRO_ROW_LIMIT) break;
      const viewer = loadDiscoveryParty(ctx.db, r.viewer);
      const head = { request_id: r.request_id, viewer_ref: viewer.publication?.publicationId ?? '',
        viewer_revision: viewer.publication?.revision ?? 0, expires_at: r.expires_at };
      const none = { ...head, candidate_ref: undefined, candidate_revision: 0, shared_tags: [] as string[] };
      if (discoveryParticipantDenial(viewer, null)) { out.push(none); continue; }
      const skip = connectedCounterparts(ctx.db, r.viewer);
      for (const i of ctx.db.introduction.sender.filter(r.viewer)) if (i.status === 'pending') skip.add(hex(i.recipient));
      for (const i of ctx.db.introduction.recipient.filter(r.viewer)) if (i.status === 'pending') skip.add(hex(i.sender));
      for (const p of ctx.db.introduction_proposal.viewer.filter(r.viewer)) skip.add(hex(p.candidate));
      const cards = [];
      for (const a of ctx.db.area_participation.area_key.filter(viewer.area!.areaKey)) {
        if (a.owner.isEqual(r.viewer) || skip.has(hex(a.owner))) continue;
        const target = loadDiscoveryParty(ctx.db, a.owner);
        if (!target.publication) continue;
        if (!guardDiscoveryVisibility(viewer, target, blockedEitherWay(ctx.db, r.viewer, a.owner), true, null).ok) continue;
        const card = projectDiscoveryCard(target.publication, viewer.publication!.interestTags);
        if (card.sharedTags.length > 0) cards.push(card);
      }
      if (cards.length === 0) { out.push(none); continue; }
      cards.sort((x, y) => (x.cardRef < y.cardRef ? -1 : x.cardRef > y.cardRef ? 1 : 0));
      for (const c of cards.slice(0, WORKER_INTRODUCTION_CANDIDATE_LIMIT)) {
        out.push({ ...head, candidate_ref: c.cardRef, candidate_revision: c.revision, shared_tags: c.sharedTags });
      }
    }
    return out;
  }
);

const mySuggestionRequestRow = t.row('MyIntroductionSuggestionRequestRow', {
  request_id: t.string(), status: t.string(), created_at: t.timestamp(), expires_at: t.timestamp(),
});

/**
 * The caller's own most recent suggestion request, so the app can say "looking" (open, before expires_at) or
 * "nothing right now" (done without a new suggestion). Status only: never why, or how many people were considered.
 */
export const my_introduction_suggestion_request = spacetimedb.view(
  { name: 'my_introduction_suggestion_request', public: true }, t.array(mySuggestionRequestRow),
  ctx => {
    let latest;
    for (const r of ctx.db.introduction_suggestion_request.viewer.filter(ctx.sender)) {
      if (!latest || r.created_at.microsSinceUnixEpoch > latest.created_at.microsSinceUnixEpoch) latest = r;
    }
    return latest ? [{ request_id: latest.request_id, status: latest.status, created_at: latest.created_at, expires_at: latest.expires_at }] : [];
  }
);
