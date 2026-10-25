// D051 proposal: public catalogue places (Google Maps source). Ingester-only writes, default-deny normalization,
// bounded public view for registered accounts while discovery is on. Synthetic places only; in-process harness.
import { describe, expect, it } from 'vitest';
import { jwtAuth, mod, setup, view } from './helpers';

const iso = (w: ReturnType<typeof setup>, offsetMs = 0) => new Date(w.h.clock.now().toDate().getTime() + offsetMs).toISOString();

function world(enabled = true) {
  const w = setup();
  const admin = (fn: Parameters<typeof w.h.withReducerTx>[1]) => w.h.withReducerTx(w.admin, fn);
  admin(ctx => mod.set_discovery_config(ctx, { key: 'areas', values: ['berkeley-campus'] }));
  admin(ctx => mod.set_discovery_config(ctx, { key: 'source_hosts', values: ['google.com'] }));
  if (enabled) admin(ctx => mod.set_discovery_config(ctx, { key: 'enabled', values: ['true'] }));
  const worker = jwtAuth('dor-worker', 50n, 'https://worker.spacetimedb.example');
  const workerId = w.h.withReducerTx(worker, ctx => ctx.sender);
  admin(ctx => mod.set_worker_identity(ctx, { worker: workerId, enabled: true }));
  return Object.assign(w, { worker });
}
const place = (w: ReturnType<typeof setup>, over: Record<string, unknown> = {}) => ({
  place_id: 'gmp:abc123', name: 'Noodle Bar', kind: 'food', label: 'Ramen restaurant', rating_tenths: 46, review_count: 812,
  area_key: 'berkeley-campus', source_url: 'https://www.google.com/maps/search/?api=1&query=Noodle%20Bar', fetched_at: iso(w), ...over,
}) as Parameters<typeof mod.upsert_catalogue_place>[1];

describe('catalogue places', () => {
  it('only the module owner or the allow-listed worker ingests; users cannot write places', () => {
    const w = world();
    expect(() => w.call(w.alice, ctx => mod.upsert_catalogue_place(ctx, place(w)))).toThrow('unauthorized');
    w.call(w.worker, ctx => mod.upsert_catalogue_place(ctx, place(w)));
    const rows = view<any>(w, w.bob, mod.catalogue_places);
    expect(rows.map(r => [r.name, r.kind, r.rating_tenths, r.review_count, r.area_key])).toEqual([['Noodle Bar', 'food', 46, 812, 'berkeley-campus']]);
    expect(Object.keys(rows[0]).sort()).toEqual(['area_key', 'fetched_at', 'kind', 'label', 'name', 'place_id', 'rating_tenths', 'review_count', 'source_url']);
  });

  it('refuses areas, links, kinds and ratings outside the allowlists, and markup in names', () => {
    const w = world();
    const up = (over: Record<string, unknown>) => () => w.call(w.worker, ctx => mod.upsert_catalogue_place(ctx, place(w, over)));
    expect(up({ area_key: 'oakland-downtown' })).toThrow('invalid: area_not_allowlisted');
    expect(up({ source_url: 'https://evil.example/x' })).toThrow('invalid: unsafe_source_url');
    expect(up({ kind: 'nightclub' })).toThrow('invalid: invalid_schema');
    expect(up({ rating_tenths: 51 })).toThrow('invalid: invalid_schema');
    w.call(w.worker, ctx => mod.upsert_catalogue_place(ctx, place(w, { name: '<b>Noodle</b>‮ Bar' })));
    expect(view<any>(w, w.alice, mod.catalogue_places)[0].name).toBe('b Noodle /b Bar');
  });

  it('never rolls a place back to an older fetch', () => {
    const w = world();
    w.call(w.worker, ctx => mod.upsert_catalogue_place(ctx, place(w, { rating_tenths: 45 })));
    expect(() => w.call(w.worker, ctx => mod.upsert_catalogue_place(ctx, place(w, { rating_tenths: 40, fetched_at: iso(w, -3_600_000) }))))
      .toThrow('stale: older_fetch');
    expect(view<any>(w, w.alice, mod.catalogue_places)[0].rating_tenths).toBe(45);
  });

  it('is empty while discovery is off', () => {
    const w = world(false);
    w.call(w.worker, ctx => mod.upsert_catalogue_place(ctx, place(w)));
    expect(view(w, w.alice, mod.catalogue_places)).toHaveLength(0);
  });
});
