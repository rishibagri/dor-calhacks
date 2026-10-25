import { t } from 'spacetimedb/server';
import { Timestamp } from 'spacetimedb';
import { DISCLOSURE_CONSENT_VERSION, DISCLOSURE_PURPOSE, MAX_NUDGE_DELAY_MINUTES, guardApproval, policyErrorCode } from '@dor/contracts/policy';
import { spacetimedb } from '../schema';
import { fail, type Ctx } from '../errors';
import { otherMember, requireAccount } from '../guards';
import { newId } from '../ids';
import { fromMs, hex, loadStanding, toMs, pauseInForce } from '../policy_state';

/**
 * C3 approval. Authoritative: a direct reducer call gets exactly the same checks as the API.
 * Sender is always ctx.sender; recipient, policy id and expiry come from server state, never args.
 * Guard: accepted pair ∩ effective preset (the assigned one, or the standard default when none is assigned).
 * Fields outside the preset are dropped; the server's current versions are recorded, not the client's.
 */
const approveArgs = {
  pair_id: t.string(),
  support_mode: t.option(t.string()),
  availability: t.option(t.string()),
  payload_revision: t.u32(),
  recipient_policy_version: t.u32(),
  preset_assignment_version: t.u32(),
  consent_version: t.u32(),
  client_request_id: t.string(),
};
type ApproveArgs = {
  pair_id: string; support_mode?: string; availability?: string; payload_revision: number;
  recipient_policy_version: number; preset_assignment_version: number; consent_version: number; client_request_id: string;
};

export const approve_signal = spacetimedb.reducer(approveArgs, (ctx, args) => { approve(ctx, args); });

/**
 * D059: the same approval, delivered no earlier than `delay_minutes` from now (1 to MAX_NUDGE_DELAY_MINUTES). The
 * schedule is written in this transaction, so the worker never sees the signal without its time. Used when the
 * owner's reasoning decides the news needs time to settle (bad news); good news uses approve_signal.
 */
export const approve_signal_delayed = spacetimedb.reducer({ ...approveArgs, delay_minutes: t.u32() }, (ctx, { delay_minutes, ...args }) => {
  if (!Number.isInteger(delay_minutes) || delay_minutes < 1 || delay_minutes > MAX_NUDGE_DELAY_MINUTES) fail('invalid', 'delay_minutes');
  const signalId = approve(ctx, args);
  if (signalId && !ctx.db.signal_schedule.signal_id.find(signalId)) {
    ctx.db.signal_schedule.insert({ signal_id: signalId, deliver_after: new Timestamp(fromMs(toMs(ctx.timestamp) + delay_minutes * 60_000)) });
  }
});

/** Returns the new signal id, or null for an idempotent replay of the same request. */
function approve(ctx: Ctx, args: ApproveArgs): string | null {
    requireAccount(ctx);
    // D041: nothing can be approved for a counterpart the owner is pausing, not even a replayed request.
    // Owner-only refusal: only the owner calls approve_signal, so this reveals nothing to the counterpart.
    if (pauseInForce(ctx.db, ctx.sender, args.pair_id, toMs(ctx.timestamp))) fail('unauthorized', 'recipient_paused');
    // Idempotent retry (scoped to caller): never re-approve and never resurrect a revoked signal.
    const prior = [...ctx.db.approved_signal.sender_id.filter(ctx.sender)].find(s => s.client_request_id === args.client_request_id);
    if (prior) {
      if (prior.pair_id === args.pair_id) return null;
      fail('invalid', 'client_request_id reused');
    }

    const d = guardApproval({
      callerId: hex(ctx.sender), pairId: args.pair_id, supportMode: args.support_mode,
      availability: args.availability, payloadRevision: args.payload_revision,
      recipientPolicyVersion: args.recipient_policy_version, presetAssignmentVersion: args.preset_assignment_version,
      consentVersion: args.consent_version, clientRequestId: args.client_request_id,
    }, { nowMs: toMs(ctx.timestamp), ...loadStanding(ctx.db, ctx.sender, args.pair_id) });
    if (!d.allowed) fail(policyErrorCode(d.reason), d.reason);

    const recipient = otherMember(ctx.db.pair.pair_id.find(args.pair_id)!, ctx.sender)!;
    if (hex(recipient) !== d.recipientId) fail('invalid', 'recipient mismatch'); // unreachable; belt and braces
    const signalId = newId(ctx);
    ctx.db.approved_signal.insert({
      signal_id: signalId, pair_id: args.pair_id, sender_id: ctx.sender, recipient_id: recipient,
      purpose: DISCLOSURE_PURPOSE, support_mode: d.payload.supportMode, availability: d.payload.availability,
      consent_version: DISCLOSURE_CONSENT_VERSION, recipient_policy_id: d.recipientPolicyId,
      recipient_policy_version: d.recipientPolicyVersion,
      preset_assignment_version: d.presetAssignmentVersion,
      expires_at: new Timestamp(fromMs(d.expiresAtMs)), revoked_at: undefined,
      client_request_id: args.client_request_id,
    });
    ctx.db.disclosure_receipt.insert({
      receipt_id: newId(ctx), signal_id: signalId, sender_id: ctx.sender, recipient_id: recipient,
      categories: d.categories, consent_version: DISCLOSURE_CONSENT_VERSION,
      recipient_policy_version: d.recipientPolicyVersion,
      preset_assignment_version: d.presetAssignmentVersion, action: 'approved', created_at: ctx.timestamp,
    });
    return signalId;
}

export const revoke_signal = spacetimedb.reducer(
  { signal_id: t.string() },
  (ctx, { signal_id }) => {
    requireAccount(ctx);
    const s = ctx.db.approved_signal.signal_id.find(signal_id);
    if (!s || !s.sender_id.isEqual(ctx.sender)) fail('not_found', 'signal');
    if (s.revoked_at) return;
    ctx.db.approved_signal.signal_id.update({ ...s, revoked_at: ctx.timestamp });
    ctx.db.disclosure_receipt.insert({
      receipt_id: newId(ctx), signal_id, sender_id: s.sender_id, recipient_id: s.recipient_id,
      categories: [s.support_mode ? 'support_preference' : '', s.availability ? 'coarse_availability' : ''].filter(Boolean),
      consent_version: s.consent_version, recipient_policy_version: s.recipient_policy_version,
      preset_assignment_version: s.preset_assignment_version, action: 'revoked', created_at: ctx.timestamp,
    });
    for (const n of [...ctx.db.nudge.pair_id.filter(s.pair_id)]) {
      if (n.source_signal_ids.includes(signal_id)) ctx.db.nudge.id.update({ ...n, suppressed: true });
    }
  }
);
