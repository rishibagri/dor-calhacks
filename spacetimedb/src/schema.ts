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
    snoozed_until: t.option(t.timestamp()),
    suppressed: t.bool(), // set by unlink / reassignment / preset tightening
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
});
