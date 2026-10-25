// PROPOSED C7/C8 events and shared plans (Cyber, CYBER-R3, D039). Same discovery flag. Nothing here books,
// RSVPs, messages or buys anything; a confirmed plan is an in-app agreement between two people only.
import { t } from 'spacetimedb/server';
import { Timestamp, type Identity } from 'spacetimedb';
import {
  applyPlanAction, eventErrorCode, guardActivityApproval, guardCatalogueDetail, guardCatalogueEvent, guardCataloguePlace, guardEventIntent, guardPlanTiming,
  intentStands, revisePlan, validClientRequestId, type EventDenyReason, type PlanRefusal,
} from '@dor/contracts/policy';
import { spacetimedb } from '../schema';
import { fail, type Ctx } from '../errors';
import { requireAcceptedPair, requireAccount, otherMember, isDatabaseInternal } from '../guards';
import { newId } from '../ids';
import { blockedEitherWay, discoveryEnabled, discoveryList, findAssignment, fromMs, hex, toMs } from '../policy_state';
import { consumeRate, requireDiscovery } from '../discovery_effects';
import {
  approvalsStand, basisParticipants, findIntentRow, loadActivityPreset, loadCatalogueEvent, loadIntent, loadPlanCheck,
  toPlanState, type PlanRow,
} from '../event_state';

function refuse(reason: EventDenyReason): never {
  return fail(eventErrorCode(reason), reason);
}
const ts = (ms: number) => new Timestamp(fromMs(ms));
const parseIso = (iso: string): number => {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) fail('invalid', 'invalid_schema');
  return ms;
};
/** Module owner (checked against the owner row, not isInternal, which is never true live), the database itself, or an allow-listed worker. */
function requireIngester(ctx: Ctx): void {
  if (isDatabaseInternal(ctx)) return;
  if (ctx.db.module_owner.key.find('owner')?.owner.isEqual(ctx.sender)) return;
  if (!ctx.db.worker_identity.identity.find(ctx.sender)) fail('unauthorized', 'ingester only');
}
function requireWorker(ctx: Ctx): void {
  if (!ctx.db.worker_identity.identity.find(ctx.sender)) fail('unauthorized', 'worker only');
}

/**
 * Server-side catalogue ingestion (module owner or allow-listed worker). Default-deny normalization: allowlisted
 * topics/areas, sanitized title, safe source link, no venue/organizer/attendee fields. A changed start time or a
 * cancellation makes every plan bound to the old record stale at its next check.
 */
export const upsert_catalogue_event = spacetimedb.reducer(
  {
    event_id: t.string(), title: t.string(), starts_at: t.string(), ends_at: t.option(t.string()), status: t.string(),
    fetched_at: t.string(), topics: t.array(t.string()), format: t.string(), area_key: t.option(t.string()),
    source_url: t.option(t.string()),
  },
  (ctx, a) => {
    requireIngester(ctx);
    const g = guardCatalogueEvent({
      eventId: a.event_id, title: a.title, startsAtMs: parseIso(a.starts_at), endsAtMs: a.ends_at ? parseIso(a.ends_at) : null,
      status: a.status, fetchedAtMs: parseIso(a.fetched_at), topics: a.topics, format: a.format, areaKey: a.area_key ?? null,
      sourceUrl: a.source_url ?? null,
    }, { tags: discoveryList(ctx.db, 'tags'), areas: discoveryList(ctx.db, 'areas'), hosts: discoveryList(ctx.db, 'source_hosts') },
    toMs(ctx.timestamp));
    if (!g.ok) refuse(g.reason);
    const e = g.event;
    const cur = ctx.db.catalogue_event.event_id.find(e.eventId);
    if (cur && toMs(cur.fetched_at) > e.fetchedAtMs) fail('stale', 'older_fetch'); // never roll a record back
    const row = {
      event_id: e.eventId, title: e.title, starts_at: ts(e.startsAtMs), ends_at: e.endsAtMs === null ? undefined : ts(e.endsAtMs),
      status: e.status, fetched_at: ts(e.fetchedAtMs), topics: e.topics, format: e.format, area_key: e.areaKey ?? undefined,
      source_url: e.sourceUrl ?? undefined, updated_at: ctx.timestamp,
    };
    if (cur) ctx.db.catalogue_event.event_id.update(row);
    else ctx.db.catalogue_event.insert(row);
  }
);

