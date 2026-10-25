// D048 (PROPOSED, AI) viewer-initiated introduction suggestion requests: request_introduction_suggestion,
// worker_introduction_requests, close_introduction_suggestion_request, my_introduction_suggestion_request.
// Direct reducer and view calls with a third account and a worker identity. Synthetic names/tags only.
// In-process harness: no deployed isolation, real JWT mapping, real scheduler or browser evidence.
import { describe, expect, it } from 'vitest';
import { Timestamp } from 'spacetimedb';
import { inDays, jwtAuth, mod, setup, view } from './helpers';

type W = ReturnType<typeof setup>;
type Who = W['alice'];
const MINUTE_US = 60_000_000n;

function world() {
  const w = setup();
  const admin = (fn: Parameters<typeof w.h.withReducerTx>[1]) => w.h.withReducerTx(w.admin, fn);
  admin(ctx => mod.set_discovery_config(ctx, { key: 'tags', values: ['board-games', 'hiking', 'live-music'] }));
  admin(ctx => mod.set_discovery_config(ctx, { key: 'areas', values: ['berkeley-campus', 'oakland-downtown'] }));
  admin(ctx => mod.set_discovery_config(ctx, { key: 'enabled', values: ['true'] }));
  const worker = jwtAuth('dor-worker', 50n, 'https://worker.spacetimedb.example');
  const workerId = w.h.withReducerTx(worker, ctx => ctx.sender);
  admin(ctx => mod.set_worker_identity(ctx, { worker: workerId, enabled: true }));
  return Object.assign(w, { worker });
}
type EW = ReturnType<typeof world>;

const advance = (w: W, us: bigint) => w.h.clock.set(new Timestamp(w.h.clock.now().microsSinceUnixEpoch + us));
const mine = (w: W, who: Who) => view<any>(w, who, mod.my_discovery_profile)[0];
const refOf = (w: W, who: Who) => mine(w, who).publication_id as string;
function participate(w: W, who: Who, tags: string[], area = 'berkeley-campus') {
  const expected_revision = mine(w, who)?.revision ?? 0;
  w.call(who, ctx => mod.publish_discovery_profile(ctx, { display_name: 'Synthetic', interest_tags: tags,
    audience: 'area_discoverers', notice_version: 1, expires_at: inDays(w, 7), expected_revision }));
  w.call(who, ctx => mod.set_discovery_area(ctx, { area_key: area }));
}
let seq = 0;
const ask = (w: W, who: Who, id = `suggest-${String(++seq).padStart(4, '0')}`) =>
  (w.call(who, ctx => mod.request_introduction_suggestion(ctx, { client_request_id: id })), id);
const workerRows = (w: EW, who: Who = w.worker) => view<any>(w, who, mod.worker_introduction_requests);
const myRequest = (w: W, who: Who) => view<any>(w, who, mod.my_introduction_suggestion_request);
const close = (w: EW, request_id: string, who: Who = w.worker) =>
  w.call(who, ctx => mod.close_introduction_suggestion_request(ctx, { request_id }));

/** Alice shares hiking with Bob and hiking + live-music with Carol; Dave is published with no overlap. */
function quad() {
  const w = world();
  participate(w, w.alice, ['hiking', 'live-music']);
  participate(w, w.bob, ['hiking']);
  participate(w, w.carol, ['hiking', 'live-music']);
  const dave = jwtAuth('dave', 60n);
  w.call(dave, ctx => mod.register_account(ctx, { display_name: 'Dave' }));
  participate(w, dave, ['board-games']);
  return Object.assign(w, { dave });
}

