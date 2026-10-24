// D047 standing-rule invalidation shared by set/revoke, pause and unlink (CS). The rule table is private and owner-only.
import type { Identity } from 'spacetimedb';
import type { Ctx } from './errors';
import { newId } from './ids';

type RuleRow = NonNullable<ReturnType<Ctx['db']['standing_rule']['rule_id']['find']>>;

/**
 * Revoke the signals approved under `rule` that have not been delivered yet (no nudge uses them), with the same
 * sender-only `revoked` receipt as revoke_signal. Signals already used by a nudge are left alone: delivery happened.
 * Anything still pending then fails every standing check, so nothing can be delivered under the revoked rule.
 */
export function revokeUndeliveredRuleSignals(ctx: Ctx, rule: RuleRow): void {
  const delivered = new Set<string>();
  for (const n of ctx.db.nudge.pair_id.filter(rule.pair_id)) for (const id of n.source_signal_ids) delivered.add(id);
  for (const s of [...ctx.db.approved_signal.pair_id.filter(rule.pair_id)]) {
    if (s.revoked_at || s.rule_id !== rule.rule_id || delivered.has(s.signal_id)) continue;
    ctx.db.approved_signal.signal_id.update({ ...s, revoked_at: ctx.timestamp });
    ctx.db.disclosure_receipt.insert({
      receipt_id: newId(ctx), signal_id: s.signal_id, sender_id: s.sender_id, recipient_id: s.recipient_id,
      categories: [s.support_mode ? 'support_preference' : '', s.availability ? 'coarse_availability' : ''].filter(Boolean),
      consent_version: s.consent_version, recipient_policy_version: s.recipient_policy_version,
      preset_assignment_version: s.preset_assignment_version, action: 'revoked', created_at: ctx.timestamp,
    });
  }
}

/** End one rule: undelivered rule signals die, the row is marked revoked and its version bumped (old signals never match). */
export function revokeRule(ctx: Ctx, rule: RuleRow): void {
  revokeUndeliveredRuleSignals(ctx, rule);
  if (rule.revoked_at) return;
  ctx.db.standing_rule.rule_id.update({ ...rule, revoked_at: ctx.timestamp, version: rule.version + 1, updated_at: ctx.timestamp });
}

/**
 * Pause and unlink: end the rules in a pair in the same transaction. With `owner` only that owner's rule (pause);
 * without it every rule in the pair (unlink). Their signals are already revoked by suppressPairWork, so only the
 * rows change; revokeRule is still called so a rule signal missed there cannot survive.
 */
export function revokeRulesInPair(ctx: Ctx, pairId: string, owner?: Identity): void {
  for (const r of [...ctx.db.standing_rule.pair_id.filter(pairId)]) {
    if (owner && !r.owner.isEqual(owner)) continue;
    revokeRule(ctx, r);
  }
}
