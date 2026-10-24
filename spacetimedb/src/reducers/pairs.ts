import { t } from 'spacetimedb/server';
import { Timestamp } from 'spacetimedb';
import { spacetimedb } from '../schema';
import { fail, type Ctx } from '../errors';
import { isMember, requireAccount, requireMemberPair } from '../guards';
import { newId, newToken } from '../ids';
import { INVITE_TTL_MICROS } from '../constants';
import { suppressPairWork } from '../suppress';

export const create_pair_invite = spacetimedb.reducer(ctx => {
  requireAccount(ctx);
  const pairId = newId(ctx);
  ctx.db.pair.insert({
    pair_id: pairId, member_a: ctx.sender, member_b: undefined,
    status: 'pending', created_at: ctx.timestamp,
  });
  ctx.db.invite.insert({
    token: newToken(ctx), pair_id: pairId, creator: ctx.sender, used: false,
    expires_at: new Timestamp(ctx.timestamp.microsSinceUnixEpoch + INVITE_TTL_MICROS),
  });
});

function alreadyPaired(ctx: Ctx, a: Ctx['sender'], b: Ctx['sender']): boolean {
  for (const p of ctx.db.pair.iter()) {
    if (p.status === 'unlinked' || !p.member_b) continue;
    if (isMember(p, a) && isMember(p, b)) return true;
  }
  return false;
}

export const accept_pair_invite = spacetimedb.reducer(
  { invite_token: t.string() },
  (ctx, { invite_token }) => {
    requireAccount(ctx);
    const inv = ctx.db.invite.token.find(invite_token);
    if (!inv) fail('not_found', 'invite');
    if (inv.used) fail('invalid', 'invite already used');
    if (inv.expires_at.microsSinceUnixEpoch <= ctx.timestamp.microsSinceUnixEpoch) {
      fail('invalid', 'invite expired');
    }
    if (inv.creator.isEqual(ctx.sender)) fail('invalid', 'cannot accept your own invite');
    const p = ctx.db.pair.pair_id.find(inv.pair_id);
    if (!p || p.status !== 'pending') fail('invalid', 'pair no longer pending');
    if (alreadyPaired(ctx, inv.creator, ctx.sender)) fail('invalid', 'already paired');
    ctx.db.invite.token.update({ ...inv, used: true });
    ctx.db.pair.pair_id.update({ ...p, member_b: ctx.sender, status: 'accepted' });
  }
);

export const unlink_pair = spacetimedb.reducer(
  { pair_id: t.string() },
  (ctx, { pair_id }) => {
    requireAccount(ctx);
    const p = requireMemberPair(ctx, pair_id);
    if (p.status === 'unlinked') fail('invalid', 'already unlinked');
    ctx.db.pair.pair_id.update({ ...p, status: 'unlinked' });
    for (const inv of [...ctx.db.invite.iter()]) {
      if (inv.pair_id === pair_id && !inv.used) ctx.db.invite.token.update({ ...inv, used: true });
    }
    for (const a of [...ctx.db.preset_assignment.iter()]) {
      if (a.pair_id === pair_id) ctx.db.preset_assignment.assignment_id.delete(a.assignment_id);
    }
    suppressPairWork(ctx, pair_id);
  }
);