/** Server-side place ingestion (D051 proposal): same ingester rule and default-deny normalization as events. */
export const upsert_catalogue_place = spacetimedb.reducer(
  {
    place_id: t.string(), name: t.string(), kind: t.string(), label: t.string(), rating_tenths: t.u32(), review_count: t.u32(),
    area_key: t.string(), source_url: t.option(t.string()), fetched_at: t.string(),
  },
  (ctx, a) => {
    requireIngester(ctx);
    const g = guardCataloguePlace({
      placeId: a.place_id, name: a.name, kind: a.kind, label: a.label, ratingTenths: a.rating_tenths, reviewCount: a.review_count,
      areaKey: a.area_key, sourceUrl: a.source_url ?? null, fetchedAtMs: parseIso(a.fetched_at),
    }, { areas: discoveryList(ctx.db, 'areas'), hosts: discoveryList(ctx.db, 'source_hosts') }, toMs(ctx.timestamp));
    if (!g.ok) fail('invalid', g.reason);
    const p = g.place;
    const cur = ctx.db.catalogue_place.place_id.find(p.placeId);
    if (cur && toMs(cur.fetched_at) > p.fetchedAtMs) fail('stale', 'older_fetch');
    const row = {
      place_id: p.placeId, name: p.name, kind: p.kind, label: p.label, rating_tenths: p.ratingTenths, review_count: p.reviewCount,
      area_key: p.areaKey, source_url: p.sourceUrl ?? undefined, fetched_at: ts(p.fetchedAtMs), updated_at: ctx.timestamp,
    };
    if (cur) ctx.db.catalogue_place.place_id.update(row);
    else ctx.db.catalogue_place.insert(row);
  }
);

/** D057: matching text for an event or place already in the catalogue (same ingester rule and default-deny cleaning). */
export const upsert_catalogue_detail = spacetimedb.reducer(
  { item_id: t.string(), item_kind: t.string(), summary: t.string(), keywords: t.array(t.string()), price_label: t.string(),
    venue: t.string(), fetched_at: t.string() },
  (ctx, a) => {
    requireIngester(ctx);
    const g = guardCatalogueDetail({ itemId: a.item_id, itemKind: a.item_kind, summary: a.summary, keywords: a.keywords,
      priceLabel: a.price_label, venue: a.venue, fetchedAtMs: parseIso(a.fetched_at) }, toMs(ctx.timestamp));
    if (!g.ok) fail('invalid', g.reason);
    const d = g.detail;
    const exists = d.itemKind === 'event' ? ctx.db.catalogue_event.event_id.find(d.itemId) : ctx.db.catalogue_place.place_id.find(d.itemId);
    if (!exists) fail('not_found', 'catalogue item');
    const row = { item_id: d.itemId, item_kind: d.itemKind, summary: d.summary, keywords: d.keywords, price_label: d.priceLabel,
      venue: d.venue, fetched_at: ts(d.fetchedAtMs) };
    if (ctx.db.catalogue_detail.item_id.find(d.itemId)) ctx.db.catalogue_detail.item_id.update(row);
    else ctx.db.catalogue_detail.insert(row);
  }
);

const FEED_KEY_RE = /^[a-z][a-z0-9-]{2,63}$/;
const MAX_RUN_RECORDS = 10_000;

/**
 * Ingester-only run record (CS-R3): one row per configured feed, so the Events page can show "source unavailable"
 * or the age of the last good fetch honestly. A failed run keeps the previous success time.
 */
export const record_catalogue_run = spacetimedb.reducer(
  { feed_key: t.string(), ok: t.bool(), record_count: t.u32() },
  (ctx, { feed_key, ok, record_count }) => {
    requireIngester(ctx);
    if (!FEED_KEY_RE.test(feed_key) || !discoveryList(ctx.db, 'areas').includes(feed_key)) fail('invalid', 'feed_key');
    if (record_count > MAX_RUN_RECORDS) fail('invalid', 'record_count');
    const cur = ctx.db.catalogue_source.feed_key.find(feed_key);
    const row = {
      feed_key, last_attempt_at: ctx.timestamp, last_success_at: ok ? ctx.timestamp : cur?.last_success_at,
      last_status: ok ? 'ok' : 'failed', record_count: ok ? record_count : (cur?.record_count ?? 0),
    };
    if (cur) ctx.db.catalogue_source.feed_key.update(row);
    else ctx.db.catalogue_source.insert(row);
  }
);

/**
 * Explicitly publish (or update) "interested"/"going" for one current catalogue event. Expires with the event.
 * expected_version is optimistic concurrency (0 = first). Every change bumps the version, so plans bound to
 * the old version go stale.
 */
