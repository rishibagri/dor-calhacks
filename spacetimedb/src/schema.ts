// Private tables (public: false is the default and is never overridden here).
// Profile details and onboarding answers (profile_detail, D045) are stored; journal text and transcripts never are.
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
    member_a: t.identity().index('btree'),
    member_b: t.option(t.identity()),
    status: t.string(), // 'pending' | 'accepted' | 'unlinked'
    created_at: t.timestamp(),
  }
);

/**
 * Membership lookup for `pair` (option columns cannot be indexed): one row per (pair, member), written by
 * create_pair_invite (member_a) and accept_pair_invite (member_b). `pair` stays the authority for status.
 */
export const pair_member = table(
  { name: 'pair_member' },
  { key: t.string().primaryKey(), pair_id: t.string(), member: t.identity().index('btree') }
);

export const invite = table(
  { name: 'invite' },
  {
    token: t.string().primaryKey(),
    pair_id: t.string().index('btree'),
    creator: t.identity().index('btree'),
    expires_at: t.timestamp(),
    used: t.bool(),
  }
);

export const relationship_preset = table(
  { name: 'relationship_preset' },
  {
    preset_id: t.string().primaryKey(),
    owner: t.identity().index('btree'),
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
    owner: t.identity().index('btree'),
    pair_id: t.string().index('btree'),
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
    pair_id: t.string().index('btree'),
    sender_id: t.identity().index('btree'),
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
    pair_id: t.string().index('btree'),
    recipient_id: t.identity().index('btree'),
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
 * Recipient-owned F5 delivery settings per pair (D050 accepted-pair default on; persisted opt-out wins; D018 quiet hours).
 * No row = never opted in. Written only by the recipient via set_nudge_delivery.
 */
export const nudge_delivery = table(
  { name: 'nudge_delivery' },
  {
    delivery_id: t.string().primaryKey(),
    recipient: t.identity().index('btree'),
    pair_id: t.string().index('btree'),
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
    recipient: t.identity().index('btree'),
    pair_id: t.string().index('btree'),
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
    owner: t.identity().index('btree'), // one row per owner; indexed so lookups never scan every profile
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
    area_key: t.string().index('btree'), // discovery_cards reads only the viewer's area
    revision: t.u32(),
    expires_at: t.timestamp(),
    active: t.bool(),
  }
);

/**
 * The caller's own discovery page position (CS-R2): discovery_cards returns at most DISCOVERY_CARD_LIMIT cards in
 * card-ref order after `after_ref`. Views take no arguments, so paging is this per-viewer row. '' = first page.
 */
export const discovery_page = table(
  { name: 'discovery_page' },
  { owner: t.identity().primaryKey(), after_ref: t.string() }
);

/** Private blocks. Matching in either direction hides both people from each other. Never shown to the target. */
export const discovery_block = table(
  { name: 'discovery_block' },
  {
    block_id: t.string().primaryKey(), blocker: t.identity().index('btree'), blocked: t.identity().index('btree'),
    created_at: t.timestamp(),
  }
);

/**
 * C8 introduction requests (CYBER-R2). Human-triggered by the sender; only the recipient accepts or declines.
 * Accepting is an in-app connection only: no pair, preset, signal, contact detail or message is created.
 */
export const introduction = table(
  { name: 'introduction' },
  {
    intro_id: t.string().primaryKey(),
    sender: t.identity().index('btree'),
    recipient: t.identity().index('btree'),
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
    viewer: t.identity().index('btree'),
    candidate: t.identity().index('btree'),
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

/**
 * Viewer-initiated requests for one AI introduction suggestion (D048, PROPOSED; AI). The worker sees open requests
 * only through worker_introduction_requests and closes each one; nobody else sees them, and no candidate is told.
 */
export const introduction_suggestion_request = table(
  { name: 'introduction_suggestion_request' },
  {
    request_id: t.string().primaryKey(),
    viewer: t.identity().index('btree'),
    client_request_id: t.string(), // viewer-scoped idempotency key
    viewer_revision: t.u32(), // publication revision the request was made from
    status: t.string().index('btree'), // open | done
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

/**
 * Catalogue ingestion runs (CS-R3), one row per configured feed. Written only by the ingester, after each run.
 * Lets the Events page tell "no events" from "source unavailable or stale". No source text, no personal data.
 */
export const catalogue_source = table(
  { name: 'catalogue_source' },
  {
    feed_key: t.string().primaryKey(), // configured feed (area key), never device-derived
    last_attempt_at: t.timestamp(),
    last_success_at: t.option(t.timestamp()),
    last_status: t.string(), // ok | failed
    record_count: t.u32(),
  }
);

/**
 * Public catalogue records (C7, D039). Written only by the module owner or an allow-listed worker (the
 * ingester); public, untrusted source data, never permission. No venue, organizer or attendee fields.
 */
export const catalogue_event = table(
  { name: 'catalogue_event' },
  {
    event_id: t.string().primaryKey(),
    title: t.string(), // sanitized display text, never fed to a model
    starts_at: t.timestamp(),
    ends_at: t.option(t.timestamp()),
    status: t.string(), // scheduled | cancelled | unknown
    fetched_at: t.timestamp(),
    topics: t.array(t.string()),
    format: t.string(), // in_person | online
    area_key: t.option(t.string()), // configured coarse area for in-person events
    source_url: t.option(t.string()), // safeCatalogueUrl output only
    updated_at: t.timestamp(),
  }
);

/**
 * Public catalogue place (D051 proposal): a well-reviewed place near a launch area (food, coffee, ...) from the
 * developer-configured Google Maps source. Written only by the ingester; never joined to a person; no reviews,
 * reviewer names, contacts, hours or coordinates.
 */
export const catalogue_place = table(
  { name: 'catalogue_place' },
  {
    place_id: t.string().primaryKey(),
    name: t.string(), // sanitized display text, never fed to a model
    kind: t.string(), // PLACE_KINDS
    label: t.string(), // the source's category text, display only
    rating_tenths: t.u32(),
    review_count: t.u32(),
    area_key: t.string(),
    source_url: t.option(t.string()), // safeCatalogueUrl output only
    fetched_at: t.timestamp(),
    updated_at: t.timestamp(),
  }
);

/**
 * Catalogue detail (D057): matching text for one catalogue event or place from the same scrape (summary, keyword slugs,
 * price label, public venue name). Ingester-written, public, untrusted; never a person, review, contact or coordinate.
 */
export const catalogue_detail = table(
  { name: 'catalogue_detail' },
  {
    item_id: t.string().primaryKey(),
    item_kind: t.string(), // event | place
    summary: t.string(),
    keywords: t.array(t.string()),
    price_label: t.string(),
    venue: t.string(),
    fetched_at: t.timestamp(),
  }
);

/** One person's explicit event intent (C8). Ends with the event; never inferred from scraping or calendars. */
export const event_intent = table(
  { name: 'event_intent' },
  {
    intent_id: t.string().primaryKey(),
    owner: t.identity().index('btree'),
    event_id: t.string().index('btree'),
    kind: t.string(), // interested | going
    version: t.u32(),
    expires_at: t.timestamp(),
    revoked_at: t.option(t.timestamp()),
    updated_at: t.timestamp(),
  }
);

/** C7 item consent for an existing pair: named recipient, exact topics, bound preset versions, <= 24 h. Immutable. */
export const activity_approval = table(
  { name: 'activity_approval' },
  {
    approval_id: t.string().primaryKey(),
    owner: t.identity().index('btree'),
    recipient: t.identity(),
    pair_id: t.string(),
    topics: t.array(t.string()),
    recipient_policy_version: t.u32(),
    preset_assignment_version: t.u32(),
    consent_version: t.u32(),
    client_request_id: t.string(),
    expires_at: t.timestamp(),
    revoked_at: t.option(t.timestamp()),
    created_at: t.timestamp(),
  }
);

/**
 * Shared plan proposals (D034 lifecycle, D039 guards). Worker-committed; each participant accepts their own
 * copy of the current revision. Participants are derived from the basis, never from request fields.
 */
export const shared_plan = table(
  { name: 'shared_plan' },
  {
    plan_id: t.string().primaryKey(),
    revision: t.u32(),
    basis_kind: t.string(), // introduction | existing_connection
    basis_ref: t.string(), // intro_id or pair_id
    participant_a: t.identity().index('btree'),
    participant_b: t.identity().index('btree'),
    intent_a: t.string(),
    intent_a_version: t.u32(),
    intent_b: t.string(),
    intent_b_version: t.u32(),
    approval_a: t.option(t.string()), // C7 approvals (existing_connection only)
    approval_b: t.option(t.string()),
    event_id: t.string(),
    event_starts_at: t.timestamp(),
    source_fetched_at: t.timestamp(),
    accepted_a: t.bool(),
    accepted_b: t.bool(),
    status: t.string(), // pending | confirmed | declined | cancelled | expired | stale
    closed_by: t.option(t.identity()), // who declined/cancelled; shown only to them
    decided_by: t.string(),
    created_at: t.timestamp(),
    expires_at: t.timestamp(),
  }
);

/**
 * D041 durable recipient pause: owner-only, person-specific, reason-free. One row per owner + pair, updated in place.
 * The target is the other pair member, derived server-side. No reason, note, journal or model text exists here.
 * Pausing revokes the owner's standing approvals in the pair (suppressPairWork), so resume/expiry restores nothing.
 */
export const recipient_pause = table(
  { name: 'recipient_pause' },
  {
    pause_id: t.string().primaryKey(),
    owner: t.identity().index('btree'),
    pair_id: t.string(),
    target: t.identity(),
    version: t.u32(),
    expires_at: t.timestamp(),
    resumed_at: t.option(t.timestamp()),
    created_at: t.timestamp(),
    updated_at: t.timestamp(),
  }
);

/**
 * D044 automatic nudges: an owner's explicit standing consent for ONE pair (off unless this row exists and stands).
 * One row per owner + pair, updated in place; every change bumps `version`. Recipient is derived from the pair.
 */
export const standing_consent = table(
  { name: 'standing_consent' },
  {
    rule_id: t.string().primaryKey(),
    owner: t.identity().index('btree'),
    pair_id: t.string(),
    recipient: t.identity(),
    categories: t.array(t.string()),
    recipient_policy_version: t.u32(),
    preset_assignment_version: t.u32(),
    notice_version: t.u32(),
    version: t.u32(),
    expires_at: t.timestamp(),
    revoked_at: t.option(t.timestamp()),
    created_at: t.timestamp(),
    updated_at: t.timestamp(),
  }
);

/** Which approved signals were created under a standing rule (and which rule version). Private; rechecked at use. */
export const standing_approval = table(
  { name: 'standing_approval' },
  { signal_id: t.string().primaryKey(), rule_id: t.string(), rule_version: t.u32() }
);

/** Allow-listed coordination worker identities (module-owner managed). Workers have no account and cannot approve. */
export const worker_identity = table(
  { name: 'worker_identity' },
  { identity: t.identity().primaryKey() }
);

/**
 * Demo backstage observers (D053, demo-only): identities allow-listed by the module owner to read the read-only
 * observer_* views across all users. Empty by default, so every observer view returns nothing.
 */
export const observer_identity = table(
  { name: 'observer_identity' },
  { identity: t.identity().primaryKey() }
);

/**
 * Content-free Reasoning decision records (D052/D053), written by the owner's own device after the deterministic core
 * decides. Codes only: no journal text, names, summaries or model output. Visible to the owner and to observers.
 */
export const reasoning_decision = table(
  { name: 'reasoning_decision' },
  {
    decision_id: t.string().primaryKey(),
    owner: t.identity().index('btree'),
    episode_id: t.string(),
    pair_id: t.option(t.string()),
    mode: t.string(), // act | ask | defer | abstain
    action: t.option(t.string()),
    surface: t.option(t.string()),
    reasons: t.array(t.string()),
    rejected: t.array(t.string()), // "ACTION:reason" codes
    reassess_after_minutes: t.option(t.u32()),
    source: t.string(), // model | fallback
    outcome: t.string(), // sent | asked | owner_prompt | deferred | quiet | failed
    created_at: t.timestamp(),
  }
);

export const disclosure_receipt = table(
  { name: 'disclosure_receipt' },
  {
    receipt_id: t.string().primaryKey(),
    signal_id: t.string(),
    sender_id: t.identity().index('btree'),
    recipient_id: t.identity(),
    categories: t.array(t.string()),
    consent_version: t.u32(),
    recipient_policy_version: t.u32(),
    preset_assignment_version: t.u32(),
    action: t.string(), // approved | used | revoked | suppressed
    created_at: t.timestamp(),
  }
);

/**
 * Network (D045): the owner's own richer profile. Shown to people they are linked with through my_connection_profiles,
 * and its tags/area feed friend-of-friend matching. Written only by the owner (set_profile_detail).
 */
export const profile_detail = table(
  { name: 'profile_detail' },
  {
    owner: t.identity().primaryKey(),
    bio: t.string(),
    home_area: t.string().index('btree'), // coarse area key the owner is settling into
    availability: t.string(),
    up_to: t.string(), // what they're up to lately
    interests: t.array(t.string()),
    answers: t.array(t.string()), // onboarding answers as "question_id:answer_id"
    updated_at: t.timestamp(),
  }
);

/**
 * Network (D045): a nudge to someone a friend knows nearby. The recipient sees the sender and the mutual friend;
 * the sender sees the recipient's name and details only after acceptance. Accepting links the two as a pair.
 */
export const nudge_request = table(
  { name: 'nudge_request' },
  {
    request_id: t.string().primaryKey(),
    sender: t.identity().index('btree'),
    recipient: t.identity().index('btree'),
    via: t.identity(), // the mutual friend closest to the sender
    via_name: t.string(),
    hops: t.u32(),
    shared_tags: t.array(t.string()),
    message: t.string(),
    status: t.string(), // pending | accepted | declined | cancelled
    pair_id: t.option(t.string()),
    created_at: t.timestamp(),
    responded_at: t.option(t.timestamp()),
  }
);

/**
 * D056: what the recipient's nudge suggests talking about ("ask how the exam went"). Written by the sender's device
 * right after approve_signal; shown to the recipient in my_nudges with the nudge built from that signal.
 */
export const signal_hook = table(
  { name: 'signal_hook' },
  {
    signal_id: t.string().primaryKey(),
    sender_id: t.identity().index('btree'),
    hook: t.string(),
    created_at: t.timestamp(),
  }
);

export const spacetimedb = schema({
  module_owner,
  auth_config,
  account,
  pair,
  pair_member,
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
  discovery_page,
  introduction,
  introduction_proposal,
  introduction_suggestion_request,
  discovery_report,
  rate_window,
  catalogue_source,
  catalogue_event,
  catalogue_place,
  event_intent,
  activity_approval,
  shared_plan,
  recipient_pause,
  standing_consent,
  standing_approval,
  profile_detail,
  nudge_request,
  signal_hook,
  observer_identity,
  reasoning_decision,
  catalogue_detail,
});
