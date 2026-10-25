// D061 demo reset (demo-only): one call puts the team's four demo accounts back on a known starting board so every live
// scenario can be shown again to the next judge. Everything is real data afterwards; nothing here fakes a nudge,
// introduction or plan. Refuses everyone unless the module owner filled demo_member.
import { t } from 'spacetimedb/server';
import { Timestamp, type Identity } from 'spacetimedb';
import {
  ACTIVITY_CATEGORY, AREA_MAX_LIFETIME_MS, DISCOVERY_NOTICE_VERSION, PREFERENCE_MAX_LIFETIME_MS, PUBLICATION_MAX_LIFETIME_MS,
  AVAILABILITIES, SHARING_CATEGORIES, SUPPORT_MODES, guardAreaKey, guardPublicationDraft,
} from '@dor/contracts/policy';
import { spacetimedb } from '../schema';
import { fail, type Ctx } from '../errors';
import { requireAccount, requireOwner } from '../guards';
import { newId } from '../ids';
import { discoveryEnabled, discoveryList, fromMs, hex, toMs } from '../policy_state';
import { USER_TABLES, purgeLinked } from '../purge';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEMO_SLOTS = ['adam', 'rishi', 'nimisha', 'sumedh'] as const;
type Slot = (typeof DEMO_SLOTS)[number];
const DEMO_AREA = 'berkeley-campus';

/**
 * The starting board. Adam–Rishi and Rishi–Sumedh are linked, so Adam and Sumedh are friends of friends through Rishi.
 * Nimisha is new in town and linked with nobody, so she is "nearby" for everyone (and everyone is nearby for her).
 * Overlapping interests give every card a reason to connect.
 */
const DEMO_PAIRS: readonly (readonly [Slot, Slot])[] = [['adam', 'rishi'], ['rishi', 'sumedh']];
const DEMO_TAGS: Record<Slot, string[]> = {
  adam: ['coffee', 'climbing', 'live-music', 'hiking'],
  rishi: ['coffee', 'live-music', 'board-games', 'film'],
  nimisha: ['coffee', 'live-music', 'books', 'hiking'],
  sumedh: ['climbing', 'coffee', 'running', 'photography'],
};
const DEMO_UTC_OFFSET = -420; // Pacific daylight time; no quiet hours are set, so this only labels times

// Kept on reset: the account itself, its observer access and its profile text (the area and interests are reset).
const RESET_TABLES = USER_TABLES.filter(n => n !== 'account' && n !== 'observer_identity' && n !== 'profile_detail');

/** Module-owner only: put (or remove) a demo account in a starting-board slot. One account per slot. */
export const set_demo_member = spacetimedb.reducer(
  { member: t.identity(), slot: t.string(), operator: t.bool(), enabled: t.bool() },
  (ctx, { member, slot, operator, enabled }) => {
    requireOwner(ctx);
    if (!enabled) { ctx.db.demo_member.identity.delete(member); return; }
    if (!(DEMO_SLOTS as readonly string[]).includes(slot)) fail('invalid', 'unknown slot');
    if (!ctx.db.account.identity.find(member)) fail('not_found', 'demo member needs an account');
    for (const m of [...ctx.db.demo_member.iter()]) if (m.slot === slot && !m.identity.isEqual(member)) ctx.db.demo_member.delete(m);
    const row = { identity: member, slot, operator };
    if (ctx.db.demo_member.identity.find(member)) ctx.db.demo_member.identity.update(row);
    else ctx.db.demo_member.insert(row);
  }
);

/**
 * Demo operator only: purge every signal, nudge, introduction, friend-of-friend request, plan, intent, pause, block and
 * decision involving the demo accounts, then rebuild the starting board in the same transaction:
 *  - DEMO_PAIRS accepted, each member with a current friend preset assigned, standard support styles, notes on and no
 *    quiet hours (the team agreed to these settings for their own demo accounts);
 *  - all four published in DEMO_AREA with DEMO_TAGS (profile area and interests too).
 * Bumps demo_round so phones clear their device-only notebook and memory. Catalogue rows are untouched.
 */
