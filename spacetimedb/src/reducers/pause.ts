// D041 durable recipient pause (Cyber, README Core 2 "Temporary boundaries are respected").
// Owner-only, person-specific, reason-free. Invisible to the counterpart and to everyone else.
import { t } from 'spacetimedb/server';
import { Timestamp } from 'spacetimedb';
import { guardPauseRequest } from '@dor/contracts/policy';
import { spacetimedb } from '../schema';
import { fail, type Ctx } from '../errors';
import { requireAccount, requireMemberPair } from '../guards';
import { newId } from '../ids';
import { findPauseRow, fromMs, hex, pauseInForce, toMs } from '../policy_state';
import { suppressPairWork } from '../suppress';

/**
 * What a pause kills, in the same transaction: every standing approval the owner made in this pair (revoked, with
 * sender-only `suppressed` receipts) and every nudge derived from them, plus the owner's C7 activity approvals in the
 * pair. Revocation is permanent, so neither resume nor expiry nor any retry can make pre-pause work usable again.
 */
function invalidateOwnerWork(ctx: Ctx, pairId: string): void {
  suppressPairWork(ctx, pairId, ctx.sender);
  for (const a of [...ctx.db.activity_approval.owner.filter(ctx.sender)]) {
    if (a.pair_id === pairId && !a.revoked_at) ctx.db.activity_approval.approval_id.update({ ...a, revoked_at: ctx.timestamp });
  }
}

/**
 * Pause sharing with the other member of one accepted pair until `expires_at` (15 min to 30 days; the owner sees
 * the end time). Setting it again extends or shortens it. `expected_version` is the owner's current pause version
 * (0 for none). Never selects anyone else. Non-members get not_found, the same as any pair they are not in.
 */
export const pause_recipient = spacetimedb.reducer(
  { pair_id: t.string(), expires_at: t.string(), expected_version: t.u32() },
  (ctx, { pair_id, expires_at, expected_version }) => {
    requireAccount(ctx);
    const p = requireMemberPair(ctx, pair_id);
    const nowMs = toMs(ctx.timestamp);
    const g = guardPauseRequest({
      callerId: hex(ctx.sender),
      pair: { pairId: p.pair_id, memberA: hex(p.member_a), memberB: p.member_b ? hex(p.member_b) : null, status: p.status },
      expiresAtMs: Date.parse(expires_at), nowMs,
    });
    if (!g.ok) fail(g.reason === 'not_participant' ? 'not_found' : 'invalid', g.reason === 'not_participant' ? 'pair' : g.reason);
    const cur = findPauseRow(ctx.db, ctx.sender, pair_id);
    if ((cur?.version ?? 0) !== expected_version) fail('stale', 'pause version changed');
    const target = p.member_a.isEqual(ctx.sender) ? p.member_b! : p.member_a;
    const row = {
      owner: ctx.sender, pair_id, target, version: (cur?.version ?? 0) + 1, expires_at: new Timestamp(fromMs(g.expiresAtMs)),
      resumed_at: undefined, updated_at: ctx.timestamp,
    };
    if (cur) ctx.db.recipient_pause.pause_id.update({ ...cur, ...row });
    else ctx.db.recipient_pause.insert({ pause_id: newId(ctx), created_at: ctx.timestamp, ...row });
    invalidateOwnerWork(ctx, pair_id);
  }
);

/**
 * End the owner's pause early. Restores nothing: anything new needs a fresh preview and approval. Idempotent for an
 * already-ended pause; a caller with no pause on that pair gets not_found.
 */
export const resume_recipient = spacetimedb.reducer(
  { pair_id: t.string(), expected_version: t.u32() },
  (ctx, { pair_id, expected_version }) => {
    requireAccount(ctx);
    const cur = findPauseRow(ctx.db, ctx.sender, pair_id);
    if (!cur) fail('not_found', 'pause');
    if (cur.version !== expected_version) fail('stale', 'pause version changed');
    if (!pauseInForce(ctx.db, ctx.sender, pair_id, toMs(ctx.timestamp))) return;
    ctx.db.recipient_pause.pause_id.update({ ...cur, resumed_at: ctx.timestamp, version: cur.version + 1, updated_at: ctx.timestamp });
  }
);
