// Live-host authorization for database-initiated calls (fix for the Core 3 finding: sweep_expired refused every
// scheduled run). The harness always marks its internal calls `isInternal`, which hides the live behaviour, so these
// tests call the reducers with a context shaped like the real SpacetimeDB 2.13 host: isInternal false, no
// connection, sender = the database identity. Synthetic only.
import { describe, expect, it } from 'vitest';
import type { Identity } from 'spacetimedb';
import { TestAuth } from 'spacetimedb/server/test-utils';
import { approveArgs, confirmPreset, inDays, mod, pairUp, setup, view } from './helpers';

type W = ReturnType<typeof setup>;
type Shape = { internal: boolean; connected: boolean; sender: 'database' | 'other' };

/** Runs `fn` with a reducer context reshaped as the given caller (methods bound to the real context). */
function asCaller<T>(w: W, shape: Shape, fn: (ctx: any) => T): T {
  const other: Identity = w.h.withReducerTx(w.alice, c => c.sender); // outside: nested transactions trap the harness
  return w.h.withReducerTx(TestAuth.internal(), real => {
    const fake = new Proxy(real, {
      get(target, key) {
        if (key === 'senderAuth') return { isInternal: shape.internal, hasJWT: false, jwt: null };
        if (key === 'connectionId') return shape.connected ? (w.alice as any).connectionId : null;
        if (key === 'sender') return shape.sender === 'database' ? target.databaseIdentity : other;
        const v = Reflect.get(target, key);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    return fn(fake);
  });
}
const sweepArgs = { sweep: { scheduled_id: 0n, scheduled_at: { tag: 'Interval', value: { micros: 0n } } as any } };
const LIVE_SCHEDULER: Shape = { internal: false, connected: false, sender: 'database' };

describe('database-initiated calls on a real host (isInternal is never set live)', () => {
  it('the scheduled sweep runs: no connection + database identity is admitted', () => {
    const w = setup();
    expect(() => asCaller(w, LIVE_SCHEDULER, ctx => mod.sweep_expired(ctx, sweepArgs))).not.toThrow();
  });

  it('the live sweep really expires things: a lapsed pause stops showing as active', () => {
    const w = setup();
    const { pairId } = pairUp(w);
    confirmPreset(w, w.alice, pairId, 'partner', ['support_preference']);
    w.call(w.alice, ctx => mod.pause_recipient(ctx, { pair_id: pairId, expires_at: inDays(w, 1 / 24), expected_version: 0 }));
    w.h.clock.set(new (w.h.clock.now().constructor as any)(w.h.clock.now().microsSinceUnixEpoch + 3_700_000_000n));
    asCaller(w, LIVE_SCHEDULER, ctx => mod.sweep_expired(ctx, sweepArgs));
    expect(view<any>(w, w.alice, mod.my_recipient_pauses)[0].active).toBe(false);
    const args = approveArgs(w, w.alice, pairId, { support_mode: 'short_call' }, 'req-after-expiry');
    w.call(w.alice, ctx => mod.approve_signal(ctx, args));
  });

  it('anyone else is refused: a signed-in user, the database identity with a connection, or no connection from another identity', () => {
    const w = setup();
    expect(() => w.call(w.alice, ctx => mod.sweep_expired(ctx, sweepArgs))).toThrow('unauthorized: scheduler only');
    for (const shape of [
      { internal: false, connected: true, sender: 'database' },
      { internal: false, connected: false, sender: 'other' },
      { internal: false, connected: true, sender: 'other' },
    ] as Shape[]) {
      expect(() => asCaller(w, shape, ctx => mod.sweep_expired(ctx, sweepArgs))).toThrow('unauthorized: scheduler only');
    }
  });
});

describe('ingester and owner checks no longer depend on isInternal', () => {
  const event = (w: W) => ({
    event_id: 'evt-live-1', title: 'Synthetic', starts_at: inDays(w, 2), ends_at: undefined, status: 'scheduled', fetched_at: inDays(w, 0),
    topics: ['hiking'], format: 'online', area_key: undefined, source_url: undefined,
  });
  function configured() {
    const w = setup();
    w.h.withReducerTx(w.admin, ctx => mod.set_discovery_config(ctx, { key: 'tags', values: ['hiking'] }));
    return w;
  }

  it('the module owner can ingest on a real host (owner row, not isInternal)', () => {
    const w = configured();
    // init records the publisher as owner; the harness skips init, so record a normal signed-in identity the same way.
    const carolId = w.h.withReducerTx(w.carol, ctx => ctx.sender);
    w.h.withReducerTx(w.admin, ctx => ctx.db.module_owner.insert({ key: 'owner', owner: carolId }));
    w.call(w.carol, ctx => mod.upsert_catalogue_event(ctx, event(w))); // JWT caller with a connection: isInternal is false
    expect(w.h.withReducerTx(w.admin, ctx => ctx.db.catalogue_event.event_id.find('evt-live-1'))).toBeTruthy();
    expect(() => w.call(w.alice, ctx => mod.upsert_catalogue_event(ctx, { ...event(w), event_id: 'evt-live-2' }))).toThrow('unauthorized: ingester only');
  });

  it('a signed-in user still cannot ingest or act as owner', () => {
    const w = configured();
    expect(() => w.call(w.alice, ctx => mod.upsert_catalogue_event(ctx, event(w)))).toThrow('unauthorized: ingester only');
    expect(() => w.call(w.alice, ctx => mod.set_discovery_config(ctx, { key: 'enabled', values: ['true'] }))).toThrow('unauthorized: module owner only');
    expect(view(w, w.alice, mod.catalogue_events)).toHaveLength(0);
    for (const shape of [{ internal: false, connected: false, sender: 'other' }, { internal: false, connected: true, sender: 'database' }] as Shape[]) {
      expect(() => asCaller(w, shape, ctx => mod.upsert_catalogue_event(ctx, event(w)))).toThrow('unauthorized: ingester only');
    }
    asCaller(w, LIVE_SCHEDULER, ctx => mod.upsert_catalogue_event(ctx, event(w))); // the database itself may
  });
});

describe('requireOwner on a real host', () => {
  const setIssuer = (ctx: any) => mod.set_auth_issuer(ctx, { issuer: 'https://owner-test.example', enabled: true });

  it('with the module_owner row present, only that identity acts; the database identity does not', () => {
    const w = setup(); // the harness skips init, so seed the owner row (alice) the way init would
    const aliceId: Identity = w.h.withReducerTx(w.alice, c => c.sender);
    w.h.withReducerTx(w.admin, ctx => { ctx.db.module_owner.insert({ key: 'owner', owner: aliceId }); });
    expect(() => asCaller(w, LIVE_SCHEDULER, setIssuer)).toThrow('unauthorized: module owner only');
    expect(() => w.call(w.bob, setIssuer)).toThrow('unauthorized: module owner only');
    w.call(w.alice, setIssuer);
  });

  it('without the row, only a database-internal caller (isDatabaseInternal) is admitted', () => {
    const w = setup();
    for (const shape of [{ internal: false, connected: false, sender: 'other' }, { internal: false, connected: true, sender: 'database' }] as Shape[]) {
      expect(() => asCaller(w, shape, setIssuer)).toThrow('unauthorized: module owner only');
    }
    asCaller(w, LIVE_SCHEDULER, setIssuer);
  });
});