export const publish_event_intent = spacetimedb.reducer(
  { event_id: t.string(), kind: t.string(), expected_version: t.u32() },
  (ctx, { event_id, kind, expected_version }) => {
    requireDiscovery(ctx);
    const g = guardEventIntent(loadCatalogueEvent(ctx.db, event_id), kind, toMs(ctx.timestamp));
    if (!g.ok) refuse(g.reason);
    const cur = findIntentRow(ctx.db, ctx.sender, event_id);
    if ((cur?.version ?? 0) !== expected_version) refuse('stale_revision');
    consumeRate(ctx, 'event_intent');
    const row = { owner: ctx.sender, event_id, kind, version: (cur?.version ?? 0) + 1, expires_at: ts(g.expiresAtMs),
      revoked_at: undefined, updated_at: ctx.timestamp };
    if (cur) ctx.db.event_intent.intent_id.update({ ...cur, ...row });
    else ctx.db.event_intent.insert({ intent_id: newId(ctx), ...row });
  }
);

/** Withdraw an event intent now. Idempotent; allowed even if discovery is disabled. Plans using it go stale. */
export const revoke_event_intent = spacetimedb.reducer(
  { event_id: t.string() },
  (ctx, { event_id }) => {
    requireAccount(ctx);
    const cur = findIntentRow(ctx.db, ctx.sender, event_id);
    if (!cur || cur.revoked_at) return;
    ctx.db.event_intent.intent_id.update({ ...cur, revoked_at: ctx.timestamp, version: cur.version + 1, updated_at: ctx.timestamp });
  }
);

/**
 * C7 item consent for an existing pair (ACTIVITY_CONSENT.md §2): the owner's preset for this pair must include
 * `activity_interest` (off by default), with the versions the owner previewed. Names the counterpart, exact
 * topics, <= 24 h. Idempotent on client_request_id. It never becomes a C3 signal.
 */
export const approve_activity_interest = spacetimedb.reducer(
  {
    pair_id: t.string(), topics: t.array(t.string()), expected_policy_version: t.u32(), expected_assignment_version: t.u32(),
    consent_version: t.u32(), client_request_id: t.string(),
  },
  (ctx, a) => {
    requireAccount(ctx);
    const pair = requireAcceptedPair(ctx, a.pair_id);
    if (!validClientRequestId(a.client_request_id)) fail('invalid', 'client_request_id');
    const prior = [...ctx.db.activity_approval.owner.filter(ctx.sender)].find(r => r.client_request_id === a.client_request_id);
    if (prior) {
      if (prior.pair_id === a.pair_id && JSON.stringify(prior.topics) === JSON.stringify(a.topics)) return;
      fail('invalid', 'request_id_reused');
    }
    const other = otherMember(pair, ctx.sender)!;
    const preset = loadActivityPreset(ctx.db, ctx.sender, a.pair_id);
    const asg = findAssignment(ctx.db, ctx.sender, a.pair_id);
    const g = guardActivityApproval({
      ownerId: hex(ctx.sender), recipientId: asg && asg.recipient.isEqual(other) ? hex(other) : null, pairAccepted: true,
      preset, topics: a.topics, allowedTopics: discoveryList(ctx.db, 'tags'), expectedPolicyVersion: a.expected_policy_version,
      expectedAssignmentVersion: a.expected_assignment_version, consentVersion: a.consent_version, nowMs: toMs(ctx.timestamp),
    });
    if (!g.ok) refuse(g.reason);
    consumeRate(ctx, 'activity_approval');
    ctx.db.activity_approval.insert({
      approval_id: newId(ctx), owner: ctx.sender, recipient: other, pair_id: a.pair_id, topics: g.topics,
      recipient_policy_version: preset!.version, preset_assignment_version: preset!.assignmentVersion,
      consent_version: a.consent_version, client_request_id: a.client_request_id, expires_at: ts(g.expiresAtMs),
      revoked_at: undefined, created_at: ctx.timestamp,
    });
  }
);

/** Owner revokes a C7 approval now. Idempotent. Plans that relied on it fail their next check. */
export const revoke_activity_interest = spacetimedb.reducer(
  { approval_id: t.string() },
  (ctx, { approval_id }) => {
    requireAccount(ctx);
    const r = ctx.db.activity_approval.approval_id.find(approval_id);
    if (!r || !r.owner.isEqual(ctx.sender)) fail('not_found', 'approval');
    if (!r.revoked_at) ctx.db.activity_approval.approval_id.update({ ...r, revoked_at: ctx.timestamp });
  }
);

