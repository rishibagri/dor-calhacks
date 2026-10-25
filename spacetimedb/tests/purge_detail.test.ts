// D057: catalogue details (ingester-only, cleaned matching text) and the owner-only test-account purge.
// Synthetic identities and places only; in-process harness.
import { describe, expect, it } from 'vitest';
import { allSignals, approveArgs, confirmPreset, jwtAuth, mod, pairUp, setup, view } from './helpers';

const iso = (w: ReturnType<typeof setup>) => w.h.clock.now().toDate().toISOString();

function world() {
  const w = setup();
  const admin = (fn: Parameters<typeof w.h.withReducerTx>[1]) => w.h.withReducerTx(w.admin, fn);
  admin(ctx => mod.set_discovery_config(ctx, { key: 'areas', values: ['berkeley-campus'] }));
  admin(ctx => mod.set_discovery_config(ctx, { key: 'source_hosts', values: ['google.com'] }));
  const worker = jwtAuth('dor-worker', 50n, 'https://worker.spacetimedb.example');
  const workerId = w.h.withReducerTx(worker, ctx => ctx.sender);
  admin(ctx => mod.set_worker_identity(ctx, { worker: workerId, enabled: true }));
  w.call(worker, ctx => mod.upsert_catalogue_place(ctx, { place_id: 'gmp:abc123', name: 'Noodle Bar', kind: 'bar', label: 'Bar',
    rating_tenths: 45, review_count: 300, area_key: 'berkeley-campus', source_url: undefined, fetched_at: iso(w) }));
  return Object.assign(w, { worker, asAdmin: admin });
}
const detail = (w: ReturnType<typeof setup>, over: Record<string, unknown> = {}) => ({
  item_id: 'gmp:abc123', item_kind: 'place', summary: 'Cozy spot. Call +1 (510) 555-0101 or visit https://x.example', keywords: ['Craft Beer', 'Trivia Night', '!!'],
  price_label: '$$', venue: 'Noodle Bar', fetched_at: iso(w), ...over,
}) as Parameters<typeof mod.upsert_catalogue_detail>[1];

describe('catalogue details', () => {
  it('only the ingester writes them, text is cleaned of links and phone numbers, keywords are slugs', () => {
    const w = world();
    expect(() => w.call(w.alice, ctx => mod.upsert_catalogue_detail(ctx, detail(w)))).toThrow('unauthorized');
    w.call(w.worker, ctx => mod.upsert_catalogue_detail(ctx, detail(w)));
    const [row] = view<any>(w, w.bob, mod.catalogue_details);
    expect(row.summary).not.toMatch(/555|https|example/);
    expect(row.keywords).toEqual(['craft-beer', 'trivia-night']);
    expect(() => w.call(w.worker, ctx => mod.upsert_catalogue_detail(ctx, detail(w, { item_id: 'gmp:missing' })))).toThrow('not_found');
    expect(() => w.call(w.worker, ctx => mod.upsert_catalogue_detail(ctx, detail(w, { item_kind: 'person' })))).toThrow('invalid');
  });
});

describe('admin_purge_account', () => {
  it('is owner-only and removes the target account with its pairs, signals and settings; others keep their accounts', () => {
    const w = world();
    const { pairId } = pairUp(w);
    confirmPreset(w, w.alice, pairId, 'friend', ['support_preference', 'coarse_availability']);
    const args = approveArgs(w, w.alice, pairId, { support_mode: 'short_call', availability: 'today' }, 'req-p1');
    w.call(w.alice, ctx => mod.approve_signal(ctx, args));
    expect(allSignals(w)).toHaveLength(1);
    const bobId = w.h.withReducerTx(w.bob, ctx => ctx.sender);
    expect(() => w.call(w.carol, ctx => mod.admin_purge_account(ctx, { target: bobId }))).toThrow('unauthorized');
    w.asAdmin(ctx => mod.admin_purge_account(ctx, { target: bobId }));
    const accounts = () => w.h.withReducerTx(w.admin, ctx => [...ctx.db.account.iter()].map(a => a.identity.toHexString()));
    expect(accounts()).not.toContain(bobId.toHexString());
    expect(accounts()).toHaveLength(2); // alice and carol keep their accounts
    expect(view(w, w.alice, mod.my_pairs)).toEqual([]);
    expect(allSignals(w)).toHaveLength(0);
  });

  it('refuses the worker identity', () => {
    const w = world();
    const workerId = w.h.withReducerTx(w.worker, ctx => ctx.sender);
    expect(() => w.asAdmin(ctx => mod.admin_purge_account(ctx, { target: workerId }))).toThrow('cannot purge a worker identity');
  });
});
