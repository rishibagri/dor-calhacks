// CS-R2: area-indexed, paged discovery_cards. Direct view/reducer calls; synthetic names/tags only.
// In-process harness: no deployed isolation or real scheduler evidence.
import { describe, expect, it } from 'vitest';
import { DISCOVERY_CARD_LIMIT } from '@dor/contracts/policy';
import { inDays, jwtAuth, mod, setup, view } from './helpers';

type W = ReturnType<typeof setup>;
type Who = W['alice'];

function world() {
  const w = setup();
  w.h.withReducerTx(w.admin, ctx => mod.set_discovery_config(ctx, { key: 'tags', values: ['board-games', 'hiking'] }));
  w.h.withReducerTx(w.admin, ctx => mod.set_discovery_config(ctx, { key: 'areas', values: ['berkeley-campus', 'sf-mission'] }));
  w.h.withReducerTx(w.admin, ctx => mod.set_discovery_config(ctx, { key: 'enabled', values: ['true'] }));
  return w;
}
const mine = (w: W, who: Who) => view<any>(w, who, mod.my_discovery_profile)[0];
const cards = (w: W, who: Who) => view<any>(w, who, mod.discovery_cards);
function participate(w: W, who: Who, area = 'berkeley-campus') {
  const expected_revision = mine(w, who)?.revision ?? 0;
  const expires_at = inDays(w, 3);
  w.call(who, ctx => mod.publish_discovery_profile(ctx, {
    display_name: 'Synthetic', interest_tags: ['board-games', 'hiking'], audience: 'area_discoverers', notice_version: 1,
    expires_at, expected_revision,
  }));
  w.call(who, ctx => mod.set_discovery_area(ctx, { area_key: area }));
}
function extra(w: W, n: number, area = 'berkeley-campus', base = 100n) {
  return Array.from({ length: n }, (_, i) => {
    const who = jwtAuth(`x-${base}-${i}`, base + BigInt(i));
    w.call(who, ctx => mod.register_account(ctx, { display_name: `X ${i}` }));
    participate(w, who, area);
    return who;
  });
}
const page = (w: W, who: Who, after_ref: string) => w.call(who, ctx => mod.set_discovery_page(ctx, { after_ref }));

describe('discovery_cards (CS-R2 indexed, paged)', () => {
  it('returns only same-area participants, in card-ref order, never the viewer', () => {
    const w = world();
    participate(w, w.alice); participate(w, w.bob); participate(w, w.carol, 'sf-mission');
    const seen = cards(w, w.alice).map(c => c.card_ref);
    expect(seen).toEqual([mine(w, w.bob).publication_id]);
    expect(cards(w, w.carol)).toEqual([]);
    const many = extra(w, 5);
    const refs = cards(w, many[0]).map(c => c.card_ref as string);
    expect(refs).toEqual([...refs].sort());
    expect(refs).not.toContain(mine(w, many[0]).publication_id);
  });

  it('caps a dense area at DISCOVERY_CARD_LIMIT and pages through it without gaps or repeats', () => {
    const w = world();
    participate(w, w.alice);
    extra(w, DISCOVERY_CARD_LIMIT + 7);
    const first = cards(w, w.alice).map(c => c.card_ref as string);
    expect(first).toHaveLength(DISCOVERY_CARD_LIMIT);
    page(w, w.alice, first.at(-1)!);
    const second = cards(w, w.alice).map(c => c.card_ref as string);
    expect(second).toHaveLength(7);
    expect(second.every(r => r > first.at(-1)!)).toBe(true);
    page(w, w.alice, '');
    expect(cards(w, w.alice).map(c => c.card_ref)).toEqual(first);
  });

  it('the cursor is per viewer and rejects anything that is not an opaque ref', () => {
    const w = world();
    participate(w, w.alice); participate(w, w.bob); participate(w, w.carol);
    page(w, w.alice, 'zzzz');
    expect(cards(w, w.alice)).toEqual([]);
    expect(cards(w, w.bob)).toHaveLength(2);
    for (const bad of ["' OR 1=1", 'a'.repeat(129), 'ref with space']) {
      expect(() => page(w, w.alice, bad)).toThrow(/invalid/);
    }
  });

  it('hides people with an accepted introduction, keeps pending ones visible', () => {
    const w = world();
    participate(w, w.alice); participate(w, w.bob); participate(w, w.carol);
    const bobRef = mine(w, w.bob).publication_id;
    const aliceRef = mine(w, w.alice).publication_id;
    w.call(w.alice, ctx => mod.send_introduction_request(ctx, { card_ref: bobRef, client_request_id: 'request-0001' }));
    expect(cards(w, w.alice).map(c => c.card_ref)).toContain(bobRef);
    const intro = view<any>(w, w.bob, mod.my_introductions).find(i => i.direction === 'incoming')!;
    w.call(w.bob, ctx => mod.respond_introduction_request(ctx, { intro_id: intro.intro_id, accept: true }));
    expect(cards(w, w.alice).map(c => c.card_ref)).not.toContain(bobRef);
    expect(cards(w, w.bob).map(c => c.card_ref)).not.toContain(aliceRef);
    expect(cards(w, w.alice)).toHaveLength(1); // carol still visible
  });

  it('another-area and withdrawn participants never appear, even after paging', () => {
    const w = world();
    participate(w, w.alice); participate(w, w.bob); participate(w, w.carol, 'sf-mission');
    page(w, w.alice, '');
    const carolRef = mine(w, w.carol).publication_id;
    expect(cards(w, w.alice).some(c => c.card_ref === carolRef)).toBe(false);
    expect(cards(w, w.alice)).toHaveLength(1);
    w.call(w.bob, ctx => mod.withdraw_discovery_profile(ctx, {}));
    expect(cards(w, w.alice)).toEqual([]);
  });

  it('cards carry exactly the five projection fields', () => {
    const w = world();
    participate(w, w.alice); participate(w, w.bob);
    expect(Object.keys(cards(w, w.alice)[0]).sort()).toEqual(['card_ref', 'display_name', 'interest_tags', 'revision', 'shared_tags']);
  });
});