const DECIDED_BY = ['deterministic', 'agent', 'fixed_template'];
const LIVE = new Set(['pending', 'confirmed']);
const sortPair = (x: Identity, y: Identity): [Identity, Identity] => (hex(x) < hex(y) ? [x, y] : [y, x]);

/**
 * Worker-only commit of a shared-plan proposal (D034). Participants come from the basis (accepted introduction
 * or accepted pair), never from the request. Rechecks, in this transaction: both bound intents for this event,
 * C7 approvals for a pair basis, no block, a fresh scheduled catalogue record, and lead time. Times come from
 * the catalogue, not the worker. Idempotent on plan_id with identical content.
 */
export const commit_plan_proposal = spacetimedb.reducer(
  {
    plan_id: t.string(), basis_kind: t.string(), basis_ref: t.string(), event_id: t.string(),
    intent_ids: t.array(t.string()), intent_versions: t.array(t.u32()), approval_ids: t.array(t.string()),
    expires_at: t.string(), decided_by: t.string(),
  },
  (ctx, a) => {
    requireWorker(ctx);
    requireDiscoveryFlag(ctx);
    if (!validClientRequestId(a.plan_id) || !DECIDED_BY.includes(a.decided_by) || a.intent_ids.length !== 2 ||
      a.intent_versions.length !== 2) refuse('invalid_schema');
    const prior = ctx.db.shared_plan.plan_id.find(a.plan_id);
    if (prior) {
      const same = prior.basis_ref === a.basis_ref && prior.event_id === a.event_id &&
        [prior.intent_a, prior.intent_b].sort().join() === [...a.intent_ids].sort().join();
      if (same) return;
      fail('invalid', 'plan_id reused');
    }
    const people = basisParticipants(ctx.db, a.basis_kind, a.basis_ref);
    if (!people) refuse('basis_not_current');
    const [pa, pb] = sortPair(people[0], people[1]);
    if (blockedEitherWay(ctx.db, pa, pb)) refuse('blocked');
    const nowMs = toMs(ctx.timestamp);
    // Match each bound intent to its owner; both participants exactly once.
    const bound = a.intent_ids.map((id, i) => ({ intent: loadIntent(ctx.db, id), version: a.intent_versions[i]! }));
    const forOwner = (who: Identity) => bound.find(b => b.intent?.ownerId === hex(who));
    const ia = forOwner(pa), ib = forOwner(pb);
    if (!ia || !ib || ia === ib) refuse('intent_not_current');
    for (const [b, who] of [[ia, pa], [ib, pb]] as const) {
      if (!intentStands(b.intent, hex(who), a.event_id, b.version, nowMs)) refuse('intent_not_current');
    }
    const event = loadCatalogueEvent(ctx.db, a.event_id);
    let approvalA: string | undefined, approvalB: string | undefined;
    if (a.basis_kind === 'existing_connection' && a.approval_ids.length > 0) {
      // Optional for existing pairs: both intents already bind the event. Approvals passed must still stand.
      if (a.approval_ids.length !== 2) refuse('invalid_schema');
      const owned = (who: Identity) => a.approval_ids.find(id => ctx.db.activity_approval.approval_id.find(id)?.owner.isEqual(who));
      approvalA = owned(pa); approvalB = owned(pb);
      if (!approvalsStand(ctx.db, a.basis_ref, pa, pb, approvalA, approvalB, event?.topics ?? [], nowMs)) refuse('approval_not_current');
    } else if (a.basis_kind !== 'existing_connection' && a.approval_ids.length !== 0) refuse('invalid_schema');
    const timing = guardPlanTiming(event, Date.parse(a.expires_at), nowMs);
    if (!timing.ok) refuse(timing.reason);
    const dup = [...ctx.db.shared_plan.participant_a.filter(pa)].some(p => p.event_id === a.event_id && LIVE.has(p.status) &&
      p.participant_b.isEqual(pb));
    if (dup) fail('stale', 'already_planned');
    ctx.db.shared_plan.insert({
      plan_id: a.plan_id, revision: 1, basis_kind: a.basis_kind, basis_ref: a.basis_ref, participant_a: pa, participant_b: pb,
      intent_a: ia.intent!.intentId, intent_a_version: ia.version, intent_b: ib.intent!.intentId, intent_b_version: ib.version,
      approval_a: approvalA, approval_b: approvalB, event_id: a.event_id, event_starts_at: ts(timing.eventStartsAtMs),
      source_fetched_at: ctx.db.catalogue_event.event_id.find(a.event_id)!.fetched_at, accepted_a: false, accepted_b: false,
      status: 'pending', closed_by: undefined, decided_by: a.decided_by, created_at: ctx.timestamp, expires_at: ts(timing.expiresAtMs),
    });
  }
);

