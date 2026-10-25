import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, runScenario } from '../scenarios.ts';

test('16 synthetic scenarios, each with a pre-written expectation', () => {
  assert.equal(SCENARIOS.length, 16);
  assert.equal(new Set(SCENARIOS.map(s => s.id)).size, 16);
});

for (const s of SCENARIOS) {
  test(`${s.id}: ${s.title}`, () => {
    const d = runScenario(s);
    const x = s.expected;
    assert.equal(d.mode, x.mode, d.summary);
    assert.equal(d.action, x.action);
    assert.equal(d.targetRef, x.targetRef);
    if (x.surface) assert.equal(d.surface, x.surface);
    if (x.timing) assert.equal(d.timing, x.timing);
    if (x.freshness) assert.equal(d.freshness, x.freshness);
    if (x.cappedBy) assert.equal(d.capped?.by, x.cappedBy);
    if (x.reassess) assert.deepEqual(d.reassess, x.reassess);
    for (const r of x.reasons ?? []) assert.ok(d.reasons.includes(r as never), `missing reason ${r}: ${d.reasons}`);
    for (const r of x.rejected ?? []) {
      assert.ok(d.rejected.some(y => y.action === r.action && y.reason === r.reason && (!r.targetRef || y.targetRef === r.targetRef)),
        `expected ${r.action}${r.targetRef ? `→${r.targetRef}` : ''} rejected as ${r.reason}; got ${JSON.stringify(d.rejected)}`);
    }
    assert.ok(d.summary.length > 0 && d.summary.length <= 200);
  });
}

test('s01 is proactive only offline: without allowUnnamedTargets the unnamed friend is an ask, not an act', () => {
  const s = SCENARIOS.find(x => x.id === 's01-exam-friend-free-soon')!;
  const d = runScenario(s, { options: {} });
  assert.equal(d.mode, 'ask');
  assert.equal(d.capped?.by, 'unnamed_target');
  assert.equal(d.deliveryMapping, undefined);
});

test('s02 deferral keeps only the reassessment condition: no action, target or delivery', () => {
  const d = runScenario(SCENARIOS.find(x => x.id === 's02-exam-friend-tomorrow')!);
  assert.equal(d.action, undefined);
  assert.equal(d.targetRef, undefined);
  assert.equal(d.deliveryMapping, undefined);
  assert.equal(d.timing, 'not_now');
});

test('act toward the other person carries only the existing enum signal and an intended template', () => {
  const d = runScenario(SCENARIOS.find(x => x.id === 's10-rarely-initiating-friend-twice')!);
  assert.deepEqual(d.deliveryMapping, { supportMode: 'shared_activity', intendedTemplate: 'offer_shared_activity' });
});
