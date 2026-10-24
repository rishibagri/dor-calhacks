import type { Identity } from 'spacetimedb';
import { Timestamp } from 'spacetimedb';
import { fail, type Ctx, type AccountRow, type PairRow } from './errors';
import { ACTIVITY_CATEGORY, audienceAllowed } from '@dor/contracts/policy';
import { CATEGORIES, PRESET_KINDS } from './constants';
type Account = AccountRow;
type Pair = PairRow;

/** Scheduled reducers: the in-process harness marks them isInternal; a live host delivers them with no
 * connection and sender == the database's own identity (no client can authenticate as that identity). */
export function isScheduledCall(c: { isInternal: boolean; connectionId: unknown; sender: Identity; databaseIdentity: Identity }): boolean {
  if (c.isInternal) return true;
  return c.connectionId == null && c.sender.isEqual(c.databaseIdentity);
}

/**
 * Caller authentication. Internal callers (module owner / scheduled) are admitted; every
 * external caller must carry a JWT whose issuer is in auth_config (Clerk issuer) AND whose `aud`
 * includes an allow-listed audience (auth_audience; empty = nobody, D035). The audience check stops a
 * token the same Clerk instance minted for another app (same iss/sub ⇒ same Identity) from acting here.
 * Views cannot see claims (ViewCtx has no senderAuth); see src/privacy/README.md known gaps.
 */
export function requireAuthenticated(ctx: Ctx): void {
  const a = ctx.senderAuth;
  if (a.isInternal) return;
  if (!a.hasJWT || !a.jwt) fail('unauthenticated', 'JWT required');
  if (!ctx.db.auth_config.issuer.find(a.jwt.issuer)) {
    fail('unauthenticated', 'issuer not allow-listed');
  }
  if (!audienceAllowed(a.jwt.audience, [...ctx.db.auth_audience.iter()].map(r => r.audience))) {
    fail('unauthenticated', 'audience not allow-listed');
  }
}

export function requireAccount(ctx: Ctx): Account {
  requireAuthenticated(ctx);
  const acct = ctx.db.account.identity.find(ctx.sender);
  if (!acct) fail('unauthorized', 'register_account first');
  return acct;
}

export function isMember(p: Pair, who: Identity): boolean {
  return p.member_a.isEqual(who) || (p.member_b?.isEqual(who) ?? false);
}

export function otherMember(p: Pair, who: Identity): Identity | undefined {
  return p.member_a.isEqual(who) ? p.member_b : p.member_a;
}

/** Non-members get not_found so pair ids cannot be probed. */
export function requireMemberPair(ctx: Ctx, pairId: string): Pair {
  const p = ctx.db.pair.pair_id.find(pairId);
  if (!p || !isMember(p, ctx.sender)) fail('not_found', 'pair');
  return p;
}

export function requireAcceptedPair(ctx: Ctx, pairId: string): Pair {
  const p = requireMemberPair(ctx, pairId);
  if (p.status !== 'accepted') fail('invalid', 'pair is not accepted');
  return p;
}

export function parseKind(kind: string): string {
  if (!(PRESET_KINDS as readonly string[]).includes(kind)) fail('invalid', 'unknown preset_kind');
  return kind;
}

export function parseCategories(cats: string[]): string[] {
  if (new Set(cats).size !== cats.length) fail('invalid', 'duplicate categories');
  for (const c of cats) {
    // ACTIVITY_CATEGORY is preset-only (C7, D039): a preset may allow it, but no C3 signal ever carries it.
    if (!(CATEGORIES as readonly string[]).includes(c) && c !== ACTIVITY_CATEGORY) fail('invalid', `unknown category ${c}`);
  }
  return cats;
}

export function parseFuture(ctx: Ctx, iso: string, what: string): Timestamp {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) fail('invalid', `${what} must be an ISO timestamp`);
  const ts = Timestamp.fromDate(new Date(ms));
  if (ts.microsSinceUnixEpoch <= ctx.timestamp.microsSinceUnixEpoch) fail('invalid', `${what} must be in the future`);
  return ts;
}
