import test from 'node:test';
import assert from 'node:assert/strict';
import { PlanRequestSchema } from '@dor/contracts';
import { PLAN_PARTICIPANTS, classifyPlanCommitError, groupPlanBases, mapRows, planFingerprint, toPlanCandidate,
  toPlanRequest } from '../dist/index.js';

const ts = (iso) => ({ microsSinceUnixEpoch: BigInt(Date.parse(iso)) * 1000n });
/** SYNTHETIC worker_plan_candidates row as the generated client delivers it (camelCase, bigint-free arrays). */
const row = (over = {}) => ({
  basisKind: 'introduction', basisRef: 'intro-1', eventId: 'evt-1', intentIds: ['ia', 'ib'], intentVersions: [1, 2],
  approvalIds: [], eventStartsAt: ts('2099-01-03T18:00:00Z'), fetchedAt: ts('2099-01-01T00:00:00Z'),
  topics: ['hiking'], format: 'in_person', ...over,
});

test('plan rows: camelCase bindings map to a scheduled CatalogueEventRef with exact intent bindings', () => {
  const [c] = mapRows([row()], toPlanCandidate);
  assert.deepEqual(c.intentIds, ['ia', 'ib']);
  assert.deepEqual(c.intentVersions, [1, 2]);
  assert.deepEqual(c.event, { eventId: 'evt-1', startsAt: '2099-01-03T18:00:00.000Z', status: 'scheduled',
    fetchedAt: '2099-01-01T00:00:00.000Z', topics: ['hiking'], format: 'in_person' });
});

test('plan rows: drift fails closed (row dropped), never guessed', () => {
  const bad = [row({ basisKind: 'stranger' }), row({ intentIds: ['ia'] }), row({ intentVersions: [1, 'x'] }),
    row({ topics: ['Support Group'] }), row({ topics: ['a1', 'b2', 'c3', 'd4', 'e5', 'f6'] }), row({ format: 'hybrid' }),
    row({ eventStartsAt: 'soon' }), null, 'row'];
  assert.deepEqual(mapRows(bad, toPlanCandidate), []);
});

test('grouping: one basis per introduction/pair, duplicate events dropped, soonest first', () => {
  const rows = mapRows([
    row({ eventId: 'late', eventStartsAt: ts('2099-01-05T00:00:00Z') }), row({ eventId: 'soon' }), row({ eventId: 'soon' }),
    row({ basisKind: 'existing_connection', basisRef: 'pair-1', eventId: 'late', approvalIds: ['aa', 'ab'] }),
  ], toPlanCandidate);
  const bases = groupPlanBases(rows);
  assert.equal(bases.length, 2);
  assert.deepEqual(bases[0].rows.map(r => r.eventId), ['soon', 'late']);
  assert.equal(bases[1].kind, 'existing_connection');
});

test('request: valid D034 shape, positional participants, DS ranking may reorder or drop but never add', () => {
  const [basis] = groupPlanBases(mapRows([row({ eventId: 'a' }), row({ eventId: 'b', eventStartsAt: ts('2099-01-04T00:00:00Z') })],
    toPlanCandidate));
  const plain = toPlanRequest(basis);
  assert.equal(PlanRequestSchema.safeParse(plain).success, true);
  assert.deepEqual(plain.participants.map(p => p.ref), [...PLAN_PARTICIPANTS]);
  const ranked = toPlanRequest(basis, events => [
    { ...events[1], topics: ['injected'] }, { eventId: 'invented', startsAt: events[0].startsAt }]);
  assert.deepEqual(ranked.events.map(e => e.eventId), ['b']);
  assert.deepEqual(ranked.events[0].topics, ['hiking'], 'ranker output is matched by ID, never trusted for content');
});

test('fingerprint: stable across row order, changes with any intent version or approval', () => {
  const rows = [row({ eventId: 'a' }), row({ eventId: 'b' })];
  const fp = rows => planFingerprint(groupPlanBases(mapRows(rows, toPlanCandidate))[0]);
  assert.equal(fp(rows), fp([...rows].reverse()));
  assert.notEqual(fp(rows), fp([row({ eventId: 'a', intentVersions: [1, 3] }), rows[1]]));
  assert.notEqual(fp(rows), fp([row({ eventId: 'a', approvalIds: ['x', 'y'] }), rows[1]]));
});

test('plan commit errors: stale state is recorded; malformed commits and deployment faults are thrown', () => {
  assert.equal(classifyPlanCommitError(new Error('stale: intent_not_current')), 'not_current');
  assert.equal(classifyPlanCommitError(new Error('stale: source_stale')), 'source_stale');
  assert.equal(classifyPlanCommitError(new Error('stale: already_planned')), 'not_current');
  assert.equal(classifyPlanCommitError(new Error('not_found: blocked')), 'not_current');
  assert.equal(classifyPlanCommitError(new Error('unauthorized: worker only')), null);
  assert.equal(classifyPlanCommitError(new Error('unavailable: disabled')), null);
  assert.equal(classifyPlanCommitError(new Error('invalid: invalid_schema')), null);
  assert.equal(classifyPlanCommitError(new Error('ECONNRESET')), null);
});