describe('request_introduction_suggestion', () => {
  it('a published viewer asks: the worker sees opaque refs, revisions and overlap only, for visible overlapping cards', () => {
    const w = quad();
    ask(w, w.alice);
    const rows = workerRows(w);
    expect(rows.map(r => r.candidate_ref).sort()).toEqual([refOf(w, w.bob), refOf(w, w.carol)].sort());
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(['candidate_ref', 'candidate_revision', 'expires_at', 'request_id', 'shared_tags',
        'viewer_ref', 'viewer_revision']);
      expect(r.viewer_ref).toBe(refOf(w, w.alice));
    }
    expect(rows.find(r => r.candidate_ref === refOf(w, w.carol))!.shared_tags).toEqual(['hiking', 'live-music']);
    expect(rows.some(r => r.candidate_ref === refOf(w, w.dave))).toBe(false); // no overlap → not offered
    expect(myRequest(w, w.alice)).toMatchObject([{ status: 'open' }]);
  });

  it('only the worker reads the worker view; nobody else sees another person\'s request', () => {
    const w = quad();
    ask(w, w.alice);
    for (const who of [w.alice, w.bob, w.carol]) expect(workerRows(w, who)).toEqual([]);
    expect(myRequest(w, w.bob)).toEqual([]);
    expect(myRequest(w, w.carol)).toEqual([]);
  });

  it('needs a current publication and area; refused while discovery is disabled', () => {
    const w = world();
    expect(() => ask(w, w.alice)).toThrow('not_published');
    participate(w, w.alice, ['hiking']);
    w.call(w.alice, ctx => mod.withdraw_discovery_profile(ctx, {}));
    expect(() => ask(w, w.alice)).toThrow('withdrawn');
    w.h.withReducerTx(w.admin, ctx => mod.set_discovery_config(ctx, { key: 'enabled', values: [] }));
    expect(() => ask(w, w.bob)).toThrow('unavailable: disabled');
  });

  it('idempotent: a replayed id and a second tap while open are no-ops (one request, one rate unit)', () => {
    const w = quad();
    const id = ask(w, w.alice);
    ask(w, w.alice, id);
    ask(w, w.alice);
    const reqs = new Set(workerRows(w).map(r => r.request_id));
    expect(reqs.size).toBe(1);
    const windows = w.h.withReducerTx(w.admin, ctx => [...ctx.db.rate_window.iter()].filter(r => r.limit_key.startsWith('introduction_suggestion:')));
    expect(windows.map(r => r.count)).toEqual([1]);
  });

  it('rate limited per viewer', () => {
    const w = quad();
    for (let i = 0; i < 10; i++) {
      const id = ask(w, w.alice);
      close(w, workerRows(w)[0]!.request_id);
      expect(id).toBeTruthy();
    }
    expect(() => ask(w, w.alice)).toThrow('rate_limited');
  });

  it('a lapsed open request no longer blocks a new one', () => {
    const w = quad();
    ask(w, w.alice);
    advance(w, 11n * MINUTE_US);
    ask(w, w.alice);
    expect(new Set(workerRows(w).map(r => r.request_id)).size).toBe(2); // the worker skips the lapsed one by expires_at
  });
});

describe('worker_introduction_requests candidate rules', () => {
  it('leaves out blocked, other-area, connected, pending and already-suggested people', () => {
    const w = quad();
    const bobRef = refOf(w, w.bob); // read views outside the reducer tx
    w.call(w.alice, ctx => mod.block_discovery_user(ctx, { card_ref: bobRef }));
    ask(w, w.alice);
    expect(workerRows(w).map(r => r.candidate_ref)).toEqual([refOf(w, w.carol)]);

    const w2 = quad();
    const carolRef = refOf(w2, w2.carol);
    w2.call(w2.alice, ctx => mod.send_introduction_request(ctx, { card_ref: carolRef, client_request_id: 'intro-0001' }));
    participate(w2, w2.bob, ['hiking'], 'oakland-downtown');
    ask(w2, w2.alice);
    expect(workerRows(w2).map(r => r.candidate_ref)).toEqual([undefined]);
  });

  it('a request with nobody to suggest is one row without a candidate, so the worker can close it without a call', () => {
    const w = world();
    participate(w, w.alice, ['hiking']);
    ask(w, w.alice);
    expect(workerRows(w)).toMatchObject([{ candidate_ref: undefined, candidate_revision: 0, shared_tags: [] }]);
  });

  it('a viewer who withdraws after asking is listed without candidates (closed, nothing suggested)', () => {
    const w = quad();
    ask(w, w.alice);
    w.call(w.alice, ctx => mod.withdraw_discovery_profile(ctx, {}));
    expect(workerRows(w)).toMatchObject([{ candidate_ref: undefined, shared_tags: [] }]);
  });

  it('an existing suggestion for a candidate leaves them out of the next request', () => {
    const w = quad();
    const first = ask(w, w.alice);
    const row = workerRows(w).find(r => r.candidate_ref === refOf(w, w.carol))!;
    w.call(w.worker, ctx => mod.commit_introduction_proposal(ctx, {
      proposal_id: 'proposal-0001', viewer_ref: row.viewer_ref, candidate_ref: row.candidate_ref,
      viewer_publication_version: row.viewer_revision, candidate_publication_version: row.candidate_revision,
      reason_code: 'shared_interest', shared_tags: ['live-music'], event_id: undefined, opener_id: 'suggest_shared_interest',
      decided_by: 'deterministic', expires_at: inDays(w, 1),
    }));
    close(w, row.request_id);
    expect(first).toBeTruthy();
    ask(w, w.alice);
    expect(workerRows(w).map(r => r.candidate_ref)).toEqual([refOf(w, w.bob)]);
  });
});

describe('close_introduction_suggestion_request', () => {
  it('worker only; closes once; the request leaves the worker view and reads done to the viewer', () => {
    const w = quad();
    ask(w, w.alice);
    const id = workerRows(w)[0]!.request_id;
    expect(() => close(w, id, w.alice)).toThrow('unauthorized: worker only');
    expect(() => close(w, id, w.carol)).toThrow('unauthorized: worker only');
    close(w, id);
    close(w, id);
    expect(workerRows(w)).toEqual([]);
    expect(myRequest(w, w.alice)).toMatchObject([{ request_id: id, status: 'done' }]);
    expect(() => close(w, 'no-such-request')).toThrow('not_found: request');
  });
});
