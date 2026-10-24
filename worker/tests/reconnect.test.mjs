import test from 'node:test';
import assert from 'node:assert/strict';
import { DISCONNECTED, SpacetimeWorkerConnection, WorkerLoop, classifyCommitError, isDisconnected } from '../dist/index.js';

/**
 * SYNTHETIC generated-bindings stand-in with test controls: drop the connection (with or without an SDK retry),
 * complete an automatic reconnect + subscription replay, and insert a row into a worker view.
 */
function fakeSdk({ autoReconnect = true } = {}) {
  const handlers = {};
  const subs = [];
  const inserts = {};
  const table = (name, rows) => ({ iter: () => rows, onInsert: cb => { inserts[name] = cb; } });
  const commits = [];
  const conn = {
    db: { workerSignalContext: table('worker_signal_context', [{ id: 'row' }]), workerDelivery: table('d', []),
      workerSupportPreferences: table('p', []) },
    reducers: { commitNudge: async a => { commits.push(a); } },
    subscriptionBuilder() {
      const sb = { onApplied: cb => { sb.applied = cb; return sb; }, onError: cb => { sb.error = cb; return sb; },
        subscribe: () => { subs.push(sb); queueMicrotask(() => sb.applied()); } };
      return sb;
    },
    disconnect() {},
  };
  const builder = {
    autoReconnectEnabled: false,
    withUri: () => builder, withDatabaseName: () => builder, withToken: () => builder,
    ...(autoReconnect ? { withAutomaticReconnect: () => { builder.autoReconnectEnabled = true; return builder; } } : {}),
    onConnect: cb => { handlers.connect = cb; return builder; },
    onConnectError: cb => { handlers.connectError = cb; return builder; },
    onDisconnect: cb => { handlers.disconnect = cb; return builder; },
    build: () => { queueMicrotask(() => handlers.connect(conn, { toHexString: () => 'ab'.repeat(32) })); return conn; },
  };
  return {
    builder: () => builder, builderState: builder, commits,
    drop: (willRetry = true) => handlers.disconnect({}, new Error('socket closed'), willRetry ? 1 : undefined, willRetry ? 1000 : undefined),
    failReconnect: (willRetry = true) => handlers.connectError({}, new Error('refused'), willRetry ? 2 : undefined, 2000),
    replay: () => subs.at(-1).applied(),
    insert: name => inserts[name]?.({}, {}),
  };
}
const connect = sdk => SpacetimeWorkerConnection.connect({ uri: 'ws://x', database: 'dor', token: 'synthetic', builder: sdk.builder });
const ARGS = { nudge_id: 'n-1', pair_id: 'p', template_id: 't', source_signal_ids: ['s'], source_consent_versions: [1],
  recipient_consent_id: 'c', recipient_consent_version: 1 };

test('connection: SDK automatic reconnect is enabled when the bindings support it', async () => {
  const sdk = fakeSdk();
  const c = await connect(sdk);
  assert.equal(sdk.builderState.autoReconnectEnabled, true);
  assert.equal(c.isAlive, true);
  assert.deepEqual(await c.signalContext(), [{ id: 'row' }]);
});

test('connection: a drop fails closed (stale cache is never read) until the replayed subscription applies', async () => {
  const sdk = fakeSdk();
  const c = await connect(sdk);
  const events = [];
  c.on(e => events.push(e));
  sdk.drop(true);
  assert.equal(c.isAlive, false);
  for (const read of [() => c.signalContext(), () => c.delivery(), () => c.supportPreferences(), () => c.commitNudge(ARGS)]) {
    await assert.rejects(read(), e => isDisconnected(e));
  }
  assert.deepEqual(sdk.commits, [], 'nothing committed while disconnected');
  sdk.failReconnect(true);
  assert.equal(c.isAlive, false, 'a failed reconnect attempt keeps it down');
  sdk.replay();
  assert.equal(c.isAlive, true);
  await c.commitNudge(ARGS);
  assert.equal(sdk.commits.length, 1);
  assert.deepEqual(events.map(e => e.kind), ['lost', 'lost', 'ready']);
  assert.equal(events[0].willRetry, true);
});

test('connection: no SDK retry (or no auto-reconnect support) reports willRetry=false', async () => {
  for (const sdk of [fakeSdk(), fakeSdk({ autoReconnect: false })]) {
    const c = await connect(sdk);
    const events = [];
    c.on(e => events.push(e));
    sdk.drop(false);
    assert.deepEqual(events, [{ kind: 'lost', willRetry: false }]);
  }
});

test('connection: rows inserted into worker views emit change events (event-driven triggers)', async () => {
  const sdk = fakeSdk();
  const c = await connect(sdk);
  const events = [];
  c.on(e => events.push(e.kind));
  sdk.insert('worker_signal_context');
  assert.deepEqual(events, ['change']);
});

test('a disconnect is a transient fault: never classified as a policy refusal', () => {
  assert.equal(isDisconnected(new Error(DISCONNECTED)), true);
  assert.equal(classifyCommitError(new Error(DISCONNECTED)), null, 'thrown and retried, never recorded as policy_denied');
});

/** SYNTHETIC connection for the loop: controllable liveness and events. */
function fakeConnection() {
  const listeners = new Set();
  return { isAlive: true, on: l => { listeners.add(l); return () => listeners.delete(l); },
    emit(e) { for (const l of listeners) l(e); } };
}

test('loop: change events trigger one debounced sweep; nothing sweeps while disconnected; reconnect catches up', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const conn = fakeConnection();
  let sweeps = 0;
  const fatal = [];
  const loop = new WorkerLoop(conn, { sweeps: [async () => { sweeps++; }], debounceMs: 200, fallbackIntervalMs: 15_000,
    maxOfflineMs: 120_000, onFatal: r => fatal.push(r) });
  loop.start();
  assert.equal(sweeps, 1, 'sweeps once at start');
  for (let i = 0; i < 5; i++) conn.emit({ kind: 'change' });
  t.mock.timers.tick(200);
  assert.equal(sweeps, 2, 'a burst of changes is one sweep');
  conn.isAlive = false;
  conn.emit({ kind: 'lost', willRetry: true });
  conn.emit({ kind: 'change' });
  t.mock.timers.tick(15_000);
  assert.equal(sweeps, 2, 'no sweep (change or interval) while disconnected');
  conn.isAlive = true;
  conn.emit({ kind: 'ready' });
  assert.equal(sweeps, 3, 'reconnect sweeps immediately');
  t.mock.timers.tick(120_000);
  assert.deepEqual(fatal, [], 'the offline timer was cleared by the reconnect');
  loop.stop();
});

test('loop: no SDK retry, or an outage past the limit, is fatal (supervisor restarts the process)', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const a = fakeConnection(), b = fakeConnection();
  const fatal = [];
  new WorkerLoop(a, { sweeps: [], onFatal: r => fatal.push(['a', r]) }).start();
  a.emit({ kind: 'lost', willRetry: false });
  const lb = new WorkerLoop(b, { sweeps: [], maxOfflineMs: 120_000, onFatal: r => fatal.push(['b', r]) });
  lb.start();
  b.isAlive = false;
  b.emit({ kind: 'lost', willRetry: true });
  t.mock.timers.tick(119_999);
  assert.deepEqual(fatal, [['a', 'no_reconnect']]);
  t.mock.timers.tick(1);
  assert.deepEqual(fatal, [['a', 'no_reconnect'], ['b', 'offline_too_long']]);
});
