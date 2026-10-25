// CS-R3: ingestion run status so Events can show "unavailable" / last good fetch. In-process harness only.
import { describe, expect, it } from 'vitest';
import { mod, setup, view } from './helpers';

function world() {
  const w = setup();
  w.h.withReducerTx(w.admin, ctx => mod.set_discovery_config(ctx, { key: 'areas', values: ['berkeley-campus'] }));
  w.h.withReducerTx(w.admin, ctx => mod.set_discovery_config(ctx, { key: 'enabled', values: ['true'] }));
  return w;
}
const run = (w: ReturnType<typeof setup>, ok: boolean, record_count = 3, feed_key = 'berkeley-campus') =>
  w.h.withReducerTx(w.admin, ctx => mod.record_catalogue_run(ctx, { feed_key, ok, record_count }));

describe('catalogue_status (CS-R3)', () => {
  it('a failed run keeps the last success time and count', () => {
    const w = world();
    run(w, true, 5);
    const first = view<any>(w, w.alice, mod.catalogue_status)[0];
    expect(first.last_status).toBe('ok');
    expect(first.record_count).toBe(5);
    run(w, false, 0);
    const after = view<any>(w, w.alice, mod.catalogue_status)[0];
    expect(after.last_status).toBe('failed');
    expect(after.record_count).toBe(5);
    expect(String(after.last_success_at)).toBe(String(first.last_success_at));
  });

  it('only the ingester may record runs, only for configured feeds', () => {
    const w = world();
    expect(() => w.call(w.alice, ctx => mod.record_catalogue_run(ctx, { feed_key: 'berkeley-campus', ok: true, record_count: 1 }))).toThrow(/unauthorized/);
    expect(() => run(w, true, 1, 'sf-mission')).toThrow(/invalid/);
    expect(() => run(w, true, 1, '../x')).toThrow(/invalid/);
    expect(() => run(w, true, 1_000_000)).toThrow(/invalid/);
  });

  it('hidden while discovery is off', () => {
    const w = world();
    run(w, true);
    w.h.withReducerTx(w.admin, ctx => mod.set_discovery_config(ctx, { key: 'enabled', values: ['false'] }));
    expect(view<any>(w, w.alice, mod.catalogue_status)).toEqual([]);
  });
});
