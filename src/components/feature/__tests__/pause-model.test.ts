import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RecipientPause } from '@/lib/backend/ports';
import { decide, startLoop } from '../decision-loop-model.ts';
import {
  PAUSE_CHOICES, PAUSE_MAX_MS, PAUSE_MIN_MS, isPauseInForce, pauseEndsAt, pauseVersion, withoutPaused,
} from '../pause-model.ts';

const NOW = new Date('2026-10-24T12:00:00.000Z');
const pause = (pairId: string, over: Partial<RecipientPause> = {}): RecipientPause => ({
  pairId, version: 1, expiresAt: '2026-10-25T12:00:00.000Z', active: true, createdAt: '2026-10-24T11:00:00.000Z', ...over,
});
const A = { pairId: 'a', name: 'Alex' };
const B = { pairId: 'b', name: 'Sam' };

test('an active, unexpired pause excludes the recipient; others stay', () => {
  const r = withoutPaused([A, B], [pause('a')], NOW);
  assert.deepEqual(r.eligible, [B]);
  assert.equal(r.pausedCount, 1);
});

test('inactive or expired pauses leave the recipient eligible', () => {
  assert.equal(withoutPaused([A], [pause('a', { active: false })], NOW).eligible.length, 1);
  assert.equal(withoutPaused([A], [pause('a', { expiresAt: '2026-10-24T11:59:59.000Z' })], NOW).eligible.length, 1);
  assert.equal(isPauseInForce(undefined, NOW), false);
});

test('all paused: nothing is offered and the loop lands in the existing no-action state', () => {
  const { eligible } = withoutPaused([A, B], [pause('a'), pause('b')], NOW);
  assert.deepEqual(eligible, []);
  const o = decide(startLoop({ supportMode: 'short_call' }), eligible);
  assert.equal(o.kind, 'no_action');
});

test('expected version is 0 for a never-paused pair and the row version otherwise', () => {
  assert.equal(pauseVersion([], 'a'), 0);
  assert.equal(pauseVersion([pause('a', { version: 4 })], 'a'), 4);
});

test('duration choices stay within the module bounds and end in the future', () => {
  for (const c of PAUSE_CHOICES) {
    assert.ok(c.ms >= PAUSE_MIN_MS && c.ms <= PAUSE_MAX_MS);
    assert.ok(Date.parse(pauseEndsAt(c, NOW)) > NOW.getTime());
  }
});
