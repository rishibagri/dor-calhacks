import { t } from 'spacetimedb/server';
import { spacetimedb } from '../schema';
import { fail } from '../errors';
import { requireAccount } from '../guards';
import { newId } from '../ids';

/**
 * PLACEHOLDER: no bypass. Signal approval stays disabled until Cyber's policy guard
 * (recipient policy / assignment / payload revision checks) exists. approved_signal stays empty.
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
  () => {
    fail('unavailable', 'policy guard pending (Cyber)');
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
