// D044 side effect shared by revoke_standing_consent, rule replacement and the D041 pause.
import type { Ctx } from './errors';
import { findStandingRow } from './policy_state';

/**
 * End a rule now and kill everything it approved that hasn't been used: revoke those signals and suppress their nudges.
 * Revocation is permanent, so re-enabling a rule later never revives old approvals. Used by revoke and by D041 pause.
 */
export function endStandingRule(ctx: Ctx, owner: Ctx['sender'], pairId: string): void {
  const r = findStandingRow(ctx.db, owner, pairId);
  if (!r || r.revoked_at) return;
  ctx.db.standing_consent.rule_id.update({ ...r, revoked_at: ctx.timestamp, version: r.version + 1, updated_at: ctx.timestamp });
  const killed = new Set<string>();
  for (const link of [...ctx.db.standing_approval.iter()]) {
    if (link.rule_id !== r.rule_id) continue;
    const s = ctx.db.approved_signal.signal_id.find(link.signal_id);
    if (!s || s.revoked_at) continue;
    ctx.db.approved_signal.signal_id.update({ ...s, revoked_at: ctx.timestamp });
    killed.add(s.signal_id);
  }
  for (const n of [...ctx.db.nudge.pair_id.filter(pairId)]) {
    if (!n.suppressed && n.source_signal_ids.some(id => killed.has(id))) ctx.db.nudge.id.update({ ...n, suppressed: true });
  }
}

