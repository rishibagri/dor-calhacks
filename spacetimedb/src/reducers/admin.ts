import { t } from 'spacetimedb/server';
import { ScheduleAt } from 'spacetimedb';
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
 * Module-owner only: C8 discovery configuration (PROPOSED). `enabled` takes ['true'] or [] (default off until
 * the C8 review is ACKed); `tags` and `areas` take developer allowlists of short slugs.
 */
export const set_discovery_config = spacetimedb.reducer(
  { key: t.string(), values: t.array(t.string()) },
  (ctx, { key, values }) => {
    requireOwner(ctx);
    if (key === 'enabled') {
      if (!(values.length === 0 || (values.length === 1 && values[0] === 'true'))) fail('invalid', 'enabled');
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
