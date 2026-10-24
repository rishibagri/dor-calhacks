// Private tables (public: false is the default and is never overridden here).
// NOTHING in this module stores journal text, quiz answers, or transcripts.
import { schema, table, t } from 'spacetimedb/server';

/** Singleton row recording the publisher (set in `init`); gates auth_config edits. */
export const module_owner = table(
  { name: 'module_owner' },
  { key: t.string().primaryKey(), owner: t.identity() }
);

/** Allow-listed JWT issuers (e.g. the Clerk frontend API URL). Empty = no external caller admitted. */
export const auth_config = table(
  { name: 'auth_config' },
  { issuer: t.string().primaryKey() }
);

/** Allow-listed JWT `aud` values (Cyber, D035). Empty = no external caller admitted (fail closed). */
export const auth_audience = table(
  { name: 'auth_audience' },
  { audience: t.string().primaryKey() }
);

export const account = table(
  { name: 'account' },
  {
    identity: t.identity().primaryKey(),
    display_name: t.string(),
    issuer: t.string(),
    subject: t.string(),
    created_at: t.timestamp(),
  }
);

export const pair = table(
  { name: 'pair' },
  {
    pair_id: t.string().primaryKey(),
    member_a: t.identity(),
    member_b: t.option(t.identity()),
    status: t.string(), // 'pending' | 'accepted' | 'unlinked'
    created_at: t.timestamp(),
  }
);

export const invite = table(
  { name: 'invite' },
  {
    token: t.string().primaryKey(),
    pair_id: t.string(),
    creator: t.identity(),
    expires_at: t.timestamp(),
    used: t.bool(),
  }
);

export const relationship_preset = table(
  { name: 'relationship_preset' },
  {
    preset_id: t.string().primaryKey(),
    owner: t.identity(),
    preset_kind: t.string(), // one row per owner+preset_kind
    allowed_categories: t.array(t.string()),
    version: t.u32(),
    expires_at: t.timestamp(),
    revoked_at: t.option(t.timestamp()),
  }
);

export const preset_assignment = table(
  { name: 'preset_assignment' },
  {
    assignment_id: t.string().primaryKey(),
    owner: t.identity(),
    pair_id: t.string(),
    recipient: t.identity(),
    preset_kind: t.string(),
    assignment_version: t.u32(),
  }
);

/** ApprovedSignal v2 + revoked_at. Written only by the guarded approve_signal reducer (C6 guardApproval). */
export const approved_signal = table(
  { name: 'approved_signal' },
  {
    signal_id: t.string().primaryKey(),
    pair_id: t.string(),
    sender_id: t.identity(),
    recipient_id: t.identity(),
    purpose: t.string(),
    support_mode: t.option(t.string()),
    availability: t.option(t.string()),
    consent_version: t.u32(),
    recipient_policy_id: t.string(),
    recipient_policy_version: t.u32(),
    preset_assignment_version: t.u32(),
    expires_at: t.timestamp(),
    revoked_at: t.option(t.timestamp()),
    client_request_id: t.string(), // sender-scoped idempotency key; replays never resurrect
  }
);

export const nudge = table(
  { name: 'nudge' },
  {
    id: t.string().primaryKey(),
    pair_id: t.string(),
    recipient_id: t.identity(),
    source_signal_ids: t.array(t.string()),
    source_consent_versions: t.array(t.u32()),
    template_id: t.string(),
    created_at: t.timestamp(),
    expires_at: t.timestamp(),
    dismissed: t.bool(),
    snoozed_until: t.option(t.timestamp()), // hidden from my_nudges while set; the expiry sweep clears it when due
    suppressed: t.bool(), // set by unlink / reassignment / preset tightening / opt-out / consent revoke / expiry sweep
    recipient_consent_id: t.string(), // support_preference consent the commit was bound to (D035)
    recipient_consent_version: t.u32(),
  }
);

/**
 * Recipient-owned F5 delivery settings per pair (D017 opt-in default off, D018 quiet hours).
 * No row = never opted in. Written only by the recipient via set_nudge_delivery.
 */
export const nudge_delivery = table(
  { name: 'nudge_delivery' },
  {
    delivery_id: t.string().primaryKey(),
    recipient: t.identity(),
    pair_id: t.string(),
    opted_in: t.bool(),
    quiet_start_minute: t.option(t.u16()),
    quiet_end_minute: t.option(t.u16()),
    utc_offset_minutes: t.i16(),
    updated_at: t.timestamp(),
  }
);

/**
 * C4 RecipientSupportPreferences as stored (D021 #4, D035). Recipient-owned, one row per recipient+pair,
 * written only by set_support_preferences / revoke_support_preferences. Every change bumps consent_version.
 * Never visible to the sender; only the recipient (my_support_preferences) and the worker (worker_support_preferences).
 */
export const support_preference = table(
  { name: 'support_preference' },
  {
    consent_id: t.string().primaryKey(),
    recipient: t.identity(),
    pair_id: t.string(),
    support_modes: t.array(t.string()),
    availability: t.array(t.string()),
    consent_version: t.u32(),
    expires_at: t.timestamp(),
    revoked_at: t.option(t.timestamp()),
    updated_at: t.timestamp(),
  }
);

/**
 * Expiry markers written by the scheduled sweep (views have no clock). A marked record is treated as gone by
 * every view. record_key = `<kind>:<id>:<version>` so a renewed record (new version) is not affected.
 */