function requireDiscoveryFlag(ctx: Ctx): void {
  if (!discoveryEnabled(ctx.db)) fail('unavailable', 'disabled');
}

/**
 * Worker-only new revision after the catalogue record changed (e.g. moved start time). Clears both
 * acceptances (D034 revisePlan); only for a live, unconfirmed plan whose intents and basis still hold.
 */
export const revise_plan_proposal = spacetimedb.reducer(
  { plan_id: t.string(), expected_revision: t.u32(), expires_at: t.string() },
  (ctx, a) => {
    requireWorker(ctx);
    requireDiscoveryFlag(ctx);
    const p = ctx.db.shared_plan.plan_id.find(a.plan_id);
    if (!p) fail('not_found', 'plan');
    if (p.revision !== a.expected_revision) refuse('stale_revision');
    const nowMs = toMs(ctx.timestamp);
    const timing = guardPlanTiming(loadCatalogueEvent(ctx.db, p.event_id), Date.parse(a.expires_at), nowMs);
    if (!timing.ok) refuse(timing.reason);
    const moved = { ...p, event_starts_at: ts(timing.eventStartsAtMs) };
    const check = loadPlanCheck(ctx.db, moved, nowMs);
    if (check.blocked || !check.intentsCurrent || !check.eventScheduled) refuse('basis_not_current');
    const next = revisePlan(toPlanState(p), { expiresAtMs: timing.expiresAtMs, eventStartsAtMs: timing.eventStartsAtMs });
    if (!next) fail('stale', 'closed');
    ctx.db.shared_plan.plan_id.update({
      ...moved, revision: next.revision, accepted_a: false, accepted_b: false, expires_at: ts(timing.expiresAtMs),
      source_fetched_at: ctx.db.catalogue_event.event_id.find(p.event_id)!.fetched_at,
    });
  }
);

const PLAN_REFUSAL_CODE: Record<PlanRefusal, 'not_found' | 'stale'> = {
  not_participant: 'not_found', closed: 'stale', expired: 'stale', stale_revision: 'stale', stale_source: 'stale', already_accepted: 'stale',
};

function act(ctx: Ctx, planId: string, action: { kind: 'accept' | 'decline'; revision: number } | { kind: 'cancel' }) {
  requireAccount(ctx); // decline and cancel stay available if discovery is switched off
  const p: PlanRow | undefined = ctx.db.shared_plan.plan_id.find(planId) ?? undefined;
  if (!p || !(p.participant_a.isEqual(ctx.sender) || p.participant_b.isEqual(ctx.sender))) fail('not_found', 'plan');
  const check = loadPlanCheck(ctx.db, p, toMs(ctx.timestamp));
  if (action.kind === 'accept' && !discoveryEnabled(ctx.db)) fail('unavailable', 'disabled');
  const r = applyPlanAction(toPlanState(p), { ...action, actor: hex(ctx.sender) }, check);
  if (!r.ok) fail(PLAN_REFUSAL_CODE[r.reason], r.reason);
  const acc = r.state.acceptedBy;
  ctx.db.shared_plan.plan_id.update({
    ...p, status: r.state.status, accepted_a: acc.includes(hex(p.participant_a)), accepted_b: acc.includes(hex(p.participant_b)),
    closed_by: r.state.status === 'declined' || r.state.status === 'cancelled' ? ctx.sender : p.closed_by,
  });
}

/** Own acceptance or decline of the CURRENT revision. Confirmed only when both accepted while sources hold. */
export const respond_plan = spacetimedb.reducer(
  { plan_id: t.string(), revision: t.u32(), accept: t.bool() },
  (ctx, { plan_id, revision, accept }) => act(ctx, plan_id, { kind: accept ? 'accept' : 'decline', revision })
);

/** Either participant cancels (also a stale plan). */
export const cancel_plan = spacetimedb.reducer(
  { plan_id: t.string() },
  (ctx, { plan_id }) => act(ctx, plan_id, { kind: 'cancel' })
);

