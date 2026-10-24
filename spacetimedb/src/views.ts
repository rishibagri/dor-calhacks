import { t } from 'spacetimedb/server';
import type { Identity } from 'spacetimedb';
import { guardSignalStanding } from '@kinetic/contracts/policy';
import { spacetimedb, account, approved_signal, nudge, disclosure_receipt } from './schema';
import { hex, loadStanding, toStoredSignal, type ReadDb } from './policy_state';

// Every view filters strictly by ctx.sender. Tables stay private; only these are public.
// Views project minimal client-facing rows (column names are the CS client seam,
// see src/lib/spacetime/mappers.ts). Nothing here reads another user's preset.

const pairViewRow = t.row('PairViewRow', {
  pair_id: t.string(),
  counterpart_identity: t.option(t.identity()),
  counterpart_display_name: t.option(t.string()),
  status: t.string(),
  created_at: t.timestamp(),
});

const inviteViewRow = t.row('InviteViewRow', {
  invite_token: t.string(),
  pair_id: t.string(),
  expires_at: t.timestamp(),
});

const presetViewRow = t.row('PresetViewRow', {
  policy_id: t.string(),
  owner_id: t.identity(),
  preset_kind: t.string(),
  allowed_categories: t.array(t.string()),
  version: t.u32(),
  expires_at: t.timestamp(),
  revoked_at: t.option(t.timestamp()),
});

const assignmentViewRow = t.row('AssignmentViewRow', {
  owner_id: t.identity(),
  recipient_id: t.identity(),
  pair_id: t.string(),
  preset_id: t.string(),
  preset_kind: t.string(),
  assignment_version: t.u32(),
});

export const my_account = spacetimedb.view(
  { name: 'my_account', public: true }, t.option(account.rowType),
  ctx => ctx.db.account.identity.find(ctx.sender) ?? undefined
);

export const my_pairs = spacetimedb.view(
  { name: 'my_pairs', public: true }, t.array(pairViewRow),
  ctx => [...ctx.db.pair.iter()]
    .filter(p => p.member_a.isEqual(ctx.sender) || (p.member_b?.isEqual(ctx.sender) ?? false))
    .map(p => {
      const other = p.member_a.isEqual(ctx.sender) ? p.member_b : p.member_a;
      const otherAccount = other ? ctx.db.account.identity.find(other) : undefined;
      return {
        pair_id: p.pair_id,
        counterpart_identity: other ?? undefined,
        counterpart_display_name: otherAccount?.display_name ?? undefined,
        status: p.status,
        created_at: p.created_at,
      };
    })
);

export const my_invites = spacetimedb.view(
  { name: 'my_invites', public: true }, t.array(inviteViewRow),
  ctx => [...ctx.db.invite.iter()]
    .filter(i => i.creator.isEqual(ctx.sender) && !i.used)
    .map(i => ({ invite_token: i.token, pair_id: i.pair_id, expires_at: i.expires_at }))
);

export const my_presets = spacetimedb.view(
  { name: 'my_presets', public: true }, t.array(presetViewRow),
  ctx => [...ctx.db.relationship_preset.iter()]
    .filter(p => p.owner.isEqual(ctx.sender))
    .map(p => ({
      policy_id: p.preset_id,
      owner_id: p.owner,
      preset_kind: p.preset_kind,
      allowed_categories: p.allowed_categories,
      version: p.version,
      expires_at: p.expires_at,
      revoked_at: p.revoked_at ?? undefined,
    }))
);

export const my_preset_assignments = spacetimedb.view(
  { name: 'my_preset_assignments', public: true }, t.array(assignmentViewRow),
  ctx => {
    const presets = [...ctx.db.relationship_preset.iter()].filter(p => p.owner.isEqual(ctx.sender));
    return [...ctx.db.preset_assignment.iter()]
      .filter(a => a.owner.isEqual(ctx.sender))
      .flatMap(a => {
        const preset = presets.find(p => p.preset_kind === a.preset_kind);
        return preset ? [{
          owner_id: a.owner,
          recipient_id: a.recipient,
          pair_id: a.pair_id,
          preset_id: preset.preset_id,
          preset_kind: a.preset_kind,
          assignment_version: a.assignment_version,
        }] : [];
      });
  }
);

/**
 * Defence in depth (C6): even if a suppression write was missed, a nudge is shown only while
 * every source signal still has standing for this recipient (not revoked, pair accepted, same
 * preset/assignment versions, categories still allowed). Views have no clock, so EXPIRY is
 * not enforced here; it needs a scheduled sweep reducer (open Cyber/CS item).
 */
function nudgeSourcesStand(db: ReadDb, n: { pair_id: string; source_signal_ids: string[]; source_consent_versions: number[] }, viewer: Identity): boolean {
  if (n.source_signal_ids.length === 0 || n.source_signal_ids.length !== n.source_consent_versions.length) return false;
  return n.source_signal_ids.every((id, i) => {
    const s = db.approved_signal.signal_id.find(id);
    if (!s || s.pair_id !== n.pair_id || s.consent_version !== n.source_consent_versions[i]) return false;
    return guardSignalStanding(toStoredSignal(s), loadStanding(db, s.sender_id, s.pair_id), hex(viewer)).allowed;
  });
}

export const my_nudges = spacetimedb.view(
  { name: 'my_nudges', public: true }, t.array(nudge.rowType),
  ctx => [...ctx.db.nudge.iter()].filter(n => n.recipient_id.isEqual(ctx.sender) && !n.suppressed && !n.dismissed &&
    nudgeSourcesStand(ctx.db, n, ctx.sender))
);

/** Sender-only: the owner's own approved signals (privacy center: recipient, expiry, revoke). */
export const my_signals = spacetimedb.view(
  { name: 'my_signals', public: true }, t.array(approved_signal.rowType),
  ctx => [...ctx.db.approved_signal.iter()].filter(s => s.sender_id.isEqual(ctx.sender))
);

/**
 * Sender-only (D026). Recipients must not see approved/revoked/suppressed receipts: that would
 * reveal a disclosure that produced no nudge, or a revocation. Recipients learn only via my_nudges.
 */
export const my_receipts = spacetimedb.view(
  { name: 'my_receipts', public: true }, t.array(disclosure_receipt.rowType),
  ctx => [...ctx.db.disclosure_receipt.iter()].filter(r => r.sender_id.isEqual(ctx.sender))
);
