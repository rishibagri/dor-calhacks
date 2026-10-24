// CS-R4: core views read index ranges instead of whole tables. These assert the observable contract the
// rewrite must keep: every caller sees exactly their own rows, both pair members included, across many accounts.
// In-process harness only.
import { describe, expect, it } from 'vitest';
import { jwtAuth, mod, setup, view, FUTURE } from './helpers';

type W = ReturnType<typeof setup>;
type Who = W['alice'];

function account(w: W, i: number): Who {
  const who = jwtAuth(`acct-${i}`, 500n + BigInt(i));
  w.call(who, ctx => mod.register_account(ctx, { display_name: `Acct ${i}` }));
  return who;
}
function link(w: W, a: Who, b: Who): string {
  w.call(a, ctx => mod.create_pair_invite(ctx, {}));
  const inv = view<any>(w, a, mod.my_invites).at(-1);
  w.call(b, ctx => mod.accept_pair_invite(ctx, { invite_token: inv.invite_token }));
  return inv.pair_id as string;
}

describe('core views after the index rewrite', () => {
  it('each of many accounts sees exactly its own pairs, as creator or accepter', () => {
    const w = setup();
    const people = Array.from({ length: 12 }, (_, i) => account(w, i));
    const expected = new Map<number, Set<string>>(people.map((_, i) => [i, new Set()]));
    for (let i = 0; i < people.length; i++) {
      const j = (i + 1) % people.length;
      const pairId = link(w, people[i]!, people[j]!);
      expected.get(i)!.add(pairId); expected.get(j)!.add(pairId);
    }
    people.forEach((p, i) => {
      const seen = view<any>(w, p, mod.my_pairs);
      expect(new Set(seen.map(r => r.pair_id))).toEqual(expected.get(i));
      expect(seen.every(r => r.status === 'accepted')).toBe(true);
    });
  });

  it('a pending invite is visible only to its creator; unlink keeps both views consistent', () => {
    const w = setup();
    w.call(w.alice, ctx => mod.create_pair_invite(ctx, {}));
    expect(view<any>(w, w.alice, mod.my_invites)).toHaveLength(1);
    expect(view<any>(w, w.bob, mod.my_invites)).toHaveLength(0);
    expect(view<any>(w, w.bob, mod.my_pairs)).toHaveLength(0);
    const inv = view<any>(w, w.alice, mod.my_invites)[0];
    const pairId = inv.pair_id;
    w.call(w.bob, ctx => mod.accept_pair_invite(ctx, { invite_token: inv.invite_token }));
    w.call(w.alice, ctx => mod.unlink_pair(ctx, { pair_id: pairId }));
    for (const who of [w.alice, w.bob]) expect(view<any>(w, who, mod.my_pairs)[0].status).toBe('unlinked');
    expect(view<any>(w, w.carol, mod.my_pairs)).toHaveLength(0);
  });

  it('a repeat pairing between the same two people is still refused', () => {
    const w = setup();
    link(w, w.alice, w.bob);
    w.call(w.bob, ctx => mod.create_pair_invite(ctx, {}));
    const inv = view<any>(w, w.bob, mod.my_invites).at(-1);
    expect(() => w.call(w.alice, ctx => mod.accept_pair_invite(ctx, { invite_token: inv.invite_token }))).toThrow(/already paired/);
  });

  it('presets and assignments stay owner-only across accounts', () => {
    const w = setup();
    const pairId = link(w, w.alice, w.bob);
    w.call(w.alice, ctx => mod.set_relationship_preset(ctx, { preset_kind: 'friend', allowed_categories: ['support_preference'], expected_version: 0, expires_at: FUTURE }));
    w.call(w.alice, ctx => mod.assign_relationship_preset(ctx, { pair_id: pairId, preset_kind: 'friend', expected_assignment_version: 0 }));
    expect(view<any>(w, w.alice, mod.my_presets)).toHaveLength(1);
    expect(view<any>(w, w.alice, mod.my_preset_assignments)).toHaveLength(1);
    for (const who of [w.bob, w.carol]) {
      expect(view<any>(w, who, mod.my_presets)).toHaveLength(0);
      expect(view<any>(w, who, mod.my_preset_assignments)).toHaveLength(0);
    }
  });
});