export const expired_record = table(
  { name: 'expired_record' },
  { record_key: t.string().primaryKey(), kind: t.string(), expired_at: t.timestamp() }
);

/** Schedule for sweep_expired (interval row inserted by init). */
export const expiry_sweep = table(
  { name: 'expiry_sweep' },
  { scheduled_id: t.u64().primaryKey().autoInc(), scheduled_at: t.scheduleAt() }
);

// ---- C8 discovery (PROPOSED, D031/D035; disabled until the owner sets discovery_config 'enabled') ----

/** Owner-managed discovery configuration: 'enabled' flag, interest-tag and coarse-area allowlists. */
export const discovery_config = table(
  { name: 'discovery_config' },
  { key: t.string().primaryKey(), values: t.array(t.string()) }
);

/** Owner's explicit public-profile publication. Peers only ever see the discovery_cards projection. */
export const discovery_publication = table(
  { name: 'discovery_publication' },
  {
    publication_id: t.string().primaryKey(), // opaque card reference; never an identity
    owner: t.identity(),
    display_name: t.string(),
    interest_tags: t.array(t.string()),
    audience: t.string(),
    notice_version: t.u32(),
    revision: t.u32(),
    expires_at: t.timestamp(),
    withdrawn_at: t.option(t.timestamp()),
    updated_at: t.timestamp(),
  }
);

/** Private coarse-area participation. Only a configured area key; never coordinates or distance. */
export const area_participation = table(
  { name: 'area_participation' },
  {
    owner: t.identity().primaryKey(),
    area_key: t.string(),
    revision: t.u32(),
    expires_at: t.timestamp(),
    active: t.bool(),
  }
);

/** Private blocks. Matching in either direction hides both people from each other. Never shown to the target. */
export const discovery_block = table(
  { name: 'discovery_block' },
  { block_id: t.string().primaryKey(), blocker: t.identity(), blocked: t.identity(), created_at: t.timestamp() }
);

/**
 * C8 introduction requests (CYBER-R2). Human-triggered by the sender; only the recipient accepts or declines.
 * Accepting is an in-app connection only: no pair, preset, signal, contact detail or message is created.
 */
export const introduction = table(
  { name: 'introduction' },
  {
    intro_id: t.string().primaryKey(),
    sender: t.identity(),
    recipient: t.identity(),
    client_request_id: t.string(), // sender-scoped idempotency key
    sender_revision: t.u32(), // sender publication revision the request was made from
    sender_name: t.string(), // public name snapshot the recipient was shown
    recipient_name: t.option(t.string()), // snapshot shown to the sender only after acceptance
    shared_tags: t.array(t.string()), // published overlap at request time (the "reason to connect")
    status: t.string(), // pending | accepted | declined | cancelled | expired | ended
    sender_closed: t.bool(), // lapsed for the sender's view (a decline is never shown as such)
    created_at: t.timestamp(),
    expires_at: t.timestamp(),
    responded_at: t.option(t.timestamp()),
  }
);

/** Worker-committed AI introduction suggestions (D033), visible to the viewer alone. Never sent to the candidate. */
export const introduction_proposal = table(
  { name: 'introduction_proposal' },
  {
    proposal_id: t.string().primaryKey(),
    viewer: t.identity(),
    candidate: t.identity(),
    candidate_ref: t.string(),
    viewer_revision: t.u32(),
    candidate_revision: t.u32(),
    reason_code: t.string(),
    shared_tags: t.array(t.string()),
    opener_id: t.string(),
    decided_by: t.string(),
    created_at: t.timestamp(),
    expires_at: t.timestamp(),
  }
);

/** Private moderation records. No view exposes them; the target is never told. Coarse reason code only. */
export const discovery_report = table(
  { name: 'discovery_report' },
  { report_id: t.string().primaryKey(), reporter: t.identity(), target: t.identity(), reason: t.string(), created_at: t.timestamp() }
);

/** Per-caller fixed-window counters for repeat-probe and spam limits. Private; key = `<action>:<identity hex>`. */
export const rate_window = table(
  { name: 'rate_window' },
  { limit_key: t.string().primaryKey(), window_start: t.timestamp(), count: t.u32() }
);

/** Allow-listed coordination worker identities (module-owner managed). Workers have no account and cannot approve. */
export const worker_identity = table(
  { name: 'worker_identity' },
  { identity: t.identity().primaryKey() }
);

export const disclosure_receipt = table(
  { name: 'disclosure_receipt' },
  {
    receipt_id: t.string().primaryKey(),
    signal_id: t.string(),
    sender_id: t.identity(),
    recipient_id: t.identity(),
    categories: t.array(t.string()),
    consent_version: t.u32(),
    recipient_policy_version: t.u32(),
    preset_assignment_version: t.u32(),
    action: t.string(), // approved | used | revoked | suppressed
    created_at: t.timestamp(),
  }
);

export const spacetimedb = schema({
  module_owner,
  auth_config,
  account,
  pair,
  invite,
  relationship_preset,
  preset_assignment,
  approved_signal,
  nudge,
  disclosure_receipt,
  nudge_delivery,
  worker_identity,
  auth_audience,
  support_preference,
  expired_record,
  expiry_sweep,
  discovery_config,
  discovery_publication,
  area_participation,
  discovery_block,
  introduction,
  introduction_proposal,
  discovery_report,
  rate_window,
});
