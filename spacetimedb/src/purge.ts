// Test-account cleanup shared by admin_purge_account (D057) and demo_reset (D061).
import type { Identity } from 'spacetimedb';
import type { Ctx } from './errors';

/** Every table that can hold a user's rows (config, catalogue, demo and scheduler tables excluded). */
export const USER_TABLES = ['account', 'pair', 'pair_member', 'invite', 'relationship_preset', 'preset_assignment', 'approved_signal', 'nudge',
  'nudge_delivery', 'support_preference', 'discovery_publication', 'area_participation', 'discovery_page', 'discovery_block', 'introduction',
  'introduction_proposal', 'introduction_suggestion_request', 'discovery_report', 'rate_window', 'event_intent', 'activity_approval',
  'shared_plan', 'recipient_pause', 'standing_consent', 'standing_approval', 'observer_identity', 'reasoning_decision', 'disclosure_receipt',
  'profile_detail', 'nudge_request', 'signal_hook', 'signal_schedule'] as const;
export type UserTable = (typeof USER_TABLES)[number];

/**
 * Permanently delete the targets' rows from `tables`, plus everything scoped to pairs, signals or introductions they took
 * part in (so the other member's side of those pairs goes too). Returns per-table counts (no identities or content).
 */
export function purgeLinked(ctx: Ctx, targets: readonly Identity[], tables: readonly UserTable[] = USER_TABLES): Record<string, number> {
  const db = ctx.db as unknown as Record<string, { iter(): Iterable<Record<string, unknown>>; delete(row: unknown): boolean }>;
  const hexes = new Set(targets.map(t => t.toHexString()));
  // Row values may not share the Identity class instance, so compare by hex string.
  const isTarget = (v: unknown): boolean => Array.isArray(v) ? v.some(isTarget)
    : typeof (v as { toHexString?: unknown } | null)?.toHexString === 'function' && hexes.has((v as Identity).toHexString());
  const pairs = new Set([...ctx.db.pair.iter()].filter(p => isTarget(p.member_a) || isTarget(p.member_b)).map(p => p.pair_id));
  const signals = new Set([...ctx.db.approved_signal.iter()].filter(s => isTarget(s.sender_id) || isTarget(s.recipient_id) || pairs.has(s.pair_id))
    .map(s => s.signal_id));
  const intros = new Set([...ctx.db.introduction.iter()].filter(x => isTarget(x.sender) || isTarget(x.recipient)).map(x => x.intro_id));
  const linked = (row: Record<string, unknown>): boolean =>
    Object.values(row).some(isTarget) ||
    (typeof row.pair_id === 'string' && pairs.has(row.pair_id)) ||
    (typeof row.signal_id === 'string' && signals.has(row.signal_id)) ||
    (typeof row.intro_id === 'string' && intros.has(row.intro_id)) ||
    (typeof row.basis_ref === 'string' && (pairs.has(row.basis_ref) || intros.has(row.basis_ref))) ||
    (Array.isArray(row.source_signal_ids) && row.source_signal_ids.some(id => typeof id === 'string' && signals.has(id))) ||
    // rate_window keys are `<action>:<identity hex>`
    (typeof row.limit_key === 'string' && hexes.has(row.limit_key.slice(row.limit_key.lastIndexOf(':') + 1)));
  const counts: Record<string, number> = {};
  for (const name of tables) {
    const table = db[name];
    if (!table) continue;
    for (const row of [...table.iter()]) if (linked(row) && table.delete(row)) counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
}