/** SYNTHETIC generated-bindings stand-in: records the subscription and reducer calls. */
function fakeBindings({ withPlans }) {
  const subscribed = [], calls = [];
  const table = rows => ({ iter: () => rows });
  const conn = {
    db: { workerSignalContext: table([]), workerDelivery: table([]), workerSupportPreferences: table([]),
      ...(withPlans ? { workerPlanCandidates: table([row()]) } : {}) },
    reducers: { commitNudge: async () => {}, ...(withPlans ? { commitPlanProposal: async a => { calls.push(a); } } : {}) },
    subscriptionBuilder() {
      const b = { onApplied: cb => { b.applied = cb; return b; }, onError: () => b,
        subscribe: qs => { subscribed.push(...qs); queueMicrotask(() => b.applied()); } };
      return b;
    },
    disconnect() {},
  };
  const builder = { withUri: () => builder, withDatabaseName: () => builder, withToken: () => builder,
    onConnect: cb => { builder.connect = cb; return builder; }, onConnectError: () => builder, onDisconnect: () => builder,
    build: () => { builder.connect(conn, { toHexString: () => 'ab'.repeat(16) }); return conn; } };
  return { builder: () => builder, subscribed, calls };
}

test('live connection: plans are enabled only when the bindings carry both the view and the reducer', async () => {
  const { SpacetimeWorkerConnection } = await import('../dist/index.js');
  const opts = b => ({ uri: 'ws://x', database: 'dor', token: 't', builder: b.builder });

  const old = fakeBindings({ withPlans: false });
  const without = await SpacetimeWorkerConnection.connect(opts(old));
  assert.equal(without.planCandidates, undefined);
  assert.equal(without.commitPlanProposal, undefined);
  assert.equal(old.subscribed.some(q => q.includes('worker_plan_candidates')), false);

  const fresh = fakeBindings({ withPlans: true });
  const withPlans = await SpacetimeWorkerConnection.connect(opts(fresh));
  assert.ok(fresh.subscribed.includes('SELECT * FROM worker_plan_candidates'));
  assert.equal(mapRows(await withPlans.planCandidates(), toPlanCandidate).length, 1);
  await withPlans.commitPlanProposal({ plan_id: 'plan_x', basis_kind: 'introduction', basis_ref: 'intro-1', event_id: 'evt-1',
    intent_ids: ['ia', 'ib'], intent_versions: [1, 2], approval_ids: [], expires_at: '2099-01-02T00:00:00Z', decided_by: 'agent' });
  assert.deepEqual(Object.keys(fresh.calls[0]).sort(), ['approvalIds', 'basisKind', 'basisRef', 'decidedBy', 'eventId', 'expiresAt',
    'intentIds', 'intentVersions', 'planId']);
});

test('live connection: an optional view the server rejects (bindings newer than the module) disables only its path', async () => {
  const { SpacetimeWorkerConnection } = await import('../dist/index.js');
  const subscribed = [];
  const table = rows => ({ iter: () => rows });
  const conn = {
    db: { workerSignalContext: table([]), workerDelivery: table([]), workerSupportPreferences: table([]),
      workerPlanCandidates: table([row()]), workerIntroductionRequests: table([]) },
    reducers: { commitNudge: async () => {}, commitPlanProposal: async () => {}, commitIntroductionProposal: async () => {},
      closeIntroductionSuggestionRequest: async () => {} },
    subscriptionBuilder() {
      const b = { onApplied: cb => { b.applied = cb; return b; }, onError: cb => { b.error = cb; return b; },
        subscribe: qs => {
          subscribed.push(...qs);
          // SYNTHETIC: the published module predates D048, so the server rejects that one view.
          queueMicrotask(() => (qs.some(q => q.includes('worker_introduction_requests')) ? b.error() : b.applied()));
        } };
      return b;
    },
    disconnect() {},
  };
  const builder = { withUri: () => builder, withDatabaseName: () => builder, withToken: () => builder,
    onConnect: cb => { builder.connect = cb; return builder; }, onConnectError: () => builder, onDisconnect: () => builder,
    build: () => { builder.connect(conn, { toHexString: () => 'ab'.repeat(16) }); return conn; } };
  const c = await SpacetimeWorkerConnection.connect({ uri: 'ws://x', database: 'dor', token: 't', builder: () => builder });
  assert.ok(subscribed.includes('SELECT * FROM worker_introduction_requests'));
  assert.equal(c.isAlive, true);
  assert.equal(c.introductionRequests, undefined);
  assert.equal(c.closeIntroductionRequest, undefined);
  assert.equal(mapRows(await c.planCandidates(), toPlanCandidate).length, 1); // plans unaffected
  assert.equal(typeof c.commitIntroductionProposal, 'function');
});
