import { t } from 'spacetimedb/server';
import { Timestamp } from 'spacetimedb';
import { DISCLOSURE_PURPOSE, guardApproval, policyErrorCode } from '@kinetic/contracts/policy';
import { spacetimedb } from '../schema';
import { fail } from '../errors';
import { otherMember, requireAccount } from '../guards';
import { newId } from '../ids';
import { fromMs, hex, loadStanding, toMs } from '../policy_state';

/**
 * C3 approval. Authoritative: a direct reducer call gets exactly the same checks as the API.
 * Sender is always ctx.sender; recipient, policy id and expiry come from server state, never args.
 * Guard: accepted pair ∩ caller's assignment to this recipient ∩ confirmed preset (version,
 * categories, expiry, not revoked) ∩ current consent notice ∩ exact previewed payload revision.
 */
export const approve_signal = spacetimedb.reducer(
  {
    pair_id: t.string(),
    support_mode: t.option(t.string()),
    availability: t.option(t.string()),
    payload_revision: t.u32(),
    recipient_policy_version: t.u32(),
    preset_assignment_version: t.u32(),
    consent_version: t.u32(),
    client_request_id: t.string(),
  },
  (ctx, args) => {
    requireAccount(ctx);
    // Idempotent retry (scoped to caller): never re-approve and never resurrect a revoked signal.
    const prior = [...ctx.db.approved_signal.iter()]
      .find(s => s.sender_id.isEqual(ctx.sender) && s.client_request_id === args.client_request_id);
    if (prior) {
      const same = prior.pair_id === args.pair_id && prior.support_mode === args.support_mode &&
        prior.availability === args.availability && prior.consent_version === args.consent_version &&
        prior.recipient_policy_version === args.recipient_policy_version &&
        prior.preset_assignment_version === args.preset_assignment_version;
      if (same) return;
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
      purpose: DISCLOSURE_PURPOSE, support_mode: args.support_mode, availability: args.availability,
      consent_version: args.consent_version, recipient_policy_id: d.recipientPolicyId,
      recipient_policy_version: args.recipient_policy_version,
      preset_assignment_version: args.preset_assignment_version,
      expires_at: new Timestamp(fromMs(d.expiresAtMs)), revoked_at: undefined,
      client_request_id: args.client_request_id,
    });
    ctx.db.disclosure_receipt.insert({
      receipt_id: newId(ctx), signal_id: signalId, sender_id: ctx.sender, recipient_id: recipient,
      categories: d.categories, consent_version: args.consent_version,
      recipient_policy_version: args.recipient_policy_version,
      preset_assignment_version: args.preset_assignment_version, action: 'approved', created_at: ctx.timestamp,
    });
  }
);

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
    for (const n of [...ctx.db.nudge.iter()]) {
      if (n.source_signal_ids.includes(signal_id)) ctx.db.nudge.id.update({ ...n, suppressed: true });
    }
  }
);
