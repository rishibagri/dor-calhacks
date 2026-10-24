import test from 'node:test';
import assert from 'node:assert/strict';
import { InvalidPlanRequestError, PlanCoordinator } from '../dist/index.js';
import { applyPlanAction } from '@dor/contracts/plan-lifecycle';

// SYNTHETIC refs, events and catalogue records. No source text exists in these shapes.
const NOW = Date.parse('2026-10-24T12:00:00Z');
const HOUR = 3_600_000;
const iso = (ms) => new Date(ms).toISOString();
const clock = { now: () => new Date(NOW) };
const event = (id, over = {}) => ({ eventId: id, startsAt: iso(NOW + 30 * HOUR), status: 'scheduled', fetchedAt: iso(NOW - HOUR),
  topics: ['board-games'], format: 'in_person', ...over });
const request = (events, { a = ['e1', 'e2', 'e3'], b = ['e1', 'e2', 'e3'], ...over } = {}) => ({ schemaVersion: 1,
  requestId: 'req-1', basis: { kind: 'introduction', ref: 'intro_1' },
  participants: [{ ref: 'ben', intentVersion: 2, eventIds: a }, { ref: 'ana', intentVersion: 1, eventIds: b }], events, ...over });

/** Authoritative stand-in: current intents/events; mutate `world` to simulate changes during generation. */
function current(world = {}) {
  const w = { versions: { ana: 1, ben: 2 }, bothIntend: true, events: {}, basis: true, ...world };
  return { w, port: { current: async (_basis, _refs, eventId) => !w.basis ? null
    : { intentVersions: { ...w.versions }, bothIntend: w.bothIntend, event: w.events[eventId] ?? null } } };
}
function proposer(...replies) {
  const inputs = [];
  return { inputs, port: { propose: async (input) => {
    inputs.push(structuredClone(input));
    const next = replies.shift();
    if (next instanceof Error) throw next;
    return next;
  } } };
}
const coordinator = (cur, prop, over = {}) => new PlanCoordinator({ current: cur.port, proposer: prop.port, clock, ...over });

test('only events both people published intent for are options; none means no plan and no model call', async () => {
  const p = proposer();
  const r = await coordinator(current(), p).propose(request([event('e1'), event('e2')], { a: ['e1'], b: ['e2'] }));
  assert.deepEqual([r.outcome.outcome, r.outcome.mutualEvents, r.proposal, p.inputs.length], ['no_shared_event', 0, undefined, 0]);
});

test('cancelled, too-soon and stale-source events are not proposed; all-stale is reported as source_stale', async () => {
  const p = proposer();
  const unusable = await coordinator(current(), p).propose(request([event('e1', { status: 'cancelled' }),
    event('e2', { startsAt: iso(NOW + HOUR) })]));
  assert.deepEqual([unusable.outcome.outcome, unusable.outcome.mutualEvents, unusable.outcome.usableEvents], ['no_shared_event', 2, 0]);
  const stale = await coordinator(current(), p).propose(request([event('e1', { fetchedAt: iso(NOW - 72 * HOUR) })]));
  assert.equal(stale.outcome.outcome, 'source_stale');
  assert.equal(p.inputs.length, 0);
});

test('one usable mutual event: deterministic revision-1 proposal, zero model calls, closes an hour before start', async () => {
  const e1 = event('e1', { startsAt: iso(NOW + 10 * HOUR) });
  const p = proposer();
  const r = await coordinator(current({ events: { e1 } }), p).propose(request([e1], { a: ['e1'], b: ['e1'] }));
  assert.equal(p.inputs.length, 0);
  assert.deepEqual([r.outcome.outcome, r.outcome.decidedBy, r.proposal.revision, r.proposal.eventId], ['proposed', 'deterministic', 1, 'e1']);
  assert.deepEqual(r.proposal.participants, [{ ref: 'ana', intentVersion: 1 }, { ref: 'ben', intentVersion: 2 }]);
  assert.equal(r.proposal.expiresAt, iso(NOW + 9 * HOUR));
});

