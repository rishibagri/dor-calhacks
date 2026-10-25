import { t } from 'spacetimedb/server';
import { ScheduleAt, type Identity } from 'spacetimedb';
import { validHostAllowlist, validSlugAllowlist } from '@dor/contracts/policy';
import { spacetimedb } from '../schema';
import { fail, type Ctx } from '../errors';
import { isDatabaseInternal } from '../guards';
import { SWEEP_INTERVAL_MICROS } from '../constants';

/** Records the publisher as module owner and starts the expiry sweep. Issuers/audiences are added later. */
export const init = spacetimedb.init(ctx => {
  ctx.db.module_owner.insert({ key: 'owner', owner: ctx.sender });
  if (ctx.db.expiry_sweep.count() === 0n) {
    ctx.db.expiry_sweep.insert({ scheduled_id: 0n, scheduled_at: ScheduleAt.interval(SWEEP_INTERVAL_MICROS) });
  }
});

function requireOwner(ctx: Ctx): void {
  const row = ctx.db.module_owner.key.find('owner');
  // The owner row is written by init. Without it (never live) only the database itself may act; fail closed otherwise.
  const ok = row ? row.owner.isEqual(ctx.sender) : isDatabaseInternal(ctx);
  if (!ok) fail('unauthorized', 'module owner only');
}

/** Module-owner only: allow-list (or remove) a JWT issuer, e.g. the Clerk frontend API URL. */
export const set_auth_issuer = spacetimedb.reducer(
  { issuer: t.string(), enabled: t.bool() },
  (ctx, { issuer, enabled }) => {
    requireOwner(ctx);
    if (issuer.length === 0 || issuer.length > 256) fail('invalid', 'issuer');
    if (enabled) {
      if (!ctx.db.auth_config.issuer.find(issuer)) ctx.db.auth_config.insert({ issuer });
    } else {
      ctx.db.auth_config.issuer.delete(issuer);
    }
  }
);

/**
 * Module-owner only: allow-list (or remove) the coordination worker's identity. The worker may read
 * worker_* views and call commit_nudge; it has no account, so it cannot approve, revoke or read my_* views.
 */
export const set_worker_identity = spacetimedb.reducer(
  { worker: t.identity(), enabled: t.bool() },
  (ctx, { worker, enabled }) => {
    requireOwner(ctx);
    if (enabled) {
      if (ctx.db.account.identity.find(worker)) fail('invalid', 'worker identity must not be a user account');
      if (!ctx.db.worker_identity.identity.find(worker)) ctx.db.worker_identity.insert({ identity: worker });
    } else {
      ctx.db.worker_identity.identity.delete(worker);
    }
  }
);

/**
 * Module-owner only (D053, demo backstage): allow-list (or remove) an identity that may read the observer_* views.
 * Observers can read every user's shared state, never write it. Keep the list empty outside a supervised demo.
 */
export const set_observer_identity = spacetimedb.reducer(
  { observer: t.identity(), enabled: t.bool() },
  (ctx, { observer, enabled }) => {
    requireOwner(ctx);
    if (enabled) {
      if (!ctx.db.observer_identity.identity.find(observer)) ctx.db.observer_identity.insert({ identity: observer });
    } else {
      ctx.db.observer_identity.identity.delete(observer);
    }
  }
);

// D057 test-account cleanup: every table that can hold a user's rows (config, catalogue and scheduler tables excluded).
const USER_TABLES = ['account', 'pair', 'pair_member', 'invite', 'relationship_preset', 'preset_assignment', 'approved_signal', 'nudge',
  'nudge_delivery', 'support_preference', 'discovery_publication', 'area_participation', 'discovery_page', 'discovery_block', 'introduction',
  'introduction_proposal', 'introduction_suggestion_request', 'discovery_report', 'rate_window', 'event_intent', 'activity_approval',
  'shared_plan', 'recipient_pause', 'standing_consent', 'standing_approval', 'observer_identity', 'reasoning_decision', 'disclosure_receipt',
  'profile_detail', 'nudge_request', 'signal_hook'] as const;

/**
 * Module-owner only (D057, demo reset): permanently delete one identity's rows from every user table, plus everything
 * scoped to pairs, signals or introductions it took part in (so the other member's side of those pairs goes too).
 * Refuses the module owner and allow-listed workers. Irreversible: run only on test accounts after a dry-run list.
 */
