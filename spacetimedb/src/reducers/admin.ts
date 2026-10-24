import { t } from 'spacetimedb/server';
import { spacetimedb } from '../schema';
import { fail, type Ctx } from '../errors';

/** Records the publisher as module owner. Issuers are added later via set_auth_issuer. */
export const init = spacetimedb.init(ctx => {
  ctx.db.module_owner.insert({ key: 'owner', owner: ctx.sender });
});

function requireOwner(ctx: Ctx): void {
  const row = ctx.db.module_owner.key.find('owner');
  const ok = row ? row.owner.isEqual(ctx.sender) : ctx.senderAuth.isInternal;
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
