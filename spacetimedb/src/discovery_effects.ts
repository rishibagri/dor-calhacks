// CYBER-R2 discovery side effects shared by the discovery and introduction reducers: rate windows and the
// cascades that make withdrawal and blocking take effect on introductions and proposals immediately.
import type { Identity } from 'spacetimedb';
import { Timestamp } from 'spacetimedb';
import { discoveryErrorCode, guardRateLimit, type DiscoveryRateAction, type IntroductionState } from '@dor/contracts/policy';
import { fail, type Ctx } from './errors';
import { requireAccount } from './guards';
import { newId } from './ids';
import { discoveryEnabled, fromMs, hex, toMs, type ReadDb } from './policy_state';

export function requireDiscovery(ctx: Ctx): void {
  requireAccount(ctx);
  if (!discoveryEnabled(ctx.db)) fail(discoveryErrorCode('disabled'), 'disabled');
}

/**
 * Counts one successful action in the caller's fixed window, or fails rate_limited. A failed reducer rolls
 * back, so only actions that commit are counted; refused probes are uninformative instead (uniform not_found
 * for refs the caller cannot see, random 128-bit refs).
 */
export function consumeRate(ctx: Ctx, action: DiscoveryRateAction): void {
  const limit_key = `${action}:${hex(ctx.sender)}`;
  const cur = ctx.db.rate_window.limit_key.find(limit_key);
  const g = guardRateLimit(action, cur ? { windowStartMs: toMs(cur.window_start), count: cur.count } : null, toMs(ctx.timestamp));
  if (!g.ok) fail(g.reason === 'rate_limited' ? 'rate_limited' : 'invalid', action);
  const row = { limit_key, window_start: new Timestamp(fromMs(g.next.windowStartMs)), count: g.next.count };
  if (cur) ctx.db.rate_window.limit_key.update(row);
  else ctx.db.rate_window.insert(row);
}

type IntroRow = NonNullable<ReturnType<Ctx['db']['introduction']['intro_id']['find']>>;

export function toIntroductionState(r: IntroRow): IntroductionState {
  return {
    introId: r.intro_id, senderId: hex(r.sender), recipientId: hex(r.recipient), status: r.status as IntroductionState['status'],
    senderRevision: r.sender_revision, createdAtMs: toMs(r.created_at), expiresAtMs: toMs(r.expires_at),
    respondedAtMs: r.responded_at ? toMs(r.responded_at) : null,
  };
}

const between = (r: { sender: Identity; recipient: Identity }, a: Identity, b: Identity) =>
  (r.sender.isEqual(a) && r.recipient.isEqual(b)) || (r.sender.isEqual(b) && r.recipient.isEqual(a));

/** Every introduction the identity is part of (sender or recipient index), each once. */
function introductionsOf(db: ReadDb, who: Identity) {
  const seen = new Set<string>();
  return [...db.introduction.sender.filter(who), ...db.introduction.recipient.filter(who)].filter(r => !seen.has(r.intro_id) && seen.add(r.intro_id));
}

/** Every proposal naming the identity as viewer or candidate, each once. */
function proposalsOf(db: ReadDb, who: Identity) {
  const seen = new Set<string>();
  return [...db.introduction_proposal.viewer.filter(who), ...db.introduction_proposal.candidate.filter(who)]
    .filter(p => !seen.has(p.proposal_id) && seen.add(p.proposal_id));
}

export function introductionsBetween(db: ReadDb, a: Identity, b: Identity): IntroRow[] {
  return [...db.introduction.sender.filter(a), ...db.introduction.sender.filter(b)].filter(r => between(r, a, b));
}

/**
 * Withdrawal (other = undefined) or a block between `who` and `other`: pending requests involving them close
 * for both sides; on a block, accepted introductions between the two end as well. Proposals naming either
 * person as viewer or candidate are deleted. Accepted introductions survive a plain withdrawal.
 */
export function closeDiscoveryLinks(ctx: Ctx, who: Identity, other?: Identity): void {
  for (const r of introductionsOf(ctx.db, who)) {
    const involved = other ? between(r, who, other) : r.sender.isEqual(who) || r.recipient.isEqual(who);
    if (!involved) continue;
    if (r.status === 'pending') {
      ctx.db.introduction.intro_id.update({ ...r, status: 'cancelled', sender_closed: true, responded_at: ctx.timestamp });
    } else if (other && r.status === 'accepted') {
      ctx.db.introduction.intro_id.update({ ...r, status: 'ended', sender_closed: true });
    }
  }
  for (const p of proposalsOf(ctx.db, who)) {
    const involved = other ? between({ sender: p.viewer, recipient: p.candidate }, who, other)
      : p.viewer.isEqual(who) || p.candidate.isEqual(who);
    if (involved) ctx.db.introduction_proposal.proposal_id.delete(p.proposal_id);
  }
}

/** Inserts a block (idempotent) and applies the cascade. Caller has already authorized the target. */
export function applyBlock(ctx: Ctx, target: Identity, alreadyBlocked: boolean): void {
  if (!alreadyBlocked) {
    ctx.db.discovery_block.insert({ block_id: newId(ctx), blocker: ctx.sender, blocked: target, created_at: ctx.timestamp });
  }
  closeDiscoveryLinks(ctx, ctx.sender, target);
}

/**
 * A new publication revision stales what depended on the old one: the owner's pending outgoing requests close
 * (the recipient must not accept a profile they were not shown) and proposals naming the owner are deleted.
 * Incoming requests stay: they were made from the other person's profile.
 */
export function stalePublicationDependents(ctx: Ctx, owner: Identity): void {
  for (const r of [...ctx.db.introduction.sender.filter(owner)]) {
    if (r.status === 'pending') {
      ctx.db.introduction.intro_id.update({ ...r, status: 'cancelled', sender_closed: true, responded_at: ctx.timestamp });
    }
  }
  for (const p of proposalsOf(ctx.db, owner)) {
    if (p.viewer.isEqual(owner) || p.candidate.isEqual(owner)) ctx.db.introduction_proposal.proposal_id.delete(p.proposal_id);
  }
}