export const admin_purge_account = spacetimedb.reducer(
  { target: t.identity() },
  (ctx, { target }) => {
    requireOwner(ctx);
    if (ctx.db.module_owner.key.find('owner')?.owner.isEqual(target)) fail('invalid', 'cannot purge the module owner');
    if (ctx.db.worker_identity.identity.find(target)) fail('invalid', 'cannot purge a worker identity');
    const db = ctx.db as unknown as Record<string, { iter(): Iterable<Record<string, unknown>>; delete(row: unknown): boolean }>;
    const targetHex = target.toHexString();
    // Row values may not share the Identity class instance, so compare by hex string.
    const isTarget = (v: unknown): boolean => Array.isArray(v) ? v.some(isTarget)
      : typeof (v as { toHexString?: unknown } | null)?.toHexString === 'function' && (v as Identity).toHexString() === targetHex;
    const pairs = new Set([...ctx.db.pair.iter()].filter(p => p.member_a.isEqual(target) || (p.member_b?.isEqual(target) ?? false)).map(p => p.pair_id));
    const signals = new Set([...ctx.db.approved_signal.iter()].filter(s => s.sender_id.isEqual(target) || s.recipient_id.isEqual(target) || pairs.has(s.pair_id))
      .map(s => s.signal_id));
    const intros = new Set([...ctx.db.introduction.iter()].filter(x => x.sender.isEqual(target) || x.recipient.isEqual(target)).map(x => x.intro_id));
    const linked = (row: Record<string, unknown>): boolean =>
      Object.values(row).some(isTarget) ||
      (typeof row.pair_id === 'string' && pairs.has(row.pair_id)) ||
      (typeof row.signal_id === 'string' && signals.has(row.signal_id)) ||
      (typeof row.intro_id === 'string' && intros.has(row.intro_id)) ||
      (typeof row.basis_ref === 'string' && (pairs.has(row.basis_ref) || intros.has(row.basis_ref))) ||
      (Array.isArray(row.source_signal_ids) && row.source_signal_ids.some(id => typeof id === 'string' && signals.has(id)));
    const counts: Record<string, number> = {};
    for (const name of USER_TABLES) {
      const table = db[name];
      if (!table) continue;
      for (const row of [...table.iter()]) if (linked(row) && table.delete(row)) counts[name] = (counts[name] ?? 0) + 1;
    }
    console.log(`admin_purge_account: ${JSON.stringify(counts)}`); // counts only, no identities or content
  }
);

/** Module-owner only: allow-list (or remove) a JWT `aud` value, e.g. the Clerk JWT template's audience (D035). */
export const set_auth_audience = spacetimedb.reducer(
  { audience: t.string(), enabled: t.bool() },
  (ctx, { audience, enabled }) => {
    requireOwner(ctx);
    if (audience.length === 0 || audience.length > 256) fail('invalid', 'audience');
    if (enabled) {
      if (!ctx.db.auth_audience.audience.find(audience)) ctx.db.auth_audience.insert({ audience });
    } else {
      ctx.db.auth_audience.audience.delete(audience);
    }
  }
);

/**
 * Module-owner only: discovery configuration. `enabled` takes ['true'], ['false'] or [] (default on; only
 * ['false'] turns it off); `tags` and `areas` take developer allowlists of short slugs.
 */
export const set_discovery_config = spacetimedb.reducer(
  { key: t.string(), values: t.array(t.string()) },
  (ctx, { key, values }) => {
    requireOwner(ctx);
    if (key === 'enabled') {
      if (!(values.length === 0 || (values.length === 1 && (values[0] === 'true' || values[0] === 'false')))) fail('invalid', 'enabled');
    } else if (key === 'tags' || key === 'areas') {
      if (!validSlugAllowlist(values, key === 'tags' ? 'tag' : 'area')) fail('invalid', 'allowlist');
    } else if (key === 'source_hosts') {
      if (!validHostAllowlist(values)) fail('invalid', 'allowlist'); // catalogue source links (D039)
    } else {
      fail('invalid', 'unknown key');
    }
    const row = { key, values };
    if (ctx.db.discovery_config.key.find(key)) ctx.db.discovery_config.key.update(row);
    else ctx.db.discovery_config.insert(row);
  }
);
