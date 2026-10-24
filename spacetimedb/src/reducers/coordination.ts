import { t } from 'spacetimedb/server';
import { Timestamp } from 'spacetimedb';
import { categoriesOf, guardNudgeCommit, policyErrorCode, type NudgeSource } from '@kinetic/contracts/policy';
import { spacetimedb } from '../schema';
import { fail, type Ctx } from '../errors';
import { newId } from '../ids';
import { fromMs, loadDeliveryGate, loadStanding, toMs, toStoredSignal } from '../policy_state';

function requireWorker(ctx: Ctx): void {
  if (!ctx.db.worker_identity.identity.find(ctx.sender)) fail('unauthorized', 'worker only');
}

/**
 * F7 (FLOWS.md): the worker proposes, this reducer decides. Re-checks every source signal against
 * CURRENT authoritative state (revocation during generation, stale preset/assignment, expiry, recipient),
 * requires the template to be templateForSignal of an approved source (availability-only ⇒ nothing),
 * then the F5 gate (opt-in, cooldown, quiet hours). Idempotent on nudge_id: a replay is a no-op and never
 * resurrects a suppressed nudge; a different payload under the same id is rejected.
 */
export const commit_nudge = spacetimedb.reducer(
  {
    nudge_id: t.string(),
    pair_id: t.string(),
    template_id: t.string(),
    source_signal_ids: t.array(t.string()),
    source_consent_versions: t.array(t.u32()),
  },
  (ctx, args) => {
    requireWorker(ctx);
    if (args.nudge_id.length === 0 || args.nudge_id.length > 128) fail('invalid', 'invalid_schema');
    const prior = ctx.db.nudge.id.find(args.nudge_id);
    if (prior) {
      const same = prior.pair_id === args.pair_id && prior.template_id === args.template_id &&
        prior.source_signal_ids.join('\u001f') === args.source_signal_ids.join('\u001f') &&
        prior.source_consent_versions.join(',') === args.source_consent_versions.join(',');
      if (same) return;
      fail('invalid', 'nudge_id reused');
    }
    const first = args.source_signal_ids.length > 0 ? ctx.db.approved_signal.signal_id.find(args.source_signal_ids[0]) : undefined;
    if (!first) fail('unauthorized', 'no_consent');
    const recipient = first.recipient_id;

    const sources = new Map<string, NudgeSource>();
    for (const id of args.source_signal_ids) {
      const s = ctx.db.approved_signal.signal_id.find(id);
      if (s) sources.set(id, { signal: toStoredSignal(s), snapshot: { nowMs: toMs(ctx.timestamp), ...loadStanding(ctx.db, s.sender_id, s.pair_id) } });
    }
    const d = guardNudgeCommit({
      pairId: args.pair_id, recipientId: recipient.toHexString(), templateId: args.template_id,
      sourceSignalIds: args.source_signal_ids, sourceConsentVersions: args.source_consent_versions,
    }, sources, loadDeliveryGate(ctx.db, recipient, args.pair_id, toMs(ctx.timestamp)));
    if (!d.allowed) fail(policyErrorCode(d.reason), d.reason);

    ctx.db.nudge.insert({
      id: args.nudge_id, pair_id: args.pair_id, recipient_id: recipient,
      source_signal_ids: args.source_signal_ids, source_consent_versions: args.source_consent_versions,
      template_id: args.template_id, created_at: ctx.timestamp, expires_at: new Timestamp(fromMs(d.expiresAtMs)),
      dismissed: false, snoozed_until: undefined, suppressed: false,
    });
    for (const id of args.source_signal_ids) {
      const s = ctx.db.approved_signal.signal_id.find(id)!;
      ctx.db.disclosure_receipt.insert({
        receipt_id: newId(ctx), signal_id: id, sender_id: s.sender_id, recipient_id: s.recipient_id,
        categories: categoriesOf({ supportMode: s.support_mode, availability: s.availability }), consent_version: s.consent_version,
        recipient_policy_version: s.recipient_policy_version, preset_assignment_version: s.preset_assignment_version,
        action: 'used', created_at: ctx.timestamp,
      });
    }
  }
);
