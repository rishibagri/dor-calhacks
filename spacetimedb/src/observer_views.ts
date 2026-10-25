/**
 * D053 demo backstage: read-only observer views across all users, empty unless the caller is in observer_identity
 * (module-owner managed, empty by default). Projections are shared state only: ids, enums, times and the public
 * display names users chose. No free-text fields (no nudge-request messages, no intro snapshots beyond names),
 * no journals (never on the server anyway). Plus the owner's own Reasoning decision log and the D061 demo round.
 */
import { t } from 'spacetimedb/server';
import type { Identity } from 'spacetimedb';
import { spacetimedb } from './schema';
import { loadDiscoveryParty, type ReadDb } from './policy_state';

const OBSERVER_LIMIT = 500;
const isObserver = (db: ReadDb, who: Identity): boolean => Boolean(db.observer_identity.identity.find(who));
const newest = <T extends { created_at: { microsSinceUnixEpoch: bigint } }>(rows: T[]) =>
  rows.sort((a, b) => Number(b.created_at.microsSinceUnixEpoch - a.created_at.microsSinceUnixEpoch)).slice(0, OBSERVER_LIMIT);

const decisionRow = t.row('ReasoningDecisionRow', {
  decision_id: t.string(), owner: t.identity(), episode_id: t.string(), pair_id: t.option(t.string()), mode: t.string(),
  action: t.option(t.string()), surface: t.option(t.string()), reasons: t.array(t.string()), rejected: t.array(t.string()),
  reassess_after_minutes: t.option(t.u32()), source: t.string(), outcome: t.string(), created_at: t.timestamp(),
});

/** The caller's own Reasoning decisions. */
export const my_reasoning_decisions = spacetimedb.view(
  { name: 'my_reasoning_decisions', public: true }, t.array(decisionRow),
  ctx => newest([...ctx.db.reasoning_decision.owner.filter(ctx.sender)])
);

export const observer_status = spacetimedb.view(
  { name: 'observer_status', public: true }, t.array(t.row('ObserverStatusRow', { observer: t.bool() })),
  ctx => [{ observer: isObserver(ctx.db, ctx.sender) }]
);

export const observer_accounts = spacetimedb.view(
  { name: 'observer_accounts', public: true },
  t.array(t.row('ObserverAccountRow', { identity: t.identity(), display_name: t.string(), created_at: t.timestamp() })),
  ctx => (isObserver(ctx.db, ctx.sender)
    ? newest([...ctx.db.account.iter()].map(a => ({ identity: a.identity, display_name: a.display_name, created_at: a.created_at }))) : [])
);

export const observer_pairs = spacetimedb.view(
  { name: 'observer_pairs', public: true },
  t.array(t.row('ObserverPairRow', { pair_id: t.string(), member_a: t.identity(), member_b: t.option(t.identity()), status: t.string(), created_at: t.timestamp() })),
  ctx => (isObserver(ctx.db, ctx.sender)
    ? newest([...ctx.db.pair.iter()].map(p => ({ pair_id: p.pair_id, member_a: p.member_a, member_b: p.member_b, status: p.status, created_at: p.created_at }))) : [])
);

export const observer_assignments = spacetimedb.view(
  { name: 'observer_assignments', public: true },
  t.array(t.row('ObserverAssignmentRow', { owner: t.identity(), pair_id: t.string(), preset_kind: t.string(), assignment_version: t.u32() })),
  ctx => (isObserver(ctx.db, ctx.sender)
    ? [...ctx.db.preset_assignment.iter()].slice(0, OBSERVER_LIMIT).map(a => ({ owner: a.owner, pair_id: a.pair_id, preset_kind: a.preset_kind, assignment_version: a.assignment_version })) : [])
);

export const observer_signals = spacetimedb.view(
  { name: 'observer_signals', public: true },
  t.array(t.row('ObserverSignalRow', {
    signal_id: t.string(), pair_id: t.string(), sender_id: t.identity(), recipient_id: t.identity(), support_mode: t.option(t.string()),
    availability: t.option(t.string()), expires_at: t.timestamp(), revoked_at: t.option(t.timestamp()),
  })),
  ctx => (isObserver(ctx.db, ctx.sender)
    ? [...ctx.db.approved_signal.iter()].sort((a, b) => Number(b.expires_at.microsSinceUnixEpoch - a.expires_at.microsSinceUnixEpoch)).slice(0, OBSERVER_LIMIT)
      .map(s => ({ signal_id: s.signal_id, pair_id: s.pair_id, sender_id: s.sender_id, recipient_id: s.recipient_id, support_mode: s.support_mode,
        availability: s.availability, expires_at: s.expires_at, revoked_at: s.revoked_at })) : [])
);

export const observer_nudges = spacetimedb.view(
  { name: 'observer_nudges', public: true },
  t.array(t.row('ObserverNudgeRow', {
    id: t.string(), pair_id: t.string(), recipient_id: t.identity(), template_id: t.string(), created_at: t.timestamp(),
    expires_at: t.timestamp(), dismissed: t.bool(), suppressed: t.bool(),
  })),
  ctx => (isObserver(ctx.db, ctx.sender)
    ? newest([...ctx.db.nudge.iter()].map(n => ({ id: n.id, pair_id: n.pair_id, recipient_id: n.recipient_id, template_id: n.template_id,
      created_at: n.created_at, expires_at: n.expires_at, dismissed: n.dismissed, suppressed: n.suppressed }))) : [])
);

