import type { Identity } from 'spacetimedb';
import type { Ctx } from './errors';
import { newId } from './ids';

/**
 * Invalidate queued use for a pair: revoke active signals (receipt 'suppressed') and
 * suppress nudges built from them. With `owner`, only that sender's signals are affected
 * (reassignment / preset tightening); without it, everything on the pair (unlink).
 */
export function suppressPairWork(ctx: Ctx, pairId: string, owner?: Identity): void {
  const affected = new Set<string>();
  for (const s of [...ctx.db.approved_signal.iter()]) {
    if (s.pair_id !== pairId || s.revoked_at) continue;
    if (owner && !s.sender_id.isEqual(owner)) continue;
    affected.add(s.signal_id);
    ctx.db.approved_signal.signal_id.update({ ...s, revoked_at: ctx.timestamp });
    ctx.db.disclosure_receipt.insert({
      receipt_id: newId(ctx), signal_id: s.signal_id, sender_id: s.sender_id,
      recipient_id: s.recipient_id,
      categories: [s.support_mode ? 'support_preference' : '', s.availability ? 'coarse_availability' : '']
        .filter(Boolean),
      consent_version: s.consent_version, recipient_policy_version: s.recipient_policy_version,
      preset_assignment_version: s.preset_assignment_version,
      action: 'suppressed', created_at: ctx.timestamp,
    });
  }
  for (const n of [...ctx.db.nudge.iter()]) {
    if (n.pair_id !== pairId || n.suppressed) continue;
    if (owner && !n.source_signal_ids.some(id => affected.has(id))) continue;
    ctx.db.nudge.id.update({ ...n, suppressed: true });
  }
}