test('several events: one call that sees topics/format/time only; at most three options', async () => {
  const events = ['e1', 'e2', 'e3', 'e4'].map((id, i) => event(id, { topics: [`topic-${i}`], startsAt: iso(NOW + (20 + i) * HOUR) }));
  const p = proposer({ decision: 'suggest', eventIndex: 2 });
  const r = await coordinator(current({ events: Object.fromEntries(events.map(e => [e.eventId, e])) }), p)
    .propose(request(events, { a: ['e1', 'e2', 'e3', 'e4'], b: ['e1', 'e2', 'e3', 'e4'] }));
  assert.equal(p.inputs.length, 1);
  assert.equal(p.inputs[0].events.length, 3);
  assert.deepEqual(p.inputs[0].events[0], { topics: ['topic-0'], format: 'in_person', startsInHours: 20 });
  for (const leak of ['e1', 'ana', 'ben', 'intro_1', 'req-1', 'fetchedAt']) assert.equal(JSON.stringify(p.inputs[0]).includes(leak), false, leak);
  assert.deepEqual([r.outcome.decidedBy, r.proposal.eventId], ['agent', 'e3']);
});

test('unusable output: one repair, then labeled fallback to the first-ranked event; decline means no plan', async () => {
  const events = [event('e1'), event('e2')];
  const cur = current({ events: { e1: events[0], e2: events[1] } });
  const p = proposer({ decision: 'suggest', eventIndex: 9 }, 'book it now');
  const r = await coordinator(cur, p).propose(request(events));
  assert.deepEqual([p.inputs.length, p.inputs[1].round, r.outcome.outcome, r.outcome.decidedBy, r.proposal.eventId],
    [2, 2, 'proposer_failed_fallback', 'fixed_template', 'e1']);
  const declined = await coordinator(cur, proposer({ decision: 'none' })).propose(request(events));
  assert.deepEqual([declined.outcome.outcome, declined.proposal], ['no_fit', undefined]);
});

test('changes during generation suppress the proposal: intent revoked or edited, event moved or cancelled, basis gone', async () => {
  const changes = {
    intent_revoked: w => { w.bothIntend = false; },
    intent_edited: w => { w.versions.ana = 2; },
    event_cancelled: w => { w.events.e2 = { ...w.events.e2, status: 'cancelled' }; },
    event_moved: w => { w.events.e2 = { ...w.events.e2, startsAt: iso(NOW + 50 * HOUR) }; },
    event_removed: w => { delete w.events.e2; },
    basis_withdrawn: w => { w.basis = false; },
  };
  for (const [name, change] of Object.entries(changes)) {
    const events = [event('e1'), event('e2')];
    const cur = current({ events: { e1: events[0], e2: events[1] } });
    const p = { port: { propose: async () => { change(cur.w); return { decision: 'suggest', eventIndex: 1 }; } } };
    const r = await new PlanCoordinator({ current: cur.port, proposer: p.port, clock }).propose(request(events));
    assert.deepEqual([r.outcome.outcome, r.proposal], ['not_current', undefined], name);
  }
  const thrower = { port: { current: async () => { throw new Error('db down'); } } };
  assert.equal((await coordinator(thrower, proposer()).propose(request([event('e1')], { a: ['e1'], b: ['e1'] }))).outcome.outcome, 'not_current');
});

test('the proposal feeds the shared lifecycle: both must accept revision 1 while sources are current', async () => {
  const e1 = event('e1');
  const { proposal } = await coordinator(current({ events: { e1 } }), proposer()).propose(request([e1], { a: ['e1'], b: ['e1'] }));
  let state = { planId: proposal.planId, revision: proposal.revision, participants: proposal.participants.map(p => p.ref),
    acceptedBy: [], status: 'pending', expiresAtMs: Date.parse(proposal.expiresAt), eventStartsAtMs: Date.parse(proposal.eventStartsAt) };
  const check = { nowMs: NOW, eventScheduled: true, intentsCurrent: true, blocked: false };
  state = applyPlanAction(state, { kind: 'accept', actor: 'ana', revision: 1 }, check).state;
  assert.equal(state.status, 'pending');
  state = applyPlanAction(state, { kind: 'accept', actor: 'ben', revision: 1 }, check).state;
  assert.equal(state.status, 'confirmed');
});

test('plan IDs are stable per basis, people and event; invalid requests are rejected', async () => {
  const e1 = event('e1');
  const run = (over) => coordinator(current({ events: { e1 } }), proposer()).propose(request([e1], { a: ['e1'], b: ['e1'], ...over }));
  assert.equal((await run()).proposal.planId, (await run({ requestId: 'req-2' })).proposal.planId);
  assert.notEqual((await run()).proposal.planId, (await run({ basis: { kind: 'introduction', ref: 'intro_2' } })).proposal.planId);
  await assert.rejects(coordinator(current(), proposer()).propose({ ...request([e1]), autoRsvp: true }), InvalidPlanRequestError);
});
