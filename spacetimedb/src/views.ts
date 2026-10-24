import { t } from 'spacetimedb/server';
import { spacetimedb, account, nudge, disclosure_receipt } from './schema';

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

export const my_nudges = spacetimedb.view(
  { name: 'my_nudges', public: true }, t.array(nudge.rowType),
  ctx => [...ctx.db.nudge.iter()].filter(n => n.recipient_id.isEqual(ctx.sender) && !n.suppressed && !n.dismissed)
);

export const my_receipts = spacetimedb.view(
  { name: 'my_receipts', public: true }, t.array(disclosure_receipt.rowType),
  ctx => [...ctx.db.disclosure_receipt.iter()]
    .filter(r => r.sender_id.isEqual(ctx.sender) || r.recipient_id.isEqual(ctx.sender))
);