export const demo_reset = spacetimedb.reducer(ctx => {
  requireAccount(ctx);
  if (!ctx.db.demo_member.identity.find(ctx.sender)?.operator) fail('unauthorized', 'demo operator only');
  if (!discoveryEnabled(ctx.db)) fail('invalid', 'discovery is off');
  const bySlot = new Map<Slot, Identity>();
  for (const m of ctx.db.demo_member.iter()) bySlot.set(m.slot as Slot, m.identity);
  const missing = DEMO_SLOTS.filter(s => !bySlot.has(s) || !ctx.db.account.identity.find(bySlot.get(s)!));
  if (missing.length) fail('invalid', `demo roster incomplete: ${missing.join(', ')}`);
  const roster = DEMO_SLOTS.map(s => bySlot.get(s)!);

  const counts = purgeLinked(ctx, roster, RESET_TABLES);
  // Area expiry markers are keyed by owner and revision, so a fresh revision 1 must not inherit an old marker.
  const areaKeys = new Set(roster.map(r => `area:${hex(r)}:`));
  for (const m of [...ctx.db.expired_record.iter()]) {
    if (m.kind === 'area' && areaKeys.has(m.record_key.slice(0, m.record_key.lastIndexOf(':') + 1))) ctx.db.expired_record.delete(m);
  }

  const nowMs = toMs(ctx.timestamp);
  const at = (ms: number) => new Timestamp(fromMs(nowMs + ms));
  const area = guardAreaKey(DEMO_AREA, discoveryList(ctx.db, 'areas'));
  if (!area.ok) fail('invalid', `demo area: ${area.reason}`);
  const allowedTags = discoveryList(ctx.db, 'tags');
  for (const slot of DEMO_SLOTS) seedPerson(ctx, bySlot.get(slot)!, DEMO_TAGS[slot].filter(t => allowedTags.includes(t)), area.areaKey, nowMs, at);
  for (const [x, y] of DEMO_PAIRS) seedPair(ctx, bySlot.get(x)!, bySlot.get(y)!, at);

  const cur = ctx.db.demo_round.key.find('round');
  const row = { key: 'round', round: (cur?.round ?? 0) + 1, reset_at: ctx.timestamp };
  if (cur) ctx.db.demo_round.key.update(row);
  else ctx.db.demo_round.insert(row);
  console.log(`demo_reset round ${row.round}: ${JSON.stringify(counts)}`); // counts only
});

function seedPerson(ctx: Ctx, who: Identity, tags: string[], areaKey: string, nowMs: number, at: (ms: number) => Timestamp): void {
  const name = ctx.db.account.identity.find(who)!.display_name;
  const d = guardPublicationDraft({ displayName: name, interestTags: tags, audience: 'area_discoverers', noticeVersion: DISCOVERY_NOTICE_VERSION,
    expiresAtMs: nowMs + PUBLICATION_MAX_LIFETIME_MS - 60_000 }, discoveryList(ctx.db, 'tags'), nowMs);
  if (!d.ok) fail('invalid', `demo publication: ${d.reason}`);
  ctx.db.discovery_publication.insert({
    publication_id: newId(ctx), owner: who, display_name: d.draft.displayName, interest_tags: d.draft.interestTags, audience: d.draft.audience,
    notice_version: d.draft.noticeVersion, revision: 1, expires_at: new Timestamp(fromMs(d.draft.expiresAtMs)), withdrawn_at: undefined,
    updated_at: ctx.timestamp,
  });
  ctx.db.area_participation.insert({ owner: who, area_key: areaKey, revision: 1, active: true, expires_at: at(AREA_MAX_LIFETIME_MS) });
  const detail = ctx.db.profile_detail.owner.find(who);
  const profile = {
    owner: who, bio: detail?.bio ?? '', home_area: areaKey, availability: detail?.availability ?? '', up_to: detail?.up_to ?? '',
    interests: d.draft.interestTags, answers: [], updated_at: ctx.timestamp,
  };
  if (detail) ctx.db.profile_detail.owner.update(profile);
  else ctx.db.profile_detail.insert(profile);
  ctx.db.relationship_preset.insert({
    preset_id: newId(ctx), owner: who, preset_kind: 'friend', allowed_categories: [...SHARING_CATEGORIES, ACTIVITY_CATEGORY],
    version: 1, expires_at: at(180 * DAY_MS), revoked_at: undefined,
  });
}

function seedPair(ctx: Ctx, a: Identity, b: Identity, at: (ms: number) => Timestamp): void {
  const pairId = newId(ctx);
  ctx.db.pair.insert({ pair_id: pairId, member_a: a, member_b: b, status: 'accepted', created_at: ctx.timestamp });
  for (const [owner, other] of [[a, b], [b, a]] as const) {
    ctx.db.pair_member.insert({ key: `${pairId}:${hex(owner)}`, pair_id: pairId, member: owner });
    ctx.db.preset_assignment.insert({ assignment_id: newId(ctx), owner, pair_id: pairId, recipient: other, preset_kind: 'friend', assignment_version: 1 });
    ctx.db.support_preference.insert({
      consent_id: newId(ctx), recipient: owner, pair_id: pairId, support_modes: [...SUPPORT_MODES], availability: [...AVAILABILITIES],
      consent_version: 1, expires_at: at(PREFERENCE_MAX_LIFETIME_MS - DAY_MS), revoked_at: undefined, updated_at: ctx.timestamp,
    });
    ctx.db.nudge_delivery.insert({
      delivery_id: newId(ctx), recipient: owner, pair_id: pairId, opted_in: true, quiet_start_minute: undefined, quiet_end_minute: undefined,
      utc_offset_minutes: DEMO_UTC_OFFSET, updated_at: ctx.timestamp,
    });
  }
}
