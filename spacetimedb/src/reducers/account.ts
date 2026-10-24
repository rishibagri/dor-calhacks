import { t } from 'spacetimedb/server';
import { spacetimedb } from '../schema';
import { fail, type Ctx } from '../errors';
import { requireAuthenticated } from '../guards';
import { MAX_DISPLAY_NAME } from '../constants';

function claims(ctx: Ctx): { issuer: string; subject: string } {
  const jwt = ctx.senderAuth.jwt;
  return jwt ? { issuer: jwt.issuer, subject: jwt.subject } : { issuer: 'internal', subject: 'internal' };
}

export const register_account = spacetimedb.reducer(
  { display_name: t.string() },
  (ctx, { display_name }) => {
    requireAuthenticated(ctx);
    const name = display_name.trim();
    if (name.length === 0 || name.length > MAX_DISPLAY_NAME) fail('invalid', 'display_name length');
    const existing = ctx.db.account.identity.find(ctx.sender);
    if (existing) {
      ctx.db.account.identity.update({ ...existing, display_name: name });
      return;
    }
    ctx.db.account.insert({ identity: ctx.sender, display_name: name, ...claims(ctx), created_at: ctx.timestamp });
  }
);
