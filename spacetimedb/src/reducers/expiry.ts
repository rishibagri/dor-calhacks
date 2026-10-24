import { spacetimedb, expiry_sweep } from '../schema';
import { CATALOGUE_MAX_SOURCE_AGE_MS } from '@dor/contracts/policy';
import { fail } from '../errors';
import { expiryKey, hex, type ExpiryKind } from '../policy_state';

/**
 * Scheduled every SWEEP_INTERVAL_MICROS (row inserted by init). Views have no clock, so this is what makes
 * expiry and snooze visible to subscribers (bounded stale window = one interval). Reducers that USE a record
 * (commit_nudge, approve_signal) still check expiry against ctx.timestamp themselves; this sweep only narrows
 * what views expose. Internal-only: clients can neither call it nor suppress anything with it.
 */
export const sweep_expired = spacetimedb.reducer(
  { onSchedule: expiry_sweep },
  { sweep: expiry_sweep.rowType },
  ctx => {
    if (!ctx.senderAuth.isInternal) fail('unauthorized', 'scheduler only');
    const now = ctx.timestamp.microsSinceUnixEpoch;
    const mark = (kind: ExpiryKind, id: string, version: number) => {
      const record_key = expiryKey(kind, id, version);
      if (!ctx.db.expired_record.record_key.find(record_key)) {
        ctx.db.expired_record.insert({ record_key, kind, expired_at: ctx.timestamp });
      }
    };

    for (const n of [...ctx.db.nudge.iter()]) {
      if (!n.suppressed && n.expires_at.microsSinceUnixEpoch <= now) {
        ctx.db.nudge.id.update({ ...n, suppressed: true, snoozed_until: undefined });
      } else if (n.snoozed_until && n.snoozed_until.microsSinceUnixEpoch <= now) {
        ctx.db.nudge.id.update({ ...n, snoozed_until: undefined }); // snooze over: visible again
      }
    }
    for (const s of ctx.db.approved_signal.iter()) {
      if (!s.revoked_at && s.expires_at.microsSinceUnixEpoch <= now) mark('signal', s.signal_id, 1);
    }
    for (const p of ctx.db.support_preference.iter()) {
      if (!p.revoked_at && p.expires_at.microsSinceUnixEpoch <= now) mark('preference', p.consent_id, p.consent_version);
    }
    for (const p of ctx.db.discovery_publication.iter()) {
      if (!p.withdrawn_at && p.expires_at.microsSinceUnixEpoch <= now) mark('publication', p.publication_id, p.revision);
    }
    for (const a of ctx.db.area_participation.iter()) {
      if (a.active && a.expires_at.microsSinceUnixEpoch <= now) mark('area', hex(a.owner), a.revision);
    }
    for (const r of [...ctx.db.introduction.iter()]) {
      if (r.expires_at.microsSinceUnixEpoch > now) continue;
      if (r.status === 'pending') ctx.db.introduction.intro_id.update({ ...r, status: 'expired', sender_closed: true });
      else if (r.status === 'declined' && !r.sender_closed) ctx.db.introduction.intro_id.update({ ...r, sender_closed: true });
    }
    for (const i of ctx.db.event_intent.iter()) {
      if (!i.revoked_at && i.expires_at.microsSinceUnixEpoch <= now) mark('intent', i.intent_id, i.version);
    }
    for (const e of ctx.db.catalogue_event.iter()) {
      const fetched = Number(e.fetched_at.microsSinceUnixEpoch / 1000n);
      if (e.starts_at.microsSinceUnixEpoch <= now || now - e.fetched_at.microsSinceUnixEpoch > BigInt(CATALOGUE_MAX_SOURCE_AGE_MS) * 1000n) {
        mark('catalogue', e.event_id, fetched); // started, or our copy is too old to plan on
      }
    }
    for (const a of ctx.db.activity_approval.iter()) {
      if (!a.revoked_at && a.expires_at.microsSinceUnixEpoch <= now) mark('activity', a.approval_id, 1);
    }
    for (const p of ctx.db.recipient_pause.iter()) {
      if (!p.resumed_at && p.expires_at.microsSinceUnixEpoch <= now) mark('pause', p.pause_id, p.version); // restores nothing
    }
    for (const p of [...ctx.db.shared_plan.iter()]) {
      if (p.status === 'pending' && p.expires_at.microsSinceUnixEpoch <= now) ctx.db.shared_plan.plan_id.update({ ...p, status: 'expired' });
    }
    for (const p of [...ctx.db.introduction_proposal.iter()]) {
      if (p.expires_at.microsSinceUnixEpoch <= now) ctx.db.introduction_proposal.proposal_id.delete(p.proposal_id);
    }
  }
);
