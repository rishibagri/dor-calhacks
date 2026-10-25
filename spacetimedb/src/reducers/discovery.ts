// C8 discovery transitions (Cyber guards, D031/D035). On by default; the module owner can switch it off with
// discovery_config 'enabled' = ['false']. CS owns the UI and may rename once reviewed.
import { t } from 'spacetimedb/server';
import { Timestamp } from 'spacetimedb';
import {
  AREA_MAX_LIFETIME_MS, discoveryErrorCode, guardAreaKey, guardDiscoveryVisibility, guardPublicationDraft,
} from '@dor/contracts/policy';
import { spacetimedb } from '../schema';
import { fail } from '../errors';
import { requireAccount } from '../guards';
import { newId } from '../ids';
import {
  blockedEitherWay, discoveryEnabled, discoveryList, findPublicationRow, fromMs, loadDiscoveryParty, toMs,
} from '../policy_state';
import { applyBlock, closeDiscoveryLinks, consumeRate, requireDiscovery, stalePublicationDependents } from '../discovery_effects';


/**
 * Publish (or update) the caller's own public profile from the exact preview they confirmed. expected_revision
 * is optimistic concurrency (0 = first publish). Re-publishing after withdrawal is a new, explicit consent
 * with a new revision; nothing else ever un-withdraws.
 */
export const publish_discovery_profile = spacetimedb.reducer(
  {
    display_name: t.string(),
    interest_tags: t.array(t.string()),
    audience: t.string(),
    notice_version: t.u32(),
    expires_at: t.string(),
    expected_revision: t.u32(),
  },
  (ctx, args) => {
    requireDiscovery(ctx);
    const nowMs = toMs(ctx.timestamp);
    const d = guardPublicationDraft({
      displayName: args.display_name, interestTags: args.interest_tags, audience: args.audience,
      noticeVersion: args.notice_version, expiresAtMs: Date.parse(args.expires_at),
    }, discoveryList(ctx.db, 'tags'), nowMs);
    if (!d.ok) fail(discoveryErrorCode(d.reason), d.reason);
    const cur = findPublicationRow(ctx.db, ctx.sender);
    if ((cur?.revision ?? 0) !== args.expected_revision) fail('stale', 'stale_revision');
    consumeRate(ctx, 'publish');
    const row = {
      owner: ctx.sender, display_name: d.draft.displayName, interest_tags: d.draft.interestTags,
      audience: d.draft.audience, notice_version: d.draft.noticeVersion, revision: (cur?.revision ?? 0) + 1,
      expires_at: new Timestamp(fromMs(d.draft.expiresAtMs)), withdrawn_at: undefined, updated_at: ctx.timestamp,
    };
    if (cur) ctx.db.discovery_publication.publication_id.update({ ...cur, ...row });
    else ctx.db.discovery_publication.insert({ publication_id: newId(ctx), ...row });
    if (cur) stalePublicationDependents(ctx, ctx.sender);
  }
);

/** Withdraw immediately: removes the caller from every discovery_cards view. Idempotent; allowed even when disabled. */
export const withdraw_discovery_profile = spacetimedb.reducer({}, ctx => {
  requireAccount(ctx);
  const cur = findPublicationRow(ctx.db, ctx.sender);
  if (cur && !cur.withdrawn_at) {
    ctx.db.discovery_publication.publication_id.update({ ...cur, withdrawn_at: ctx.timestamp, updated_at: ctx.timestamp });
  }
  const area = ctx.db.area_participation.owner.find(ctx.sender);
  if (area?.active) ctx.db.area_participation.owner.update({ ...area, active: false });
  closeDiscoveryLinks(ctx, ctx.sender); // pending requests and AI proposals involving the caller end now
});

/**
 * One-time, explicitly renewed area participation: a configured coarse area key only (the device coarsens and
 * discards its sample). Expires after AREA_MAX_LIFETIME_MS; no background refresh.
 */
export const set_discovery_area = spacetimedb.reducer(
  { area_key: t.string() },
  (ctx, { area_key }) => {
    requireDiscovery(ctx);
    const g = guardAreaKey(area_key, discoveryList(ctx.db, 'areas'));
    if (!g.ok) fail(discoveryErrorCode(g.reason), g.reason);
    consumeRate(ctx, 'area_change'); // bounds area hopping to map who is where
    const cur = ctx.db.area_participation.owner.find(ctx.sender);
    const row = {
      owner: ctx.sender, area_key: g.areaKey, revision: (cur?.revision ?? 0) + 1, active: true,
      expires_at: new Timestamp(ctx.timestamp.microsSinceUnixEpoch + fromMs(AREA_MAX_LIFETIME_MS)),
    };
    if (cur) ctx.db.area_participation.owner.update(row);
    else ctx.db.area_participation.insert(row);
  }
);

/**
 * Block by card reference. Takes effect in both directions immediately and is never shown to the target.
 * A ref the caller cannot currently see gets not_found (no probing of other people's cards). Idempotent.
 */
export const block_discovery_user = spacetimedb.reducer(
  { card_ref: t.string() },
  (ctx, { card_ref }) => {
    requireAccount(ctx); // blocking stays available even if discovery is later disabled
    const target = ctx.db.discovery_publication.publication_id.find(card_ref);
    if (!target || target.owner.isEqual(ctx.sender)) fail('not_found', 'card');
    if (blockedEitherWay(ctx.db, ctx.sender, target.owner)) return;
    const seen = guardDiscoveryVisibility(loadDiscoveryParty(ctx.db, ctx.sender), loadDiscoveryParty(ctx.db, target.owner),
      false, discoveryEnabled(ctx.db), toMs(ctx.timestamp));
    if (!seen.ok) fail('not_found', 'card');
    consumeRate(ctx, 'block');
    applyBlock(ctx, target.owner, false); // also closes pending/accepted introductions and proposals between them
  }
);

/** Card refs are opaque newId() strings; anything else is refused rather than used as a scan bound. */
const MAX_CARD_REF = 128;

/**
 * Caller-only discovery paging (CS-R2): discovery_cards shows cards after `after_ref` in card-ref order.
 * '' returns to the first page. The cursor is the caller's own row and reveals nothing about anyone else.
 */
export const set_discovery_page = spacetimedb.reducer(
  { after_ref: t.string() },
  (ctx, { after_ref }) => {
    requireAccount(ctx);
    if (after_ref.length > MAX_CARD_REF || /[^A-Za-z0-9_-]/.test(after_ref)) fail('invalid', 'after_ref');
    const cur = ctx.db.discovery_page.owner.find(ctx.sender);
    if (cur) ctx.db.discovery_page.owner.update({ owner: ctx.sender, after_ref });
    else ctx.db.discovery_page.insert({ owner: ctx.sender, after_ref });
  }
);
