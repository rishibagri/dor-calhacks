import { t } from 'spacetimedb/server';
import { spacetimedb } from '../schema';
import { fail, type Ctx } from '../errors';
import { otherMember, parseCategories, parseFuture, parseKind, requireAccount, requireAcceptedPair } from '../guards';
import { newId } from '../ids';
import { suppressPairWork } from '../suppress';

function findPreset(ctx: Ctx, kind: string) {
  for (const p of ctx.db.relationship_preset.iter()) {
    if (p.owner.isEqual(ctx.sender) && p.preset_kind === kind) return p;
  }
  return undefined;
}

export const set_relationship_preset = spacetimedb.reducer(
  { preset_kind: t.string(), allowed_categories: t.array(t.string()), expected_version: t.u32(), expires_at: t.string() },
  (ctx, args) => {
    requireAccount(ctx);
    const kind = parseKind(args.preset_kind);
    const cats = parseCategories(args.allowed_categories);
    const expires = parseFuture(ctx, args.expires_at, 'expires_at');
    const cur = findPreset(ctx, kind);
    if ((cur?.version ?? 0) !== args.expected_version) fail('stale', 'preset version changed');
    if (!cur) {
      ctx.db.relationship_preset.insert({
        preset_id: newId(ctx), owner: ctx.sender, preset_kind: kind, allowed_categories: cats,
        version: 1, expires_at: expires, revoked_at: undefined,
      });
      return;
    }
    const tightened = cur.revoked_at !== undefined ? false
      : cur.allowed_categories.some(c => !cats.includes(c)) ||
        expires.microsSinceUnixEpoch < cur.expires_at.microsSinceUnixEpoch;
    ctx.db.relationship_preset.preset_id.update({
      ...cur, allowed_categories: cats, expires_at: expires, revoked_at: undefined, version: cur.version + 1,
    });
    if (tightened) {
      for (const a of [...ctx.db.preset_assignment.iter()]) {
        if (a.owner.isEqual(ctx.sender) && a.preset_kind === kind) suppressPairWork(ctx, a.pair_id, ctx.sender);
      }
    }
  }
);

export const assign_relationship_preset = spacetimedb.reducer(
  { pair_id: t.string(), preset_kind: t.string(), expected_assignment_version: t.u32() },
  (ctx, args) => {
    requireAccount(ctx);
    const kind = parseKind(args.preset_kind);
    const p = requireAcceptedPair(ctx, args.pair_id);
    const recipient = otherMember(p, ctx.sender);
    if (!recipient) fail('invalid', 'pair has no recipient');
    const preset = findPreset(ctx, kind);
    if (!preset || preset.revoked_at) fail('not_found', 'set a preset of this kind first');
    const cur = [...ctx.db.preset_assignment.iter()]
      .find(a => a.pair_id === args.pair_id && a.owner.isEqual(ctx.sender));
    if ((cur?.assignment_version ?? 0) !== args.expected_assignment_version) fail('stale', 'assignment version changed');
    if (!cur) {
      ctx.db.preset_assignment.insert({
        assignment_id: newId(ctx), owner: ctx.sender, pair_id: args.pair_id, recipient,
        preset_kind: kind, assignment_version: 1,
      });
      return;
    }
    ctx.db.preset_assignment.assignment_id.update({ ...cur, preset_kind: kind, assignment_version: cur.assignment_version + 1 });
    suppressPairWork(ctx, args.pair_id, ctx.sender); // reassignment invalidates prior permissions
  }
);
