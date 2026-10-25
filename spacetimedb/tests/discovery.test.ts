// PROPOSED C8 discovery boundary (Cyber, D035): direct reducer and view calls. Synthetic names/tags only.
// In-process harness: no deployed isolation, real location capture or browser evidence.
import { describe, expect, it } from 'vitest';
import { Timestamp } from 'spacetimedb';
import { approveArgs, confirmPreset, grantPrefs, inDays, jwtAuth, mod, pairUp, setup, sweep, view } from './helpers';

type W = ReturnType<typeof setup>;
type Who = W['alice'];
const HOUR_US = 3_600_000_000n;

function world({ enable = true } = {}) {
  const w = setup();
  w.h.withReducerTx(w.admin, ctx => mod.set_discovery_config(ctx, { key: 'tags', values: ['board-games', 'hiking', 'live-music'] }));
  w.h.withReducerTx(w.admin, ctx => mod.set_discovery_config(ctx, { key: 'areas', values: ['berkeley-campus', 'oakland-downtown'] }));
  w.h.withReducerTx(w.admin, ctx => mod.set_discovery_config(ctx, { key: 'enabled', values: enable ? ['true'] : ['false'] }));
  return w;
}
const mine = (w: W, who: Who) => view<any>(w, who, mod.my_discovery_profile)[0];
function publish(w: W, who: Who, over: Record<string, unknown> = {}) {
  const expected_revision = mine(w, who)?.revision ?? 0; // views: outside the tx
  w.call(who, ctx => mod.publish_discovery_profile(ctx, {
    display_name: 'Synthetic', interest_tags: ['board-games'], audience: 'area_discoverers', notice_version: 1,
    expires_at: inDays(w, 3), expected_revision, ...over,
  } as Parameters<typeof mod.publish_discovery_profile>[1]));
}
const join = (w: W, who: Who, area = 'berkeley-campus') => w.call(who, ctx => mod.set_discovery_area(ctx, { area_key: area }));
const participate = (w: W, who: Who, area?: string, over?: Record<string, unknown>) => { publish(w, who, over); join(w, who, area); };
const cards = (w: W, who: Who) => view<any>(w, who, mod.discovery_cards);
const refOf = (w: W, who: Who) => mine(w, who).publication_id as string;

describe('C8 discovery is off by default and owner-configured', () => {
  it('discovery is on by default; publishing and area participation stop when the owner turns it off', () => {
    const unset = world();
    unset.h.withReducerTx(unset.admin, ctx => mod.set_discovery_config(ctx, { key: 'enabled', values: [] }));
    publish(unset, unset.alice); // no flag set at all: on
    expect(mine(unset, unset.alice).discovery_enabled).toBe(true);
    const w = world({ enable: false });
    expect(() => publish(w, w.alice)).toThrow('unavailable: disabled');
    expect(() => join(w, w.alice)).toThrow('unavailable: disabled');
    expect(cards(w, w.alice)).toHaveLength(0);
    expect(mine(w, w.alice).discovery_enabled).toBe(false);
  });

  it('only the module owner edits config; allowlists must be slugs', () => {
    const w = world();
    expect(() => w.call(w.alice, ctx => mod.set_discovery_config(ctx, { key: 'enabled', values: ['true'] }))).toThrow('unauthorized: module owner only');
    expect(() => w.h.withReducerTx(w.admin, ctx => mod.set_discovery_config(ctx, { key: 'areas', values: ['37.87,-122.25'] }))).toThrow('invalid: allowlist');
    expect(() => w.h.withReducerTx(w.admin, ctx => mod.set_discovery_config(ctx, { key: 'radius', values: ['1'] }))).toThrow('invalid: unknown key');
  });
});

describe('publication and area participation', () => {
  it('publication accepts only the exact allowlisted preview; contact details and free tags are refused', () => {
    const w = world();
    expect(() => publish(w, w.alice, { display_name: 'alice@example.com' })).toThrow('invalid: looks_like_identifier');
    expect(() => publish(w, w.alice, { interest_tags: ['support-group'] })).toThrow('invalid: tag_not_allowlisted');
    expect(() => publish(w, w.alice, { audience: 'everyone' })).toThrow('invalid: invalid_schema');
    expect(() => publish(w, w.alice, { notice_version: 0 })).toThrow('stale: stale_revision');
    expect(() => publish(w, w.alice, { expires_at: inDays(w, 8) })).toThrow('invalid: invalid_schema');
    publish(w, w.alice);
    expect(() => publish(w, w.alice, { expected_revision: 0 })).toThrow('stale: stale_revision');
  });

  it('area participation takes a configured coarse key only, never coordinates or a finer cell', () => {
    const w = world();
    for (const k of ['37.8719,-122.2585', '9q9p3w', 'berkeley-campus-north-block']) {
      expect(() => join(w, w.alice, k)).toThrow(/^invalid:/);
    }
    join(w, w.alice);
    const area = w.h.withReducerTx(w.admin, ctx => [...ctx.db.area_participation.iter()]);
    expect(Object.keys(area[0]).sort()).toEqual(['active', 'area_key', 'expires_at', 'owner', 'revision']);
  });
});