export const observer_delivery = spacetimedb.view(
  { name: 'observer_delivery', public: true },
  t.array(t.row('ObserverDeliveryRow', {
    recipient: t.identity(), pair_id: t.string(), opted_in: t.bool(), quiet_start_minute: t.option(t.u16()),
    quiet_end_minute: t.option(t.u16()), utc_offset_minutes: t.i16(),
  })),
  ctx => (isObserver(ctx.db, ctx.sender)
    ? [...ctx.db.nudge_delivery.iter()].slice(0, OBSERVER_LIMIT).map(d => ({ recipient: d.recipient, pair_id: d.pair_id, opted_in: d.opted_in,
      quiet_start_minute: d.quiet_start_minute, quiet_end_minute: d.quiet_end_minute, utc_offset_minutes: d.utc_offset_minutes })) : [])
);

export const observer_support_preferences = spacetimedb.view(
  { name: 'observer_support_preferences', public: true },
  t.array(t.row('ObserverPreferenceRow', {
    recipient: t.identity(), pair_id: t.string(), support_modes: t.array(t.string()), availability: t.array(t.string()),
    consent_version: t.u32(), expires_at: t.timestamp(), revoked_at: t.option(t.timestamp()),
  })),
  ctx => (isObserver(ctx.db, ctx.sender)
    ? [...ctx.db.support_preference.iter()].slice(0, OBSERVER_LIMIT).map(p => ({ recipient: p.recipient, pair_id: p.pair_id, support_modes: p.support_modes,
      availability: p.availability, consent_version: p.consent_version, expires_at: p.expires_at, revoked_at: p.revoked_at })) : [])
);

export const observer_pauses = spacetimedb.view(
  { name: 'observer_pauses', public: true },
  t.array(t.row('ObserverPauseRow', { owner: t.identity(), pair_id: t.string(), expires_at: t.timestamp(), resumed_at: t.option(t.timestamp()) })),
  ctx => (isObserver(ctx.db, ctx.sender)
    ? [...ctx.db.recipient_pause.iter()].slice(0, OBSERVER_LIMIT).map(p => ({ owner: p.owner, pair_id: p.pair_id, expires_at: p.expires_at, resumed_at: p.resumed_at })) : [])
);

export const observer_introductions = spacetimedb.view(
  { name: 'observer_introductions', public: true },
  t.array(t.row('ObserverIntroductionRow', {
    intro_id: t.string(), sender: t.identity(), recipient: t.identity(), shared_tags: t.array(t.string()), status: t.string(), created_at: t.timestamp(),
  })),
  ctx => (isObserver(ctx.db, ctx.sender)
    ? newest([...ctx.db.introduction.iter()].map(x => ({ intro_id: x.intro_id, sender: x.sender, recipient: x.recipient, shared_tags: x.shared_tags,
      status: x.status, created_at: x.created_at }))) : [])
);

export const observer_nudge_requests = spacetimedb.view(
  { name: 'observer_nudge_requests', public: true },
  t.array(t.row('ObserverNudgeRequestRow', {
    request_id: t.string(), sender: t.identity(), recipient: t.identity(), via: t.identity(), hops: t.u32(), status: t.string(), created_at: t.timestamp(),
  })),
  ctx => (isObserver(ctx.db, ctx.sender)
    ? newest([...ctx.db.nudge_request.iter()].map(r => ({ request_id: r.request_id, sender: r.sender, recipient: r.recipient, via: r.via, hops: r.hops,
      status: r.status, created_at: r.created_at }))) : [])
);

export const observer_reasoning = spacetimedb.view(
  { name: 'observer_reasoning', public: true }, t.array(decisionRow),
  ctx => (isObserver(ctx.db, ctx.sender) ? newest([...ctx.db.reasoning_decision.iter()]) : [])
);

/** D059 timing for the backstage: when each held signal may be delivered (no row = as soon as possible). */
export const observer_signal_schedules = spacetimedb.view(
  { name: 'observer_signal_schedules', public: true },
  t.array(t.row('ObserverScheduleRow', { signal_id: t.string(), deliver_after: t.timestamp() })),
  ctx => (isObserver(ctx.db, ctx.sender)
    ? [...ctx.db.signal_schedule.iter()].slice(0, OBSERVER_LIMIT).map(s => ({ signal_id: s.signal_id, deliver_after: s.deliver_after })) : [])
);

/** D061 demo reset: the starting-board roster and whether each person is currently published in an area. */
export const observer_demo_members = spacetimedb.view(
  { name: 'observer_demo_members', public: true },
  t.array(t.row('ObserverDemoMemberRow', {
    identity: t.identity(), slot: t.string(), operator: t.bool(), published: t.bool(), area_key: t.option(t.string()),
  })),
  ctx => (isObserver(ctx.db, ctx.sender)
    ? [...ctx.db.demo_member.iter()].map(m => {
      const p = loadDiscoveryParty(ctx.db, m.identity);
      const area = p.area?.active && !p.area.expiredMarked ? p.area.areaKey : undefined;
      return { identity: m.identity, slot: m.slot, operator: m.operator, published: Boolean(p.publication && !p.publication.withdrawnAtMs && !p.publication.expiredMarked), area_key: area };
    }) : [])
);

/**
 * D061 demo reset, for a demo member's own phone: the current round. A phone that sees the round change clears its
 * device-only notebook and memory. Empty for everyone outside the demo roster.
 */
export const my_demo_round = spacetimedb.view(
  { name: 'my_demo_round', public: true },
  t.array(t.row('MyDemoRoundRow', { slot: t.string(), operator: t.bool(), round: t.u32(), reset_at: t.option(t.timestamp()) })),
  ctx => {
    const m = ctx.db.demo_member.identity.find(ctx.sender);
    if (!m) return [];
    const r = ctx.db.demo_round.key.find('round');
    return [{ slot: m.slot, operator: m.operator, round: r?.round ?? 0, reset_at: r?.reset_at }];
  }
);