describe('discovery_cards: caller-filtered projection (direct subscription)', () => {
  it('published participants in the same area see each other, with approved fields and overlap only', () => {
    const w = world();
    participate(w, w.alice, undefined, { interest_tags: ['board-games', 'hiking'] });
    participate(w, w.bob, undefined, { display_name: 'Bob S', interest_tags: ['hiking', 'live-music'] });
    const [card] = cards(w, w.alice);
    expect(Object.keys(card).sort()).toEqual(['card_ref', 'display_name', 'interest_tags', 'revision', 'shared_tags']);
    expect(card).toMatchObject({ display_name: 'Bob S', shared_tags: ['hiking'] });
    expect(JSON.stringify(card, (_, v) => typeof v === 'bigint' ? String(v) : v)).not.toMatch(/berkeley|identity|pair/);
    expect(cards(w, w.bob)).toHaveLength(1);
  });

  it('a lurker (signed in but unpublished), an unregistered caller or the anonymous context sees nothing', () => {
    const w = world();
    participate(w, w.alice); participate(w, w.bob);
    expect(cards(w, w.carol)).toHaveLength(0);
    publish(w, w.carol); // published but no area participation
    expect(cards(w, w.carol)).toHaveLength(0);
    expect(cards(w, jwtAuth('stranger', 77n))).toHaveLength(0);
  });

  it('a different configured area does not see the card', () => {
    const w = world();
    participate(w, w.alice); participate(w, w.bob, 'oakland-downtown');
    expect(cards(w, w.alice)).toHaveLength(0);
  });

  it('withdrawal removes the card immediately and replay cannot restore it; re-publishing is a new revision', () => {
    const w = world();
    participate(w, w.alice); participate(w, w.bob);
    w.call(w.bob, ctx => mod.withdraw_discovery_profile(ctx, {}));
    expect(cards(w, w.alice)).toHaveLength(0);
    expect(cards(w, w.bob)).toHaveLength(0);
    expect(mine(w, w.bob)).toMatchObject({ withdrawn: true, area_active: false }); // area participation ends too
    w.call(w.bob, ctx => mod.withdraw_discovery_profile(ctx, {})); // idempotent
    join(w, w.bob); // area alone does not re-publish
    expect(cards(w, w.alice)).toHaveLength(0);
    publish(w, w.bob);
    expect(cards(w, w.alice)[0].revision).toBe(2);
  });

  it('expired publication or area leaves the view after the sweep (clockless view, bounded window)', () => {
    const w = world();
    participate(w, w.alice); participate(w, w.bob);
    w.h.clock.set(new Timestamp(w.h.clock.now().microsSinceUnixEpoch + 24n * HOUR_US));
    expect(cards(w, w.alice)).toHaveLength(1); // documented window before the sweep
    sweep(w);
    expect(cards(w, w.alice)).toHaveLength(0);
    expect(mine(w, w.alice).expired).toBe(true);
  });

  it('a publication that expires before the area leaves the view after the sweep', () => {
    const w = world();
    participate(w, w.alice); participate(w, w.bob, undefined, { expires_at: inDays(w, 0.5) });
    w.h.clock.set(new Timestamp(w.h.clock.now().microsSinceUnixEpoch + 12n * HOUR_US));
    sweep(w);
    expect(cards(w, w.alice)).toHaveLength(0);
  });

  it('a block hides both people from each other immediately, is idempotent, and is never shown to the target', () => {
    const w = world();
    participate(w, w.alice); participate(w, w.bob); participate(w, w.carol);
    const bobRef = refOf(w, w.bob);
    w.call(w.alice, ctx => mod.block_discovery_user(ctx, { card_ref: bobRef }));
    w.call(w.alice, ctx => mod.block_discovery_user(ctx, { card_ref: bobRef }));
    expect(cards(w, w.alice).map(c => c.card_ref)).not.toContain(bobRef);
    expect(cards(w, w.bob).map(c => c.card_ref)).not.toContain(refOf(w, w.alice));
    expect(cards(w, w.bob)).toHaveLength(1); // still sees carol; nothing says "blocked"
    expect(JSON.stringify(mine(w, w.bob), (_, v) => typeof v === 'bigint' ? String(v) : v)).not.toMatch(/block/i);
  });

  it('blocking a card you cannot see is not_found (no probing), and self-block is refused', () => {
    const w = world();
    participate(w, w.alice); participate(w, w.bob, 'oakland-downtown');
    const bobRef = refOf(w, w.bob), aliceRef = refOf(w, w.alice); // views: outside the tx
    expect(() => w.call(w.alice, ctx => mod.block_discovery_user(ctx, { card_ref: bobRef }))).toThrow('not_found: card');
    expect(() => w.call(w.alice, ctx => mod.block_discovery_user(ctx, { card_ref: aliceRef }))).toThrow('not_found: card');
    expect(() => w.call(w.carol, ctx => mod.block_discovery_user(ctx, { card_ref: 'guess' }))).toThrow('not_found: card');
  });

  it('strangers never reach pair signals, presets, support preferences or delivery settings through discovery', () => {
    const w = world();
    const { pairId } = pairUp(w);
    confirmPreset(w, w.alice, pairId, 'partner', ['support_preference']);
    const args = approveArgs(w, w.alice, pairId, { support_mode: 'short_call' });
    w.call(w.alice, ctx => mod.approve_signal(ctx, args));
    grantPrefs(w, w.bob, pairId);
    participate(w, w.alice); participate(w, w.carol);
    expect(cards(w, w.carol)).toHaveLength(1); // carol discovers alice ...
    for (const v of [mod.my_signals, mod.my_receipts, mod.my_presets, mod.my_preset_assignments, mod.my_support_preferences,
      mod.my_nudges, mod.my_nudge_delivery, mod.my_pairs]) {
      expect(view(w, w.carol, v)).toHaveLength(0); // ... but none of alice's pair state
    }
    expect(view(w, w.carol, mod.worker_signal_context)).toHaveLength(0);
  });
});
